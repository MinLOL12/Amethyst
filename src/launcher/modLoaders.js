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
 * Forge / NeoForge: run the official installer, then locate the installed profile.
 * Falls back to extracting version.json if the installer cannot be executed (e.g. no Java).
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

  // Normalize Forge versions: the version list returns full "<mc>-<forge>" strings,
  // but callers (modpacks, UI) sometimes pass just the forge build number.
  let fullVersion = selected;
  let mavenVersion = selected;
  if (kind === 'forge') {
    if (selected.startsWith(`${gameVersion}-`)) {
      fullVersion = selected;
      mavenVersion = selected;
    } else {
      fullVersion = `${gameVersion}-${selected}`;
      mavenVersion = fullVersion;
    }
  } else {
    // NeoForge: version is already the maven coordinate.
    fullVersion = selected;
    mavenVersion = selected;
  }

  const installerUrl = kind === 'neoforge'
    ? `${NEOFORGE_MAVEN_URL}/net/neoforged/neoforge/${mavenVersion}/neoforge-${mavenVersion}-installer.jar`
    : `${FORGE_MAVEN_URL}/net/minecraftforge/forge/${mavenVersion}/forge-${mavenVersion}-installer.jar`;

  const gameDir = options.gameDir || path.join(require('../config').getDataRoot(), 'minecraft');
  const cacheDir = path.join(require('../config').getDataRoot(), 'cache', kind);
  await ensureDir(cacheDir);
  const installerPath = path.join(cacheDir, path.basename(new URL(installerUrl).pathname));

  await downloadFile(installerUrl, installerPath, {
    label: `${label} installer ${mavenVersion}`
  });

  // Ensure the base vanilla version is fully installed before running the Forge/NeoForge installer,
  // matching the official installer's expectations and the modpack flow.
  try {
    const { installVersion } = require('./minecraft');
    // Explicitly run a vanilla install to populate client jar, libraries, assets.
    await installVersion(gameVersion, {
      gameDir,
      loader: 'vanilla',
      concurrency: options.concurrency || 8,
      skipExistingCheck: true
    });
  } catch (error) {
    progressBus.emitEvent('status', { message: `Warning: vanilla pre-install failed: ${error.message}` });
  }

  // Try to run the official installer so modern Forge/NeoForge (1.13+) processors execute.
  let installerSucceeded = false;
  let detectedVersionId = null;
  try {
    // Dynamically require java helpers to avoid circular dependency at module load time.
    const { pickJava, recommendedJavaRequirement } = require('./javaLocator');
    const { resolveJavaForLaunch, autoDownloadIfMissing } = require('./javaManager');
    const { runForgeInstaller, findInstalledLoaderVersion } = require('./forgeInstaller');
    const { getVersionMeta } = require('./mojangApi');

    // Determine which Java major the target Minecraft version recommends.
    let requiredMajor = 17;
    try {
      const vanillaMeta = await getVersionMeta(gameVersion);
      const req = recommendedJavaRequirement(vanillaMeta);
      requiredMajor = req.major || recommendedJavaMajor(vanillaMeta) || 17;
    } catch (_) {
      requiredMajor = gameVersion.startsWith('1.20') || gameVersion.startsWith('1.21') ? 17 : 8;
    }

    let java = null;
    // 1) explicit javaPath in options (per-instance override)
    if (options.javaPath) {
      try { java = await pickJava(requiredMajor, options.javaPath); } catch (_) {}
    }
    // 2) resolve via settings / managed runtimes
    if (!java) {
      try { java = await resolveJavaForLaunch(requiredMajor, ''); } catch (_) {}
    }
    // 3) auto-download if missing and allowed
    if (!java && options.autoDownloadJava !== false) {
      try { java = await autoDownloadIfMissing(requiredMajor); } catch (error) {
        progressBus.emitEvent('status', { message: `Java auto-download failed: ${error.message}` });
      }
    }
    // 4) last-ditch: pick any available Java
    if (!java) {
      try { java = await pickJava(requiredMajor, ''); } catch (_) {}
    }

    if (java && java.path) {
      // Forge expects the gameDir to look like a vanilla launcher folder.
      await runForgeInstaller({
        javaPath: java.path,
        installerPath,
        gameDir,
        cwd: path.dirname(installerPath),
        loader: kind,
        loaderVersion: kind === 'forge' ? fullVersion.replace(`${gameVersion}-`, '') : mavenVersion,
        minecraftVersion: gameVersion,
        modpackName: options.modpackName || `Amethyst ${label}`
      });
      installerSucceeded = true;

      // Locate the profile the installer just created.
      const forgeBuild = kind === 'forge' ? fullVersion.replace(`${gameVersion}-`, '') : mavenVersion;
      detectedVersionId = await findInstalledLoaderVersion(gameDir, {
        loader: kind,
        loaderVersion: forgeBuild
      });
      // Some installers register the full "<mc>-<forge>" string; try that too.
      if (!detectedVersionId && kind === 'forge') {
        detectedVersionId = await findInstalledLoaderVersion(gameDir, {
          loader: kind,
          loaderVersion: fullVersion
        });
      }
    } else {
      progressBus.emitEvent('status', { message: `${label} installer skipped: no compatible Java ${requiredMajor}+ found` });
    }
  } catch (installerError) {
    progressBus.emitEvent('status', { message: `${label} installer failed: ${installerError.message} — falling back to profile extraction` });
    installerSucceeded = false;
  }

  // If the installer ran and produced a version profile, use it.
  if (installerSucceeded && detectedVersionId) {
    const profilePath = path.join(gameDir, 'versions', detectedVersionId, `${detectedVersionId}.json`);
    let profile = null;
    try {
      profile = await readJson(profilePath, null);
    } catch (_) {
      profile = null;
    }
    if (profile) {
      const paths = gamePaths(gameDir, detectedVersionId);
      await ensureDir(paths.versionDir);
      // Ensure libraries referenced by the installed profile are present.
      await downloadProfileLibraries(profile, paths, options.concurrency || 8);
      progressBus.emitEvent('status', { message: `${label} profile ${detectedVersionId} ready` });
      return {
        versionId: detectedVersionId,
        loader: kind,
        loaderVersion: kind === 'forge' ? fullVersion.replace(`${gameVersion}-`, '') : mavenVersion,
        installerPath,
        profile,
        installedViaInstaller: true
      };
    }
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

  // Fallback: extract version.json from the installer jar (works for older Forge).
  try {
    const entries = await extractZipEntries(installerPath);
    const versionEntry =
      entries.find((e) => e.name === 'version.json') ||
      entries.find((e) => e.name.endsWith('/version.json')) ||
      entries.find((e) => /version\.json$/i.test(e.name));

    if (versionEntry) {
      const profile = JSON.parse(versionEntry.data.toString('utf8'));
      const versionId = profile.id || (kind === 'neoforge' ? `neoforge-${mavenVersion}` : `${gameVersion}-forge-${mavenVersion}`) || detectedVersionId || fullVersion;
      profile.id = versionId;
      if (!profile.inheritsFrom) profile.inheritsFrom = gameVersion;

      const paths = gamePaths(gameDir, versionId);
      await ensureDir(paths.versionDir);
      await writeJson(paths.versionJson, profile);
      await downloadProfileLibraries(profile, paths, options.concurrency || 8);

      // Also ensure vanilla parent exists as metadata.
      try {
        const parentId = profile.inheritsFrom || gameVersion;
        const parentMeta = await getVersionMeta(parentId);
        const parentPaths = gamePaths(gameDir, parentId);
        await ensureDir(parentPaths.versionDir);
        await writeJson(parentPaths.versionJson, parentMeta);
      } catch (_) {
        // Parent may already be installed or offline.
      }

      progressBus.emitEvent('status', { message: `${label} profile ${versionId} ready (extracted)` });
      return { versionId, loader: kind, loaderVersion: selected, installerPath, profile, installedViaInstaller: false };
    }
  } catch (extractError) {
    progressBus.emitEvent('status', { message: `${label} profile extraction failed: ${extractError.message}` });
  }

  // Last resort: create a thin inheriting profile so the game at least launches vanilla,
  // but mark it clearly so users know loader libraries are missing.
  const fallbackVersionId = kind === 'neoforge'
    ? `neoforge-${mavenVersion}`
    : `${gameVersion}-forge-${fullVersion.replace(`${gameVersion}-`, '')}`;
  const paths = gamePaths(gameDir, fallbackVersionId);
  await ensureDir(paths.versionDir);
  const stub = {
    id: fallbackVersionId,
    inheritsFrom: gameVersion,
    time: new Date().toISOString(),
    releaseTime: new Date().toISOString(),
    type: 'release',
    mainClass: 'net.minecraft.client.main.Main',
    libraries: [],
    arguments: { game: [], jvm: [] },
    _amethyst: {
      loader: kind,
      loaderVersion: selected,
      installerPath,
      installerSucceeded,
      detectedVersionId,
      note: installerSucceeded
        ? `${label} installer ran but no version profile was detected. Launching vanilla fallback.`
        : `${label} installer could not run (missing Java?). Launching vanilla fallback; install Java ${gameVersion.startsWith('1.18') || gameVersion.startsWith('1.19') || gameVersion.startsWith('1.20') || gameVersion.startsWith('1.21') ? '17' : '8'}+ to enable ${label}.`
    }
  };
  await writeJson(paths.versionJson, stub);
  // Ensure base vanilla is available.
  try {
    const vanillaMeta = await getVersionMeta(gameVersion);
    const vanillaPaths = gamePaths(gameDir, gameVersion);
    await ensureDir(vanillaPaths.versionDir);
    await writeJson(vanillaPaths.versionJson, vanillaMeta);
  } catch (_) {}

  progressBus.emitEvent('status', {
    message: `${label} installer did not produce a loader profile — using vanilla fallback ${fallbackVersionId}.`
  });
  return { versionId: fallbackVersionId, loader: kind, loaderVersion: selected, installerPath, profile: stub, installedViaInstaller: installerSucceeded, fallback: true };
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
