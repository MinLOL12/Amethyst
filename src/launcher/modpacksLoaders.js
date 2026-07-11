const { fetchJson } = require('./downloader');

// Unified loader version listing
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
    const { fetchForgeVersions } = require('./modpacks');
    return fetchForgeVersions(mcVersion);
  }
  if (loader === 'neoforge') {
    const { fetchNeoForgeVersions } = require('./modpacks');
    return fetchNeoForgeVersions(mcVersion);
  }
  if (loader === 'vanilla') return [{ id: mcVersion, loader: 'vanilla', version: mcVersion }];
  return [];
}

module.exports = { listLoaderVersions };
