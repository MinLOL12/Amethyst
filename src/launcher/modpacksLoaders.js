const { fetchJson, progressBus } = require('./downloader');
const { FORGE_MAVEN_URL, NEOFORGE_MAVEN_URL } = require('../config');

// Unified loader version listing. Fabric/Quilt use the official meta APIs;
// Forge/NeoForge use Maven metadata so the list stays accurate without relying
// on the (sometimes outdated) Forge promotions endpoint.
async function listLoaderVersions(loader, mcVersion) {
  loader = (loader || '').toLowerCase();
  if (loader === 'fabric') {
    const { fetchFabricLoaderVersions } = require('./modpacks');
    const data = await fetchFabricLoaderVersions(mcVersion);
    return data.map(entry => ({
      id: entry.loader.version,
      loader: 'fabric',
      mcVersion: entry.intermediary?.version || mcVersion,
      stable: entry.loader.stable,
      version: entry.loader.version,
    }));
  }
  if (loader === 'quilt') {
    const { fetchQuiltLoaderVersions } = require('./modpacks');
    const data = await fetchQuiltLoaderVersions(mcVersion);
    return data.map(entry => ({
      id: entry.loader.version,
      loader: 'quilt',
      mcVersion: entry.intermediary?.version || mcVersion,
      stable: true,
      version: entry.loader.version,
    }));
  }
  if (loader === 'forge') {
    return listForgeVersions(mcVersion);
  }
  if (loader === 'neoforge') {
    return listNeoForgeVersions(mcVersion);
  }
  if (loader === 'vanilla') return [{ id: mcVersion, loader: 'vanilla', version: mcVersion }];
  return [];
}

async function listForgeVersions(mcVersion) {
  try {
    const metaUrl = `${FORGE_MAVEN_URL}/net/minecraftforge/forge/maven-metadata.xml`;
    const response = await fetch(metaUrl, {
      headers: { 'User-Agent': 'AmethystLauncher/0.2' }
    });
    if (!response.ok) throw new Error(`Forge metadata HTTP ${response.status}`);
    const xml = await response.text();
    const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)]
      .map(m => m[1])
      .filter(v => v.startsWith(`${mcVersion}-`))
      .reverse();
    return versions.map((version, index) => ({
      id: version,
      version,
      loader: 'forge',
      stable: index === 0,
      installerUrl: `${FORGE_MAVEN_URL}/net/minecraftforge/forge/${version}/forge-${version}-installer.jar`
    }));
  } catch (error) {
    // Fall back to the promotions endpoint when Maven is unavailable.
    const { fetchForgeVersions } = require('./modpacks');
    try {
      return fetchForgeVersions(mcVersion);
    } catch (_) {
      return [{ id: `${mcVersion}-latest`, loader: 'forge', version: `${mcVersion}-latest`, stable: true, _error: error.message }];
    }
  }
}

async function listNeoForgeVersions(mcVersion) {
  try {
    const metaUrl = `${NEOFORGE_MAVEN_URL}/net/neoforged/neoforge/maven-metadata.xml`;
    const response = await fetch(metaUrl, {
      headers: { 'User-Agent': 'AmethystLauncher/0.2' }
    });
    if (!response.ok) throw new Error(`NeoForge metadata HTTP ${response.status}`);
    const xml = await response.text();
    const all = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1]);

    // NeoForge version mapping: 1.21.1 → 21.1.x, 1.20.4 → 20.4.x
    const mcMatch = String(mcVersion).match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
    let filtered = all;
    if (mcMatch) {
      const major = mcMatch[1];
      const minor = mcMatch[2];
      const patch = mcMatch[3] || '0';
      if (Number(minor) >= 20 || Number(major) > 1) {
        const prefix = `${minor}.${patch}.`;
        filtered = all.filter(v => v.startsWith(prefix) || v.includes(mcVersion));
      } else {
        filtered = all.filter(v => v.includes(mcVersion));
      }
    }

    filtered = filtered.reverse();
    return filtered.map((version, index) => ({
      id: version,
      version,
      loader: 'neoforge',
      stable: index === 0,
      installerUrl: `${NEOFORGE_MAVEN_URL}/net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar`
    }));
  } catch (error) {
    const { fetchNeoForgeVersions } = require('./modpacks');
    try {
      return fetchNeoForgeVersions(mcVersion);
    } catch (_) {
      return [{ id: `neoforge-latest-${mcVersion}`, loader: 'neoforge', version: `neoforge-latest-${mcVersion}`, stable: false, _error: error.message }];
    }
  }
}

module.exports = { listLoaderVersions };
