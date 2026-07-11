const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { ensureDir, readJson, writeJson } = require('./store');
const { progressBus } = require('./downloader');

const MAX_INSTALLER_LOG = 256 * 1024;
const INSTALLER_TIMEOUT_MS = 15 * 60 * 1000;

function profileId(name) {
  return `amethyst-${String(name || 'modpack')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'modpack'}`;
}

/**
 * Forge's official --installClient command expects the target directory to have
 * been initialized by the official launcher. Amethyst uses isolated game
 * directories, so create the compatible launcher metadata before invoking it.
 * Existing launcher profiles are preserved.
 */
async function ensureLauncherProfiles(gameDir, { minecraftVersion = '', name = 'Amethyst modpack' } = {}) {
  await ensureDir(gameDir);
  const launcherProfilesPath = path.join(gameDir, 'launcher_profiles.json');
  let profiles = null;

  try {
    profiles = await readJson(launcherProfilesPath, null);
  } catch (_) {
    profiles = null;
  }

  if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) {
    // Keep malformed user data available for diagnosis instead of overwriting it.
    try {
      await fs.rename(launcherProfilesPath, `${launcherProfilesPath}.invalid-${Date.now()}`);
    } catch (_) {
      // The file usually does not exist on a new isolated instance.
    }
    profiles = {};
  }

  if (!profiles.profiles || typeof profiles.profiles !== 'object' || Array.isArray(profiles.profiles)) {
    profiles.profiles = {};
  }

  const id = profileId(name);
  if (!profiles.profiles[id]) {
    const now = new Date().toISOString();
    profiles.profiles[id] = {
      created: now,
      gameDir,
      icon: 'Grass',
      lastUsed: now,
      lastVersionId: minecraftVersion || 'latest-release',
      name: String(name || 'Amethyst modpack'),
      type: 'custom'
    };
  }

  // These are the fields written by the Mojang launcher and understood by
  // Forge installers. Keep any extra fields an existing launcher added.
  if (!profiles.clientToken) profiles.clientToken = crypto.randomUUID();
  if (!profiles.settings || typeof profiles.settings !== 'object') profiles.settings = {};
  if (!Number.isInteger(profiles.version)) profiles.version = 3;

  await writeJson(launcherProfilesPath, profiles);
  return { path: launcherProfilesPath, profileId: id, profiles };
}

function appendLimitedLog(current, chunk) {
  const next = current + chunk.toString();
  return next.length > MAX_INSTALLER_LOG ? next.slice(-MAX_INSTALLER_LOG) : next;
}

function emitInstallerOutput(chunk) {
  const lines = chunk.toString().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length) progressBus.emitEvent('status', { message: lines.at(-1) });
}

async function runForgeInstaller({
  javaPath,
  installerPath,
  gameDir,
  cwd = path.dirname(installerPath),
  loader = 'forge',
  loaderVersion = '',
  minecraftVersion = '',
  modpackName = 'Amethyst modpack',
  timeoutMs = INSTALLER_TIMEOUT_MS,
  spawnImpl = spawn
}) {
  if (!javaPath) throw new Error('Java executable is required for the Forge installer.');
  if (!installerPath) throw new Error('Forge installer path is required.');

  await ensureLauncherProfiles(gameDir, { minecraftVersion, name: modpackName });
  progressBus.emitEvent('status', {
    message: `Running ${loader === 'neoforge' ? 'NeoForge' : 'Forge'} installer ${loaderVersion}`.trim()
  });

  return new Promise((resolve, reject) => {
    const child = spawnImpl(javaPath, ['-jar', installerPath, '--installClient', gameDir], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let output = '';
    let settled = false;
    let timer = null;

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };

    const onData = (chunk) => {
      output = appendLimitedLog(output, chunk);
      emitInstallerOutput(chunk);
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (error) => finish(new Error(`Could not start the ${loader} installer: ${error.message}`)));
    child.on('close', (code, signal) => {
      if (code === 0) return finish(null, output);
      const detail = output.trim().slice(-4000) || `The Java process exited without output${signal ? ` (${signal})` : ''}.`;
      finish(new Error(`${loader === 'neoforge' ? 'NeoForge' : 'Forge'} installer failed (exit code ${code ?? 'unknown'}).\n${detail}`));
    });

    timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error(`${loader === 'neoforge' ? 'NeoForge' : 'Forge'} installer timed out after ${Math.round(timeoutMs / 60000)} minutes.`));
    }, timeoutMs);
    timer.unref?.();
  });
}

async function findInstalledLoaderVersion(gameDir, { loader = 'forge', loaderVersion = '' } = {}) {
  const versionsDir = path.join(gameDir, 'versions');
  let entries = [];
  try {
    entries = await fs.readdir(versionsDir, { withFileTypes: true });
  } catch (_) {
    return null;
  }

  const marker = loader === 'neoforge' ? 'neoforge' : 'forge';
  const expectedVersion = String(loaderVersion || '').toLowerCase();
  const candidates = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const jsonPath = path.join(versionsDir, entry.name, `${entry.name}.json`);
    const metadata = await readJson(jsonPath, null).catch(() => null);
    if (!metadata) continue;

    const searchable = [
      entry.name,
      metadata.id,
      metadata.mainClass,
      ...(metadata.libraries || []).map((library) => library?.name)
    ].filter(Boolean).join(' ').toLowerCase();

    if (!searchable.includes(marker)) continue;
    const hasExpectedVersion = !expectedVersion || searchable.includes(expectedVersion);
    candidates.push({
      id: entry.name,
      score: (hasExpectedVersion ? 100 : 0) + (entry.name.toLowerCase().includes(marker) ? 20 : 0)
    });
  }

  candidates.sort((a, b) => b.score - a.score || b.id.localeCompare(a.id, undefined, { numeric: true }));
  if (!candidates.length || (expectedVersion && candidates[0].score < 100)) return null;
  return candidates[0].id;
}

module.exports = {
  ensureLauncherProfiles,
  runForgeInstaller,
  findInstalledLoaderVersion,
  profileId
};
