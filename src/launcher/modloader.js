/**
 * Amethyst Mod Loader Support
 *
 * Handles installing and resolving mod loaders (Fabric, Quilt, Forge) so that
 * mods placed in the game directory's `mods/` folder actually load at runtime.
 *
 * The key concept is `inheritsFrom`: a mod-loader version JSON declares
 * `inheritsFrom: "<vanilla-version-id>"`.  When we launch, we resolve the
 * chain top-down (mod-loader → vanilla), merge libraries/arguments, and use
 * the child's `mainClass`.
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const { FABRIC_META_URL, QUILT_META_URL, FORGE_MAVEN_URL, FORGE_PROMOTIONS_URL } = require('../config');
const { fetchJson, downloadFile, progressBus } = require('./downloader');
const { ensureDir, readJson, writeJson } = require('./store');
const { getVersionMeta } = require('./mojangApi');

// ── Fabric ──────────────────────────────────────────────────────────

async function listFabricLoaders() {
  try {
    return await fetchJson(`${FABRIC_META_URL}/versions/loader`, 'Fabric loader versions');
  } catch {
    return [];
  }
}

async function listFabricGameVersions() {
  try {
    return await fetchJson(`${FABRIC_META_URL}/versions/game`, 'Fabric game versions');
  } catch {
    return [];
  }
}

/**
 * Fetch the complete Fabric profile JSON for a specific MC + loader combo.
 * This JSON is a fully-formed Minecraft version JSON with `inheritsFrom` set.
 */
async function getFabricProfile(mcVersion, loaderVersion) {
  const url = `${FABRIC_META_URL}/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`;
  return fetchJson(url, `Fabric profile for ${mcVersion}+${loaderVersion}`);
}

// ── Quilt ───────────────────────────────────────────────────────────

async function listQuiltLoaders() {
  try {
    return await fetchJson(`${QUILT_META_URL}/versions/loader`, 'Quilt loader versions');
  } catch {
    return [];
  }
}

async function listQuiltGameVersions() {
  try {
    return await fetchJson(`${QUILT_META_URL}/versions/game`, 'Quilt game versions');
  } catch {
    return [];
  }
}

async function getQuiltProfile(mcVersion, loaderVersion) {
  const url = `${QUILT_META_URL}/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`;
  return fetchJson(url, `Quilt profile for ${mcVersion}+${loaderVersion}`);
}

// ── Forge ───────────────────────────────────────────────────────────

async function listForgeVersions() {
  try {
    const data = await fetchJson(FORGE_PROMOTIONS_URL, 'Forge promotions');
    return data.promos || {};
  } catch {
    return {};
  }
}

/**
 * Download the Forge installer JAR and extract the version JSON from it.
 * Forge installers are self-contained JARs (ZIP files) that contain
 * `version.json` (the version JSON) and `install_profile.json` (metadata
 * about the install process).
 */
async function installForgeVersion(mcVersion, forgeVersion, gameDir) {
  const forgeFullVersion = `${mcVersion}-${forgeVersion}`;
  const installerUrl = `${FORGE_MAVEN_URL}/net/minecraftforge/forge/${forgeFullVersion}/forge-${forgeFullVersion}-installer.jar`;
  const versionsDir = path.join(gameDir, 'versions');
  const forgeVersionDir = path.join(versionsDir, `forge-${forgeFullVersion}`);
  const installerPath = path.join(forgeVersionDir, `forge-${forgeFullVersion}-installer.jar`);

  await ensureDir(forgeVersionDir);

  progressBus.emitEvent('status', { message: `Downloading Forge ${forgeFullVersion} installer` });
  await downloadFile(installerUrl, installerPath, {
    label: `Forge ${forgeFullVersion} installer`
  });

  // Extract version.json and install_profile.json from the installer JAR
  const zlib = require('node:zlib');
  const buf = await fs.readFile(installerPath);

  // Locate EOCD
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error('Invalid Forge installer JAR');

  const cdEntries = buf.readUInt16LE(eocdOffset + 8);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);

  let versionJson = null;
  let installProfile = null;

  let pos = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;

    const compressionMethod = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const uncompressedSize = buf.readUInt32LE(pos + 24);
    const fileNameLength = buf.readUInt16LE(pos + 28);
    const extraFieldLength = buf.readUInt16LE(pos + 30);
    const commentLength = buf.readUInt16LE(pos + 32);
    const localHeaderOffset = buf.readUInt32LE(pos + 42);
    const entryName = buf.toString('utf8', pos + 46, pos + 46 + fileNameLength);

    pos += 46 + fileNameLength + extraFieldLength + commentLength;

    if (entryName === 'version.json' || entryName === 'install_profile.json') {
      const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
      const localFileNameLen = buf.readUInt16LE(localHeaderOffset + 26);
      const dataOffset = localHeaderOffset + 30 + localFileNameLen + localExtraLen;
      const compressed = buf.slice(dataOffset, dataOffset + compressedSize);

      let content;
      if (compressionMethod === 0) {
        content = compressed;
      } else if (compressionMethod === 8) {
        content = zlib.inflateRawSync(compressed);
      } else {
        continue;
      }

      const text = content.toString('utf8');
      if (entryName === 'version.json') versionJson = JSON.parse(text);
      if (entryName === 'install_profile.json') installProfile = JSON.parse(text);
    }
  }

  // Build the Forge version JSON
  let forgeVersionMeta;

  if (versionJson) {
    // Modern Forge (1.13+) embeds version.json directly
    forgeVersionMeta = versionJson;
  } else if (installProfile) {
    // Legacy Forge (pre-1.13) stores the version info in install_profile.json
    forgeVersionMeta = installProfile.versionInfo || installProfile;
    if (!forgeVersionMeta.id) {
      forgeVersionMeta.id = `forge-${forgeFullVersion}`;
    }
  } else {
    throw new Error('Could not extract version data from Forge installer');
  }

  // Ensure inheritsFrom is set
  if (!forgeVersionMeta.inheritsFrom) {
    forgeVersionMeta.inheritsFrom = mcVersion;
  }
  if (!forgeVersionMeta.jar) {
    forgeVersionMeta.jar = mcVersion;
  }

  // Write the version JSON
  const versionJsonPath = path.join(forgeVersionDir, `${forgeVersionMeta.id}.json`);
  await writeJson(versionJsonPath, forgeVersionMeta);

  // Also copy the installer as a library (some Forge versions reference it)
  const installerLibPath = path.join(
    gameDir, 'libraries', 'net', 'minecraftforge', 'forge', forgeFullVersion,
    `forge-${forgeFullVersion}-installer.jar`
  );
  // The installer is sometimes referenced as a library for processors
  // but for basic launch we don't need to copy it as a lib

  progressBus.emitEvent('status', { message: `Forge ${forgeFullVersion} profile installed` });
  return forgeVersionMeta;
}

// ── Unified API ─────────────────────────────────────────────────────

/**
 * List available mod loaders for a given Minecraft version.
 * Returns { fabric: [...], quilt: [...], forge: { latest, recommended } }
 */
async function listModLoaders(mcVersion) {
  const result = { fabric: [], quilt: [], forge: {} };

  const [fabricLoaders, quiltLoaders, forgePromos] = await Promise.all([
    listFabricLoaders().catch(() => []),
    listQuiltLoaders().catch(() => []),
    listForgeVersions().catch(() => ({}))
  ]);

  // Fabric loaders
  result.fabric = fabricLoaders
    .filter((l) => l.stable)
    .map((l) => ({ version: l.version, stable: l.stable }));

  // Quilt loaders
  result.quilt = quiltLoaders
    .filter((l) => !l.unstable)
    .map((l) => ({ version: l.version, stable: !l.unstable }));

  // Forge versions — extract from promotions for this MC version
  const prefix = `${mcVersion}-`;
  const forgeEntries = {};
  for (const [key, value] of Object.entries(forgePromos)) {
    if (key.startsWith(prefix)) {
      const label = key.slice(prefix.length); // e.g. "latest", "recommended"
      forgeEntries[label] = value;
    }
  }
  result.forge = forgeEntries;

  return result;
}

/**
 * Install a mod loader for the given Minecraft version.
 * Returns the mod-loader version JSON.
 */
async function installModLoader(loaderType, loaderVersion, mcVersion, gameDir) {
  if (!loaderType || !loaderVersion || !mcVersion) {
    throw new Error('loaderType, loaderVersion, and mcVersion are required');
  }

  const versionsDir = path.join(gameDir, 'versions');

  switch (loaderType) {
    case 'fabric': {
      const profile = await getFabricProfile(mcVersion, loaderVersion);
      const versionId = profile.id || `fabric-loader-${loaderVersion}-${mcVersion}`;
      const versionDir = path.join(versionsDir, versionId);
      await ensureDir(versionDir);
      await writeJson(path.join(versionDir, `${versionId}.json`), profile);
      progressBus.emitEvent('status', { message: `Fabric Loader ${loaderVersion} for ${mcVersion} installed` });
      return profile;
    }

    case 'quilt': {
      const profile = await getQuiltProfile(mcVersion, loaderVersion);
      const versionId = profile.id || `quilt-loader-${loaderVersion}-${mcVersion}`;
      const versionDir = path.join(versionsDir, versionId);
      await ensureDir(versionDir);
      await writeJson(path.join(versionDir, `${versionId}.json`), profile);
      progressBus.emitEvent('status', { message: `Quilt Loader ${loaderVersion} for ${mcVersion} installed` });
      return profile;
    }

    case 'forge': {
      return installForgeVersion(mcVersion, loaderVersion, gameDir);
    }

    default:
      throw new Error(`Unknown mod loader type: ${loaderType}`);
  }
}

/**
 * Compute the version ID that a mod-loader + MC-version combination produces.
 */
function modLoaderVersionId(loaderType, loaderVersion, mcVersion) {
  switch (loaderType) {
    case 'fabric': return `fabric-loader-${loaderVersion}-${mcVersion}`;
    case 'quilt': return `quilt-loader-${loaderVersion}-${mcVersion}`;
    case 'forge': return `${mcVersion}-forge-${loaderVersion}`;
    default: return mcVersion;
  }
}

/**
 * Resolve the full version chain for a given version ID.
 *
 * If the version JSON has `inheritsFrom`, we load the parent, then the
 * grandparent, etc., and merge them into a single effective version meta.
 *
 * The child's `mainClass` wins; libraries are merged (child first, deduped);
 * arguments are concatenated (child first).
 */
async function resolveVersionChain(versionId, gameDir) {
  const versionsDir = path.join(gameDir, 'versions');

  async function loadLocalOrRemote(vid) {
    const localPath = path.join(versionsDir, vid, `${vid}.json`);
    try {
      const raw = await fs.readFile(localPath, 'utf8');
      return JSON.parse(raw);
    } catch {
      // Not installed locally — try Mojang
      return getVersionMeta(vid);
    }
  }

  const chain = [];
  let current = versionId;
  const visited = new Set();

  while (current) {
    if (visited.has(current)) break;
    visited.add(current);

    const meta = await loadLocalOrRemote(current);
    chain.push(meta);

    current = meta.inheritsFrom || null;
  }

  if (chain.length === 0) throw new Error(`Could not resolve version ${versionId}`);
  if (chain.length === 1) return chain[0]; // vanilla, no inheritance

  // Merge from parent (last) to child (first)
  // Start with a deep copy of the parent
  const parent = chain[chain.length - 1];
  const merged = JSON.parse(JSON.stringify(parent));

  // Walk from second-to-last back to first (children override parents)
  for (let i = chain.length - 2; i >= 0; i--) {
    const child = chain[i];

    // Child's id and mainClass win
    merged.id = child.id || merged.id;
    if (child.mainClass) merged.mainClass = child.mainClass;

    // Merge libraries: child first, then parent (skip duplicates by name)
    if (child.libraries) {
      const childLibNames = new Set(child.libraries.map((l) => l.name));
      // Remove parent libs that child overrides
      merged.libraries = (merged.libraries || []).filter((l) => !childLibNames.has(l.name));
      // Prepend child libs
      merged.libraries = [...child.libraries, ...(merged.libraries || [])];
    }

    // Merge arguments
    if (child.arguments) {
      if (child.arguments.jvm) {
        merged.arguments = merged.arguments || {};
        merged.arguments.jvm = [
          ...(child.arguments.jvm || []),
          ...(merged.arguments.jvm || [])
        ];
      }
      if (child.arguments.game) {
        merged.arguments = merged.arguments || {};
        merged.arguments.game = [
          ...(child.arguments.game || []),
          ...(merged.arguments.game || [])
        ];
      }
    }

    // If child has minecraftArguments (legacy), prefer child's
    if (child.minecraftArguments) {
      merged.minecraftArguments = child.minecraftArguments;
    }

    // Child's type wins
    if (child.type) merged.type = child.type;

    // Merge downloads if child has them
    if (child.downloads) {
      merged.downloads = { ...merged.downloads, ...child.downloads };
    }

    // Merge assetIndex — child may define its own
    if (child.assetIndex) merged.assetIndex = child.assetIndex;
    if (child.assets) merged.assets = child.assets;

    // javaVersion from child if present
    if (child.javaVersion) merged.javaVersion = child.javaVersion;
  }

  // Clear inheritsFrom on the merged result so we don't loop again
  delete merged.inheritsFrom;
  delete merged.jar;

  return merged;
}

/**
 * Check which mod loaders are already installed locally for a given MC version.
 */
async function getInstalledLoaders(mcVersion, gameDir) {
  const versionsDir = path.join(gameDir, 'versions');
  const installed = { fabric: null, quilt: null, forge: null };

  try {
    const dirs = await fs.readdir(versionsDir);
    for (const dir of dirs) {
      try {
        const jsonPath = path.join(versionsDir, dir, `${dir}.json`);
        const raw = await fs.readFile(jsonPath, 'utf8');
        const meta = JSON.parse(raw);

        if (meta.inheritsFrom !== mcVersion) continue;

        if (dir.startsWith('fabric-loader-')) {
          const match = dir.match(/^fabric-loader-([^-]+)-/);
          installed.fabric = { versionId: dir, loaderVersion: match ? match[1] : dir };
        } else if (dir.startsWith('quilt-loader-')) {
          const match = dir.match(/^quilt-loader-([^-]+)-/);
          installed.quilt = { versionId: dir, loaderVersion: match ? match[1] : dir };
        } else if (dir.includes('forge')) {
          installed.forge = { versionId: dir, loaderVersion: dir };
        }
      } catch {
        // Skip unreadable dirs
      }
    }
  } catch {
    // versions dir doesn't exist yet
  }

  return installed;
}

module.exports = {
  listFabricLoaders,
  listFabricGameVersions,
  getFabricProfile,
  listQuiltLoaders,
  listQuiltGameVersions,
  getQuiltProfile,
  listForgeVersions,
  installForgeVersion,
  listModLoaders,
  installModLoader,
  modLoaderVersionId,
  resolveVersionChain,
  getInstalledLoaders
};
