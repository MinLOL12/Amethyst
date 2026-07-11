const path = require('node:path');
const { fetchJson } = require('./downloader');

// ─── Fabric ──────────────────────────────────────────────────────────────────

const FABRIC_META_URL = 'https://meta.fabricmc.net/v2';

/**
 * List available Fabric loader versions for a given Minecraft version.
 * Returns an array of { loader, intermediary, launcherMeta } objects.
 */
async function listFabricLoaders(mcVersion) {
  const url = `${FABRIC_META_URL}/versions/loader/${encodeURIComponent(mcVersion)}`;
  const entries = await fetchJson(url, `Fabric loaders for ${mcVersion}`);
  if (!Array.isArray(entries)) return [];
  return entries.map((entry) => ({
    loader: entry.loader?.version || entry.loader,
    intermediary: entry.intermediary?.version || entry.intermediary,
    stable: entry.loader?.stable ?? true
  }));
}

/**
 * Fetch the Fabric loader profile JSON for a given Minecraft + loader version.
 * The profile JSON includes inheritsFrom, mainClass, libraries, etc.
 */
async function getFabricProfile(mcVersion, loaderVersion) {
  const url = `${FABRIC_META_URL}/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`;
  return fetchJson(url, `Fabric ${loaderVersion} profile for ${mcVersion}`);
}

/**
 * Get the latest stable Fabric loader version for a Minecraft version.
 */
async function getLatestFabricLoader(mcVersion) {
  const loaders = await listFabricLoaders(mcVersion);
  const stable = loaders.find((l) => l.stable);
  return stable || loaders[0] || null;
}

// ─── Forge ───────────────────────────────────────────────────────────────────

const FORGE_MAVEN_URL = 'https://maven.minecraftforge.net';
const FORGE_PROMOTIONS_URL = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
const FORGE_METADATA_URL = 'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml';

/**
 * Parse Forge versions from maven-metadata.xml.
 * Returns a list of version strings for the given Minecraft version.
 */
async function listForgeVersions(mcVersion) {
  const url = `${FORGE_MAVEN_URL}/net/minecraftforge/forge/maven-metadata.xml`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'AmethystLauncher/0.1 (+https://github.com/MinLOL12/Amethyst)' }
  });
  if (!response.ok) return [];
  const xml = await response.text();

  // Normalize MC version prefix (e.g. "1.20.1" → matches "1.20.1-XX.Y.Z")
  const prefix = mcVersion + '-';
  const versions = [];
  const versionRegex = /<version>([^<]+)<\/version>/g;
  let match;
  while ((match = versionRegex.exec(xml))) {
    if (match[1].startsWith(prefix)) {
      versions.push(match[1]);
    }
  }

  // Sort newest first (simple numeric sort on forge build number)
  versions.sort((a, b) => {
    const buildA = a.split('-').slice(1).join('-');
    const buildB = b.split('-').slice(1).join('-');
    const partsA = buildA.split('.').map(Number);
    const partsB = buildB.split('.').map(Number);
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const diff = (partsB[i] || 0) - (partsA[i] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });

  return versions.map((v) => {
    const forgeBuild = v.substring(prefix.length);
    return { id: v, mcVersion, forgeVersion: forgeBuild };
  });
}

/**
 * Get the Forge version JSON for a given full version string (e.g. "1.20.1-47.2.0").
 * Forge stores a JSON profile at:
 *   https://maven.minecraftforge.net/net/minecraftforge/forge/{version}/forge-{version}.json
 */
async function getForgeProfile(fullVersion) {
  const url = `${FORGE_MAVEN_URL}/net/minecraftforge/forge/${fullVersion}/forge-${fullVersion}.json`;
  return fetchJson(url, `Forge ${fullVersion} profile`);
}

/**
 * Get the recommended/latest Forge version for a MC version from promotions JSON.
 */
async function getRecommendedForge(mcVersion) {
  try {
    const promos = await fetchJson(FORGE_PROMOTIONS_URL, 'Forge promotions');
    const recommended = promos.promos?.[`${mcVersion}-recommended`];
    const latest = promos.promos?.[`${mcVersion}-latest`];
    const forgeVersion = recommended || latest;
    if (!forgeVersion) return null;
    return { id: `${mcVersion}-${forgeVersion}`, mcVersion, forgeVersion };
  } catch {
    return null;
  }
}

// ─── NeoForge ────────────────────────────────────────────────────────────────

const NEOFORGE_MAVEN_URL = 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge';
const NEOFORGE_LEGACY_URL = 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/forge';

/**
 * List NeoForge versions for a given Minecraft version.
 * NeoForge started with 1.20.1 (as "forge" branding) and 1.20.2+ (as "neoforge").
 */
async function listNeoForgeVersions(mcVersion) {
  const urls = [];
  // NeoForge proper started from 1.20.2+
  urls.push(NEOFORGE_MAVEN_URL);
  // For 1.20.1, NeoForge used the "forge" artifact name
  if (mcVersion === '1.20.1') {
    urls.push(NEOFORGE_LEGACY_URL);
  }

  const allVersions = [];
  for (const url of urls) {
    try {
      const data = await fetchJson(url, 'NeoForge versions');
      if (data.versions && Array.isArray(data.versions)) {
        for (const v of data.versions) {
          // NeoForge versions for MC 1.20.1 look like "1.20.1-47.x.x"
          // For 1.20.2+ they look like "20.2.x" (mapped from MC minor version)
          if (mcVersion === '1.20.1') {
            if (v.startsWith('1.20.1-')) {
              allVersions.push({ id: v, mcVersion, forgeVersion: v.substring('1.20.1-'.length), type: 'neoforge' });
            }
          } else {
            // For 1.20.2+, NeoForge version is like "20.2.x" for MC 1.20.2
            const mcMinor = mcVersion.split('.').slice(1).join('.');
            if (v.startsWith(mcMinor + '.')) {
              allVersions.push({ id: v, mcVersion, forgeVersion: v, type: 'neoforge' });
            }
          }
        }
      }
    } catch {
      // skip failed URLs
    }
  }

  return allVersions.reverse(); // newest first
}

/**
 * Get the NeoForge installer profile JSON.
 */
async function getNeoForgeProfile(fullVersion, mcVersion) {
  // Try neoforge artifact first, fall back to forge artifact for 1.20.1
  const isLegacy = mcVersion === '1.20.1' && fullVersion.startsWith('1.20.1-');
  const group = isLegacy ? 'net/neoforged/forge' : 'net/neoforged/neoforge';
  const url = `https://maven.neoforged.net/releases/${group}/${fullVersion}/neoforge-${fullVersion}-installer.json`;
  try {
    return await fetchJson(url, `NeoForge ${fullVersion} profile`);
  } catch {
    // Try alternate URL pattern
    const altUrl = `https://maven.neoforged.net/releases/${group}/${fullVersion}/neoforge-${fullVersion}-installer.json`;
    return fetchJson(altUrl, `NeoForge ${fullVersion} profile (alt)`);
  }
}

// ─── Quilt ───────────────────────────────────────────────────────────────────

const QUILT_META_URL = 'https://meta.quiltmc.org/v3';

async function listQuiltLoaders(mcVersion) {
  const url = `${QUILT_META_URL}/versions/loader/${encodeURIComponent(mcVersion)}`;
  try {
    const entries = await fetchJson(url, `Quilt loaders for ${mcVersion}`);
    if (!Array.isArray(entries)) return [];
    return entries.map((entry) => ({
      loader: entry.loader?.version || entry.loader,
      intermediary: entry.intermediary?.version || entry.intermediary,
      stable: entry.loader?.stable ?? true
    }));
  } catch {
    return [];
  }
}

async function getQuiltProfile(mcVersion, loaderVersion) {
  const url = `${QUILT_META_URL}/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`;
  return fetchJson(url, `Quilt ${loaderVersion} profile for ${mcVersion}`);
}

async function getLatestQuiltLoader(mcVersion) {
  const loaders = await listQuiltLoaders(mcVersion);
  const stable = loaders.find((l) => l.stable);
  return stable || loaders[0] || null;
}

// ─── Unified API ─────────────────────────────────────────────────────────────

/**
 * List available mod loaders for a given Minecraft version.
 * Returns { fabric: [...], forge: [...], neoforge: [...], quilt: [...] }
 */
async function listModLoaders(mcVersion) {
  const results = { fabric: [], forge: [], neoforge: [], quilt: [] };

  // Run all fetches in parallel, catching individual failures gracefully
  const [fabric, forge, neoforge, quilt] = await Promise.allSettled([
    listFabricLoaders(mcVersion),
    listForgeVersions(mcVersion),
    listNeoForgeVersions(mcVersion),
    listQuiltLoaders(mcVersion)
  ]);

  if (fabric.status === 'fulfilled') results.fabric = fabric.value;
  if (forge.status === 'fulfilled') results.forge = forge.value;
  if (neoforge.status === 'fulfilled') results.neoforge = neoforge.value;
  if (quilt.status === 'fulfilled') results.quilt = quilt.value;

  return results;
}

/**
 * Get the profile JSON for a specific mod loader configuration.
 * This returns the mod loader's profile JSON which contains mainClass, libraries, etc.
 *
 * @param {string} modLoader - "fabric" | "forge" | "neoforge" | "quilt"
 * @param {string} mcVersion - Minecraft version (e.g. "1.20.1")
 * @param {string} loaderVersion - Mod loader version string
 */
async function getModLoaderProfile(modLoader, mcVersion, loaderVersion) {
  switch (modLoader) {
    case 'fabric':
      return getFabricProfile(mcVersion, loaderVersion);
    case 'forge':
      return getForgeProfile(`${mcVersion}-${loaderVersion}`);
    case 'neoforge':
      return getNeoForgeProfile(loaderVersion, mcVersion);
    case 'quilt':
      return getQuiltProfile(mcVersion, loaderVersion);
    default:
      throw new Error(`Unknown mod loader: ${modLoader}`);
  }
}

/**
 * Merge a mod loader profile with its base vanilla version meta.
 * The mod loader profile uses `inheritsFrom` to reference the vanilla version.
 * We merge libraries, arguments, and use the mod loader's mainClass.
 */
function mergeModLoaderProfile(modLoaderProfile, vanillaMeta) {
  const merged = { ...vanillaMeta };

  // Override the version ID to reflect the mod loader
  merged.id = modLoaderProfile.id || `${vanillaMeta.id}-modded`;

  // Use the mod loader's mainClass
  if (modLoaderProfile.mainClass) {
    merged.mainClass = modLoaderProfile.mainClass;
  }

  // Merge libraries: vanilla first, then mod loader libraries
  const vanillaLibs = vanillaMeta.libraries || [];
  const modLoaderLibs = modLoaderProfile.libraries || [];
  merged.libraries = [...vanillaLibs, ...modLoaderLibs];

  // Merge JVM/game arguments
  if (modLoaderProfile.arguments) {
    merged.arguments = merged.arguments || {};
    if (modLoaderProfile.arguments.jvm) {
      merged.arguments.jvm = [...(merged.arguments.jvm || []), ...modLoaderProfile.arguments.jvm];
    }
    if (modLoaderProfile.arguments.game) {
      merged.arguments.game = [...(merged.arguments.game || []), ...modLoaderProfile.arguments.game];
    }
  }

  // Handle legacy minecraftArguments (some Forge versions use this)
  if (modLoaderProfile.minecraftArguments && !modLoaderProfile.arguments) {
    merged.minecraftArguments = modLoaderProfile.minecraftArguments;
  }

  // Preserve type info
  if (modLoaderProfile.type) {
    merged.type = modLoaderProfile.type;
  }

  // Mark as modded for our own tracking
  merged._modded = true;
  merged._modLoaderProfile = modLoaderProfile;

  return merged;
}

module.exports = {
  // Fabric
  listFabricLoaders,
  getFabricProfile,
  getLatestFabricLoader,
  // Forge
  listForgeVersions,
  getForgeProfile,
  getRecommendedForge,
  // NeoForge
  listNeoForgeVersions,
  getNeoForgeProfile,
  // Quilt
  listQuiltLoaders,
  getQuiltProfile,
  getLatestQuiltLoader,
  // Unified
  listModLoaders,
  getModLoaderProfile,
  mergeModLoaderProfile
};
