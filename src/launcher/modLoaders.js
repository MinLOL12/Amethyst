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

const LOADERS = ['vanilla', 'fabric', 'forge', 'neoforge', 'quilt'];

async function listLoaderVersions(loader, gameVersion) {
  const kind = String(loader || 'vanilla').toLowerCase();
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
  const kind = String(loader || 'vanilla').toLowerCase();
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
 * Forge / NeoForge: download installer jar and extract the version profile from it.
 * Full installer execution is complex; we extract version.json / install_profile.json
 * and download required libraries when the profile is present.
 */
async function installForgeLike(kind, gameVersion, loaderVersion, options = {}) {
  const label = kind === 'neoforge' ? 'NeoForge' : 'Forge';
  progressBus.emitEvent('status', { message: `Preparing ${label} ${loaderVersion || ''} for ${gameVersion}…` });

  let selected = loaderVersion;
  if (!selected) {
    const listed = kind === 'neoforge'
      ? await listNeoForgeVersions(gameVersion)
      : await listForgeVersions(gameVersion);
    selected = listed.versions[0]?.version;
  }
  if (!selected) throw new Error(`No ${label} version available for Minecraft ${gameVersion}`);

  const installerUrl = kind === 'neoforge'
    ? `${NEOFORGE_MAVEN_URL}/net/neoforged/neoforge/${selected}/neoforge-${selected}-installer.jar`
    : `${FORGE_MAVEN_URL}/net/minecraftforge/forge/${selected}/forge-${selected}-installer.jar`;

  const gameDir = options.gameDir || path.join(require('../config').getDataRoot(), 'minecraft');
  const cacheDir = path.join(require('../config').getDataRoot(), 'cache', kind);
  await ensureDir(cacheDir);
  const installerPath = path.join(cacheDir, path.basename(new URL(installerUrl).pathname));

  await downloadFile(installerUrl, installerPath, {
    label: `${label} installer ${selected}`
  });

  // Extract version.json from the installer jar.
  const entries = await extractZipEntries(installerPath);
  const versionEntry =
    entries.find((e) => e.name === 'version.json') ||
    entries.find((e) => e.name.endsWith('/version.json')) ||
    entries.find((e) => /version\.json$/i.test(e.name));

  if (!versionEntry) {
    // Fallback: create a thin profile that points users to run the installer once.
    const versionId = kind === 'neoforge'
      ? `neoforge-${selected}`
      : `${gameVersion}-forge-${selected}`;
    const paths = gamePaths(gameDir, versionId);
    await ensureDir(paths.versionDir);
    const stub = {
      id: versionId,
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
        note: `${label} installer downloaded. Full client install may require running the official installer once if libraries are missing.`
      }
    };
    await writeJson(paths.versionJson, stub);
    // Ensure base vanilla is available.
    const vanillaMeta = await getVersionMeta(gameVersion);
    const vanillaPaths = gamePaths(gameDir, gameVersion);
    await ensureDir(vanillaPaths.versionDir);
    await writeJson(vanillaPaths.versionJson, vanillaMeta);

    progressBus.emitEvent('status', {
      message: `${label} installer cached. Profile ${versionId} created (inherits ${gameVersion}).`
    });
    return { versionId, loader: kind, loaderVersion: selected, installerPath, profile: stub };
  }

  const profile = JSON.parse(versionEntry.data.toString('utf8'));
  const versionId = profile.id || (kind === 'neoforge' ? `neoforge-${selected}` : `${gameVersion}-forge-${selected}`);
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

  progressBus.emitEvent('status', { message: `${label} profile ${versionId} ready` });
  return { versionId, loader: kind, loaderVersion: selected, installerPath, profile };
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
  listLoaderVersions,
  installLoader,
  listFabricVersions,
  listQuiltVersions,
  listForgeVersions,
  listNeoForgeVersions
};
