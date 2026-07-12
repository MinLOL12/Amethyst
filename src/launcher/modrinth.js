const { fetchJson, progressBus } = require('./downloader');

const MODRINTH_API = 'https://api.modrinth.com/v2';

function buildFacets({ loaders, gameVersions, categories, projectType }) {
  const facets = [];
  if (projectType) facets.push([`project_type:${projectType}`]);
  if ((!projectType || projectType === 'mod' || projectType === 'modpack') && loaders && loaders.length) facets.push(loaders.map(l => `categories:${l}`));
  if (gameVersions && gameVersions.length) facets.push(gameVersions.map(v => `versions:${v}`));
  if (categories && categories.length) facets.push(categories.map(c => `categories:${c}`));
  // Ensure we only search mods by default? Caller controls
  return JSON.stringify(facets);
}

async function searchProjects({ query = '', loaders = [], gameVersions = [], categories = [], projectType = 'mod', limit = 20, offset = 0, index = 'relevance' } = {}) {
  const params = new URLSearchParams();
  if (query) params.set('query', query);
  const facets = [];
  if (projectType) facets.push([`project_type:${projectType}`]);
  if ((!projectType || projectType === 'mod' || projectType === 'modpack') && loaders && loaders.length) {
    // loaders facet uses "categories" for loader? Actually modrinth uses: categories:loader? According to docs, loader is categories as well. Or use 'categories:%loader' indeed, but also there's 'categories' includes loaders. We'll use categories facet.
    // However newer docs use 'categories:forge' etc. So we add.
    facets.push(loaders.map(l => `categories:${l}`));
  }
  if (gameVersions && gameVersions.length) {
    facets.push(gameVersions.map(v => `versions:${v}`));
  }
  if (categories && categories.length) {
    facets.push(categories.map(c => `categories:${c}`));
  }
  if (facets.length) params.set('facets', JSON.stringify(facets));
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  params.set('index', index);

  const url = `${MODRINTH_API}/search?${params.toString()}`;
  progressBus.emitEvent('status', { message: `Searching Modrinth: ${query}` });
  try {
    const data = await fetchJson(url, `Modrinth search ${query}`);
    return data; // { hits: [], offset, limit, total_hits }
  } catch (error) {
    progressBus.emitEvent('status', { message: `Modrinth search failed: ${error.message}` });
    throw error;
  }
}

async function getProject(projectId) {
  try {
    const url = `${MODRINTH_API}/project/${encodeURIComponent(projectId)}`;
    return await fetchJson(url, `Modrinth project ${projectId}`);
  } catch (error) {
    progressBus.emitEvent('status', { message: `Failed to fetch Modrinth project ${projectId}: ${error.message}` });
    throw error;
  }
}

async function getProjectVersions(projectId, { loaders = [], gameVersions = [] } = {}) {
  try {
    const params = new URLSearchParams();
    if (loaders.length) params.set('loaders', JSON.stringify(loaders));
    if (gameVersions.length) params.set('game_versions', JSON.stringify(gameVersions));
    const qs = params.toString() ? `?${params}` : '';
    const url = `${MODRINTH_API}/project/${encodeURIComponent(projectId)}/version${qs}`;
    return await fetchJson(url, `Modrinth versions ${projectId}`);
  } catch (error) {
    progressBus.emitEvent('status', { message: `Failed to fetch Modrinth project versions for ${projectId}: ${error.message}` });
    throw error;
  }
}

async function getVersion(versionId) {
  try {
    const url = `${MODRINTH_API}/version/${encodeURIComponent(versionId)}`;
    return await fetchJson(url, `Modrinth version ${versionId}`);
  } catch (error) {
    progressBus.emitEvent('status', { message: `Failed to fetch Modrinth version ${versionId}: ${error.message}` });
    throw error;
  }
}

async function getLoaderTags() {
  try {
    const url = `${MODRINTH_API}/tag/loader`;
    return await fetchJson(url, 'Modrinth loader tags');
  } catch (error) {
    progressBus.emitEvent('status', { message: `Failed to fetch Modrinth loader tags: ${error.message}` });
    return [];
  }
}

async function getGameVersionTags() {
  try {
    const url = `${MODRINTH_API}/tag/game_version`;
    return await fetchJson(url, 'Modrinth game version tags');
  } catch (error) {
    progressBus.emitEvent('status', { message: `Failed to fetch Modrinth game version tags: ${error.message}` });
    return [];
  }
}

module.exports = {
  searchProjects,
  getProject,
  getProjectVersions,
  getVersion,
  getLoaderTags,
  getGameVersionTags,
};
