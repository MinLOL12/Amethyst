const { fetchJson, progressBus } = require('./downloader');

const CURSEFORGE_API = 'https://api.curseforge.com/v1';
const MINECRAFT_GAME_ID = 432;

function getApiKey() {
  return process.env.CURSEFORGE_API_KEY || process.env.CF_API_KEY || null;
}

async function cfFetch(url, label) {
  const key = getApiKey();
  if (!key) {
    const error = new Error('CurseForge API key not configured. Set CURSEFORGE_API_KEY env var to enable CurseForge browsing. You can get a key from https://console.curseforge.com/');
    error.status = 401;
    throw error;
  }
  try {
    const response = await fetch(url, {
      headers: {
        'x-api-key': key,
        'Accept': 'application/json',
        'User-Agent': 'AmethystLauncher/0.1',
      },
      redirect: 'follow'
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const error = new Error(`CurseForge ${label} failed: HTTP ${response.status} ${text.slice(0, 500)}`);
      error.status = response.status;
      throw error;
    }
    return await response.json();
  } catch (error) {
    progressBus.emitEvent('status', { message: `CurseForge ${label} failed: ${error.message}` });
    throw error;
  }
}

function mapLoaderToCf(modLoaderType) {
  // CurseForge modLoaderType: 1=Any, 2=Forge, 3=Cauldron, 4=LiteLoader, 5=Fabric, 6=Quilt, etc? Actually API: modLoaderType values: 0=Any,1=Forge,2=Cauldron,3=LiteLoader,4=Fabric,5=Quilt,6=NeoForge
  const map = {
    forge: 1,
    fabric: 4,
    quilt: 5,
    neoforge: 6,
  };
  return map[modLoaderType] || 0;
}

async function searchMods({ searchFilter = '', gameVersion = '', modLoaderType = '', classId = 6, pageSize = 20, index = 0, sortField = 2, sortOrder = 'desc' } = {}) {
  // classId 6 = Mods
  const params = new URLSearchParams();
  params.set('gameId', String(MINECRAFT_GAME_ID));
  params.set('classId', String(classId));
  params.set('pageSize', String(pageSize));
  params.set('index', String(index));
  params.set('sortField', String(sortField)); // 2=Popularity
  params.set('sortOrder', sortOrder);
  if (searchFilter) params.set('searchFilter', searchFilter);
  if (gameVersion) params.set('gameVersion', gameVersion);
  if (modLoaderType) {
    const cfType = mapLoaderToCf(modLoaderType);
    if (cfType) params.set('modLoaderType', String(cfType));
  }
  const url = `${CURSEFORGE_API}/mods/search?${params.toString()}`;
  progressBus.emitEvent('status', { message: `Searching CurseForge: ${searchFilter}` });
  return cfFetch(url, `search ${searchFilter}`);
}

async function getMod(modId) {
  const url = `${CURSEFORGE_API}/mods/${encodeURIComponent(modId)}`;
  return cfFetch(url, `mod ${modId}`);
}

async function getModFiles(modId, { gameVersion = '', modLoaderType = '' } = {}) {
  const params = new URLSearchParams();
  if (gameVersion) params.set('gameVersion', gameVersion);
  if (modLoaderType) {
    const cfType = mapLoaderToCf(modLoaderType);
    if (cfType) params.set('modLoaderType', String(cfType));
  }
  const qs = params.toString() ? `?${params}` : '';
  const url = `${CURSEFORGE_API}/mods/${encodeURIComponent(modId)}/files${qs}`;
  return cfFetch(url, `files ${modId}`);
}

async function getFile(modId, fileId) {
  const url = `${CURSEFORGE_API}/mods/${encodeURIComponent(modId)}/files/${encodeURIComponent(fileId)}`;
  return cfFetch(url, `file ${modId}/${fileId}`);
}

module.exports = {
  getApiKey,
  searchMods,
  getMod,
  getModFiles,
  getFile,
};
