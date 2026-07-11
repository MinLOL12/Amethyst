const { fetchJson, progressBus } = require('./downloader');

const MODRINTH_API = 'https://api.modrinth.com/v2';

function buildFacets({ loaders, gameVersions, categories, projectType }) {
  const facets = [];
  if (projectType) facets.push([`project_type:${projectType}`]);
  if (loaders && loaders.length) facets.push(loaders.map(l => `categories:${l}`));
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
  if (loaders && loaders.length) {
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
  const data = await fetchJson(url, `Modrinth search ${query}`);
  return data; // { hits: [], offset, limit, total_hits }
}

async function getProject(projectId) {
  const url = `${MODRINTH_API}/project/${encodeURIComponent(projectId)}`;
  return fetchJson(url, `Modrinth project ${projectId}`);
}

async function getProjectVersions(projectId, { loaders = [], gameVersions = [] } = {}) {
  const params = new URLSearchParams();
  if (loaders.length) params.set('loaders', JSON.stringify(loaders));
  if (gameVersions.length) params.set('game_versions', JSON.stringify(gameVersions));
  const qs = params.toString() ? `?${params}` : '';
  const url = `${MODRINTH_API}/project/${encodeURIComponent(projectId)}/version${qs}`;
  return fetchJson(url, `Modrinth versions ${projectId}`);
}

async function getVersion(versionId) {
  const url = `${MODRINTH_API}/version/${encodeURIComponent(versionId)}`;
  return fetchJson(url, `Modrinth version ${versionId}`);
}

async function getLoaderTags() {
  const url = `${MODRINTH_API}/tag/loader`;
  try { return await fetchJson(url, 'Modrinth loader tags'); } catch { return []; }
}

async function getGameVersionTags() {
  const url = `${MODRINTH_API}/tag/game_version`;
  try { return await fetchJson(url, 'Modrinth game version tags'); } catch { return []; }
}

module.exports = {
  searchProjects,
  getProject,
  getProjectVersions,
  getVersion,
  getLoaderTags,
  getGameVersionTags,
};
