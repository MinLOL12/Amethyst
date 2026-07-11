const path = require('node:path');
const fs = require('node:fs/promises');
const {
  FABRIC_META_URL,
  QUILT_META_URL,
  FORGE_MAVEN_URL,
  NEOFORGE_MAVEN_URL
} = require('../config');
const { fetchJson, downloadFile, progressBus } = require('./downloader');
const { getVersionMeta, artifactPathFromName } = require('./mojangApi');
const { ensureDir, writeJson, readJson } = require('./store');
const { gamePaths } = require('./minecraftPaths');
const { runForgeInstaller, findInstalledLoaderVersion } = require('./forgeInstaller');

const LOADERS = ['vanilla', 'fabric', 'forge', 'neoforge', 'quilt'];

function normalizeLoader(loader) {
  const kind = String(loader || 'vanilla').toLowerCase();
  if (!LOADERS.includes(kind)) throw new Error(`Unknown mod loader: ${loader}`);
  return kind;
}

function normalizeForgeVersion(gameVersion, loaderVersion) {
  const selected = String(loaderVersion || '');
  return selected.startsWith(`${gameVersion}-`) ? selected : `${gameVersion}-${selected}`;
}

/** Return the version id produced by the official loader profile. */
function loaderVersionId(loader, gameVersion, loaderVersion) {
  const kind = normalizeLoader(loader);
  const selected = String(loaderVersion || '');
  if (kind === 'vanilla' || !selected) return gameVersion;
  if (kind === 'fabric') return `fabric-loader-${selected}-${gameVersion}`;
  if (kind === 'quilt') return `quilt-loader-${selected}-${gameVersion}`;
  if (kind === 'forge') {
    const forgeVersion = selected.startsWith(`${gameVersion}-`)
      ? selected.slice(gameVersion.length + 1)
      : selected;
    return `${gameVersion}-forge-${forgeVersion}`;
  }
  return `neoforge-${selected}`;
}

function loaderMarker(kind) {
  if (kind === 'fabric') return 'fabric';
  if (kind === 'quilt') return 'quilt';
  if (kind === 'forge') return 'forge';
  if (kind === 'neoforge') return 'neoforge';
  return '';
}

/**
 * Find an installed loader profile instead of assuming an id. Forge and
 * NeoForge ids have changed between installer generations, while Fabric and
 * Quilt may also return a custom id from their profile API.
 */
async function findInstalledLoaderProfile(loader, gameVersion, loaderVersion, gameDir) {
  const kind = normalizeLoader(loader);
  if (kind === 'vanilla') return gameVersion;

  const versionsDir = path.join(gameDir, 'versions');
  const expected = loaderVersionId(kind, gameVersion, loaderVersion);
  const entries = [];
  try {
    for (const entry of await fs.readdir(versionsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) entries.push(entry.name);
    }
  } catch (_) {
    return null;
  }

  // Prefer the deterministic id when it exists.
  entries.sort((a, b) => Number(b === expected) - Number(a === expected));
  const marker = loaderMarker(kind);
  const wantedVersion = String(loaderVersion || '').toLowerCase();

  for (const id of entries) {
    const meta = await readJson(path.join(versionsDir, id, `${id}.json`), null).catch(() => null);
    if (!meta) continue;
    const loaderLibraries = (meta.libraries || []).map((library) => library?.name || '').join(' ').toLowerCase();
    const searchable = [
      id,
      meta.id,
      meta.mainClass,
      meta.inheritsFrom,
      loaderLibraries
    ].filter(Boolean).join(' ').toLowerCase();
    if (!searchable.includes(marker)) continue;
    if (kind === 'forge' && searchable.includes('neoforge')) continue;
    // Old Amethyst builds created a vanilla-mainClass Forge stub by merely
    // extracting the installer. It looks like a loader profile by filename but
    // cannot load mods and must be repaired by running the real installer.
    if (meta.mainClass === 'net.minecraft.client.main.Main' && !loaderLibraries.includes(marker)) continue;
    if (wantedVersion && !searchable.includes(wantedVersion)) continue;
    if (gameVersion && meta.inheritsFrom && meta.inheritsFrom !== gameVersion && !searchable.includes(gameVersion.toLowerCase())) continue;
    return id;
  }
  return null;
}

async function listLoaderVersions(loader, gameVersion) {
  const kind = normalizeLoader(loader);
  if (kind === 'vanilla') return { loader: 'vanilla', versions: [{ version: 'vanilla', stable: true }] };
  if (!gameVersion) throw new Error('gameVersion is required for mod loader lookup');

  if (kind === 'fabric') return listFabricVersions(gameVersion);
  if (kind === 'quilt') return listQuiltVersions(gameVersion);
  if (kind === 'forge') return listForgeVersions(gameVersion);
  if (kind === 'neoforge') return listNeoForgeVersions(gameVersion);
  throw new Error(`Unknown mod loader: ${loader}`);
}

async function listFabricVersions(gameVersion) {
  try {
    const loaders = await fetchJson(
      `${FABRIC_META_URL}/versions/loader/${encodeURIComponent(gameVersion)}`,
      `Fabric loaders for ${gameVersion}`
    );
    return {
      loader: 'fabric',
      gameVersion,
      versions: (loaders || []).map((item) => ({
        version: item.loader?.version || item.version,
        stable: Boolean(item.loader?.stable ?? item.stable),
        intermediary: item.intermediary?.version,
        raw: item
      }))
    };
  } catch (error) {
    return { loader: 'fabric', gameVersion, versions: [], error: error.message };
  }
}

async function listQuiltVersions(gameVersion) {
  try {
    const loaders = await fetchJson(
      `${QUILT_META_URL}/versions/loader/${encodeURIComponent(gameVersion)}`,
      `Quilt loaders for ${gameVersion}`
    );
    return {
      loader: 'quilt',
      gameVersion,
      versions: (loaders || []).map((item) => ({
        version: item.loader?.version || item.version,
        stable: item.loader?.stable !== false,
        raw: item
      }))
    };
  } catch (error) {
    return { loader: 'quilt', gameVersion, versions: [], error: error.message };
  }
}

async function listForgeVersions(gameVersion) {
  try {
    // Forge promotes metadata: https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json
    // Also maven metadata lists all versions.
    const metaUrl = `${FORGE_MAVEN_URL}/net/minecraftforge/forge/maven-metadata.xml`;
    const response = await fetch(metaUrl, {
      headers: { 'User-Agent': 'AmethystLauncher/0.2' }
    });
    if (!response.ok) throw new Error(`Forge metadata HTTP ${response.status}`);
    const xml = await response.text();
    const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)]
      .map((m) => m[1])
      .filter((v) => v.startsWith(`${gameVersion}-`))
      .reverse();

    return {
      loader: 'forge',
      gameVersion,
      versions: versions.map((version, index) => ({
        version,
        stable: index === 0,
        installerUrl: `${FORGE_MAVEN_URL}/net/minecraftforge/forge/${version}/forge-${version}-installer.jar`
      }))
    };
  } catch (error) {
    return { loader: 'forge', gameVersion, versions: [], error: error.message };
  }
}

async function listNeoForgeVersions(gameVersion) {
  try {
    // NeoForge versioning: for 1.20.2+ versions look like 20.2.x derived from MC version.
    const metaUrl = `${NEOFORGE_MAVEN_URL}/net/neoforged/neoforge/maven-metadata.xml`;
    const response = await fetch(metaUrl, {
      headers: { 'User-Agent': 'AmethystLauncher/0.2' }
    });
    if (!response.ok) throw new Error(`NeoForge metadata HTTP ${response.status}`);
    const xml = await response.text();
    const all = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);

    // Map MC 1.21.1 -> 21.1.x, MC 1.20.4 -> 20.4.x
    const mcMatch = String(gameVersion).match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
    let filtered = all;
    if (mcMatch) {
      const major = mcMatch[1];
      const minor = mcMatch[2];
      const patch = mcMatch[3] || '0';
      if (Number(minor) >= 20 || Number(major) > 1) {
        // NeoForge uses {minor}.{patch}.x for 1.20.2+
        const prefix = `${minor}.${patch}.`;
        const alt = `${minor}.${Number(patch)}.`;
        filtered = all.filter((v) => v.startsWith(prefix) || v.startsWith(alt) || v.includes(gameVersion));
      } else {
        filtered = all.filter((v) => v.includes(gameVersion));
      }
    }

    filtered = filtered.reverse();
    return {
      loader: 'neoforge',
      gameVersion,
      versions: filtered.map((version, index) => ({
        version,
        stable: index === 0,
        installerUrl: `${NEOFORGE_MAVEN_URL}/net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar`
      }))
    };
  } catch (error) {
    return { loader: 'neoforge', gameVersion, versions: [], error: error.message };
  }
}

/**
 * Install a mod loader profile into the shared versions folder and return the profile version id.
 */
async function installLoader(loader, gameVersion, loaderVersion, options = {}) {
  const kind = normalizeLoader(loader);
  if (kind === 'vanilla') {
    return { versionId: gameVersion, loader: 'vanilla' };
  }
  if (kind === 'fabric') return installFabric(gameVersion, loaderVersion, options);
  if (kind === 'quilt') return installQuilt(gameVersion, loaderVersion, options);
  if (kind === 'forge') return installForgeLike('forge', gameVersion, loaderVersion, options);
  if (kind === 'neoforge') return installForgeLike('neoforge', gameVersion, loaderVersion, options);
  throw new Error(`Unknown mod loader: ${loader}`);
}

async function installFabric(gameVersion, loaderVersion, options = {}) {
  progressBus.emitEvent('status', { message: `Installing Fabric ${loaderVersion} for ${gameVersion}…` });

  let selectedLoader = loaderVersion;
  if (!selectedLoader) {
    const listed = await listFabricVersions(gameVersion);
    selectedLoader = listed.versions.find((v) => v.stable)?.version || listed.versions[0]?.version;
  }
  if (!selectedLoader) throw new Error(`No Fabric loader available for Minecraft ${gameVersion}`);

  const profileUrl = `${FABRIC_META_URL}/versions/loader/${encodeURIComponent(gameVersion)}/${encodeURIComponent(selectedLoader)}/profile/json`;
  const profile = await fetchJson(profileUrl, `Fabric profile ${gameVersion}/${selectedLoader}`);
  const versionId = profile.id || `fabric-loader-${selectedLoader}-${gameVersion}`;

  const gameDir = options.gameDir || path.join(require('../config').getDataRoot(), 'minecraft');
  const paths = gamePaths(gameDir, versionId);
  await ensureDir(paths.versionDir);
  await writeJson(paths.versionJson, profile);

  // Download loader libraries referenced in the profile.
  await downloadProfileLibraries(profile, paths, options.concurrency || 8);

  progressBus.emitEvent('status', { message: `Fabric profile ${versionId} ready` });
  return { versionId, loader: 'fabric', loaderVersion: selectedLoader, profile };
}

async function installQuilt(gameVersion, loaderVersion, options = {}) {
  progressBus.emitEvent('status', { message: `Installing Quilt ${loaderVersion || ''} for ${gameVersion}…` });

  let selectedLoader = loaderVersion;
  if (!selectedLoader) {
    const listed = await listQuiltVersions(gameVersion);
    selectedLoader = listed.versions[0]?.version;
  }
  if (!selectedLoader) throw new Error(`No Quilt loader available for Minecraft ${gameVersion}`);

  const profileUrl = `${QUILT_META_URL}/versions/loader/${encodeURIComponent(gameVersion)}/${encodeURIComponent(selectedLoader)}/profile/json`;
  const profile = await fetchJson(profileUrl, `Quilt profile ${gameVersion}/${selectedLoader}`);
  const versionId = profile.id || `quilt-loader-${selectedLoader}-${gameVersion}`;

  const gameDir = options.gameDir || path.join(require('../config').getDataRoot(), 'minecraft');
  const paths = gamePaths(gameDir, versionId);
  await ensureDir(paths.versionDir);
  await writeJson(paths.versionJson, profile);
  await downloadProfileLibraries(profile, paths, options.concurrency || 8);

  progressBus.emitEvent('status', { message: `Quilt profile ${versionId} ready` });
  return { versionId, loader: 'quilt', loaderVersion: selectedLoader, profile };
}

/**
 * Install Forge / NeoForge with its official installer. Extracting version.json
 * alone is not enough: modern installers run processors, create patched jars,
 * and download bootstrap libraries. Skipping those steps produces a profile
 * that starts as vanilla (or fails before the loader can discover mods).
 */
async function installForgeLike(kind, gameVersion, loaderVersion, options = {}) {
  const label = kind === 'neoforge' ? 'NeoForge' : 'Forge';
  progressBus.emitEvent('status', { message: `Preparing ${label} ${loaderVersion || ''} for ${gameVersion}…` });

  let selected = String(loaderVersion || '');
  if (!selected) {
    const listed = kind === 'neoforge'
      ? await listNeoForgeVersions(gameVersion)
      : await listForgeVersions(gameVersion);
    selected = listed.versions[0]?.version || '';
  }
  if (!selected) throw new Error(`No ${label} version available for Minecraft ${gameVersion}`);

  const forgeFullVersion = kind === 'forge' ? normalizeForgeVersion(gameVersion, selected) : selected;
  const resolvedLoaderVersion = kind === 'forge' && selected.startsWith(`${gameVersion}-`)
    ? selected.slice(gameVersion.length + 1)
    : selected;
  const gameDir = options.gameDir || path.join(require('../config').getDataRoot(), 'minecraft');

  const existingVersionId = await findInstalledLoaderProfile(kind, gameVersion, resolvedLoaderVersion, gameDir);
  if (existingVersionId) {
    const profile = await readJson(path.join(gameDir, 'versions', existingVersionId, `${existingVersionId}.json`), null);
    return {
      versionId: existingVersionId,
      loader: kind,
      loaderVersion: resolvedLoaderVersion,
      profile,
      skipped: true
    };
  }

  const installerUrl = kind === 'neoforge'
    ? `${NEOFORGE_MAVEN_URL}/net/neoforged/neoforge/${selected}/neoforge-${selected}-installer.jar`
    : `${FORGE_MAVEN_URL}/net/minecraftforge/forge/${forgeFullVersion}/forge-${forgeFullVersion}-installer.jar`;
  const cacheDir = path.join(require('../config').getDataRoot(), 'cache', kind);
  await ensureDir(cacheDir);
  const installerPath = path.join(cacheDir, path.basename(new URL(installerUrl).pathname));
  await downloadFile(installerUrl, installerPath, { label: `${label} installer ${resolvedLoaderVersion}` });

  let javaPath = options.javaPath;
  if (!javaPath) {
    const { readSettings } = require('./accounts');
    const { recommendedJavaMajor } = require('./javaLocator');
    const { resolveJavaForLaunch, autoDownloadIfMissing } = require('./javaManager');
    const parentMeta = await readJson(path.join(gameDir, 'versions', gameVersion, `${gameVersion}.json`), null)
      || await getVersionMeta(gameVersion);
    const requiredMajor = recommendedJavaMajor(parentMeta);
    const settings = await readSettings();
    const java = await resolveJavaForLaunch(requiredMajor, settings.javaPath)
      || (options.autoDownloadJava === false ? null : await autoDownloadIfMissing(requiredMajor));
    javaPath = java?.path;
  }
  if (!javaPath) throw new Error(`No compatible Java runtime found for the ${label} installer.`);

  await runForgeInstaller({
    javaPath,
    installerPath,
    gameDir,
    cwd: cacheDir,
    loader: kind,
    loaderVersion: resolvedLoaderVersion,
    minecraftVersion: gameVersion,
    modpackName: options.name || options.modpackName || `Amethyst ${label} ${gameVersion}`
  });

  const versionId = await findInstalledLoaderVersion(gameDir, {
    loader: kind,
    loaderVersion: resolvedLoaderVersion
  });
  if (!versionId) {
    throw new Error(`${label} installer completed, but no ${resolvedLoaderVersion} profile was created.`);
  }
  const profile = await readJson(path.join(gameDir, 'versions', versionId, `${versionId}.json`), null);
  if (!profile) throw new Error(`${label} profile ${versionId} is unreadable after installation.`);

  progressBus.emitEvent('status', { message: `${label} profile ${versionId} ready` });
  return {
    versionId,
    loader: kind,
    loaderVersion: resolvedLoaderVersion,
    installerPath,
    profile
  };
}

async function downloadProfileLibraries(profile, paths, concurrency = 8) {
  const { mapLimit } = require('./downloader');
  const libraries = profile.libraries || [];
  const downloads = [];

  for (const library of libraries) {
    const artifact = library.downloads?.artifact;
    if (artifact?.url && artifact?.path) {
      downloads.push({
        url: artifact.url,
        destination: path.join(paths.libraries, artifact.path),
        sha1: artifact.sha1,
        size: artifact.size,
        label: library.name || artifact.path
      });
      continue;
    }
    // Maven-style name without explicit downloads block.
    if (library.name && library.url) {
      const rel = artifactPathFromName(library.name);
      if (rel) {
        const normalized = rel.replaceAll('\\', '/');
        const base = library.url.endsWith('/') ? library.url : `${library.url}/`;
        downloads.push({
          url: new URL(normalized, base).toString(),
          destination: path.join(paths.libraries, normalized),
          label: library.name
        });
      }
    }
  }

  if (!downloads.length) return;
  progressBus.emitEvent('status', { message: `Downloading ${downloads.length} loader libraries` });
  await mapLimit(downloads, concurrency, (item) => downloadFile(item.url, item.destination, item));
}

async function extractZipEntries(filePath) {
  const zlib = require('node:zlib');
  const buf = await fs.readFile(filePath);
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error('Not a valid installer JAR/ZIP');

  const cdEntries = buf.readUInt16LE(eocdOffset + 8);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  const entries = [];
  let pos = cdOffset;

  for (let i = 0; i < cdEntries; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;
    const compressionMethod = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const fileNameLength = buf.readUInt16LE(pos + 28);
    const extraFieldLength = buf.readUInt16LE(pos + 30);
    const commentLength = buf.readUInt16LE(pos + 32);
    const localHeaderOffset = buf.readUInt32LE(pos + 42);
    const entryName = buf.toString('utf8', pos + 46, pos + 46 + fileNameLength);
    pos += 46 + fileNameLength + extraFieldLength + commentLength;
    if (entryName.endsWith('/')) continue;

    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const localFileNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const dataOffset = localHeaderOffset + 30 + localFileNameLen + localExtraLen;
    const compressed = buf.subarray(dataOffset, dataOffset + compressedSize);
    let data;
    if (compressionMethod === 0) data = Buffer.from(compressed);
    else if (compressionMethod === 8) data = zlib.inflateRawSync(compressed);
    else continue;
    entries.push({ name: entryName, data });
  }
  return entries;
}

module.exports = {
  LOADERS,
  normalizeLoader,
  loaderVersionId,
  findInstalledLoaderProfile,
  listLoaderVersions,
  installLoader,
  listFabricVersions,
  listQuiltVersions,
  listForgeVersions,
  listNeoForgeVersions
};
