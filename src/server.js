const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { URL } = require('node:url');
const { progressBus } = require('./launcher/downloader');
const { listVersions } = require('./launcher/mojangApi');
const {
  listAccounts,
  addOfflineAccount,
  removeAccount,
  readSettings,
  saveSettings,
  setActiveAccount
} = require('./launcher/accounts');
const {
  startDeviceLogin,
  getLoginStatus,
  cancelLogin,
  refreshMicrosoftAccount,
  switchAccount
} = require('./launcher/microsoftAuth');
const {
  listInstances,
  getInstance,
  createInstance,
  updateInstance,
  renameInstance,
  duplicateInstance,
  deleteInstance,
  getRecentInstances,
  exportInstance,
  importInstance
} = require('./launcher/instances');
const { LOADERS, listLoaderVersions, installLoader } = require('./launcher/modLoaders');
const {
  listAllJava,
  listDownloadableJava,
  downloadJava
} = require('./launcher/javaManager');
const { downloadQueue } = require('./launcher/downloadQueue');
const { installVersion, launchVersion } = require('./launcher/minecraft');
const { getNews } = require('./launcher/news');
const {
  getLogs,
  getLogText,
  clearLogs,
  listCrashReports,
  readCrashReport,
  saveCrashReportCopy
} = require('./launcher/logs');
const { openFolder, listFolderShortcuts, resolveFolder } = require('./launcher/folders');
const { APP_NAME, APP_VERSION, getDataRoot } = require('./config');

const publicDir = path.join(__dirname, '..', 'public');
const clients = new Set();
let busyTask = null;

function sendSse(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const response of clients) response.write(payload);
}

progressBus.on('event', sendSse);

function mimeType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

function json(response, statusCode, value) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(value, null, 2));
}

async function readBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1024 * 1024) throw new Error('Request body too large');
  }
  return body ? JSON.parse(body) : {};
}

async function serveStatic(request, response, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.normalize(path.join(publicDir, relative));
  if (!file.startsWith(publicDir)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  try {
    const content = await fs.readFile(file);
    response.writeHead(200, {
      'Content-Type': mimeType(file),
      'Cache-Control': process.env.AMETHYST_DEV ? 'no-store' : 'public, max-age=300'
    });
    response.end(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    throw error;
  }
}

async function runExclusive(name, task) {
  if (busyTask) throw new Error(`Another launcher task is already running: ${busyTask}`);
  busyTask = name;
  progressBus.emitEvent('task-start', { name });
  try {
    const result = await task();
    progressBus.emitEvent('task-complete', { name });
    return result;
  } catch (error) {
    progressBus.emitEvent('task-error', { name, message: error.message });
    throw error;
  } finally {
    busyTask = null;
  }
}

function matchRoute(pathname, pattern) {
  const pathParts = pathname.split('/').filter(Boolean);
  const patternParts = pattern.split('/').filter(Boolean);
  if (pathParts.length !== patternParts.length) return null;
  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

async function handleApi(request, response, url) {
  if (url.pathname === '/api/events') {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    response.write(
      `data: ${JSON.stringify({ type: 'hello', app: APP_NAME, version: APP_VERSION, at: new Date().toISOString() })}\n\n`
    );
    clients.add(response);
    request.on('close', () => clients.delete(response));
    return;
  }

  const method = request.method;

  if (method === 'GET' && url.pathname === '/api/status') {
    return json(response, 200, {
      app: APP_NAME,
      version: APP_VERSION,
      dataRoot: getDataRoot(),
      busyTask,
      loaders: LOADERS
    });
  }

  // ── Versions ──────────────────────────────────────────────────
  if (method === 'GET' && url.pathname === '/api/versions') {
    return json(response, 200, await listVersions());
  }

  // ── Java ──────────────────────────────────────────────────────
  if (method === 'GET' && url.pathname === '/api/java') {
    return json(response, 200, { installations: await listAllJava() });
  }

  if (method === 'GET' && url.pathname === '/api/java/downloadable') {
    return json(response, 200, { versions: await listDownloadableJava() });
  }

  if (method === 'POST' && url.pathname === '/api/java/download') {
    const body = await readBody(request);
    const major = Number(body.major) || 17;
    const job = downloadQueue.enqueue({
      name: `Download Java ${major}`,
      type: 'java',
      run: async () => downloadJava(major, body)
    });
    return json(response, 202, { job, queued: true });
  }

  // ── Accounts ──────────────────────────────────────────────────
  if (method === 'GET' && url.pathname === '/api/accounts') {
    return json(response, 200, { accounts: await listAccounts() });
  }

  if (method === 'POST' && url.pathname === '/api/accounts') {
    const body = await readBody(request);
    return json(response, 201, { account: await addOfflineAccount(body.username) });
  }

  if (method === 'POST' && url.pathname === '/api/accounts/microsoft/start') {
    const body = await readBody(request);
    const settings = await readSettings();
    const remember = body.remember !== undefined ? Boolean(body.remember) : settings.rememberMicrosoftLogin;
    return json(response, 200, await startDeviceLogin({ remember }));
  }

  const msStatus = matchRoute(url.pathname, '/api/accounts/microsoft/status/:loginId');
  if (method === 'GET' && msStatus) {
    return json(response, 200, getLoginStatus(msStatus.loginId));
  }

  const msCancel = matchRoute(url.pathname, '/api/accounts/microsoft/cancel/:loginId');
  if (method === 'POST' && msCancel) {
    return json(response, 200, cancelLogin(msCancel.loginId));
  }

  const msRefresh = matchRoute(url.pathname, '/api/accounts/:id/refresh');
  if (method === 'POST' && msRefresh) {
    return json(response, 200, { account: await refreshMicrosoftAccount(msRefresh.id) });
  }

  const accountSwitch = matchRoute(url.pathname, '/api/accounts/:id/switch');
  if (method === 'POST' && accountSwitch) {
    return json(response, 200, { account: await switchAccount(accountSwitch.id) });
  }

  const accountSelect = matchRoute(url.pathname, '/api/accounts/:id/select');
  if (method === 'POST' && accountSelect) {
    return json(response, 200, { account: await setActiveAccount(accountSelect.id) });
  }

  const deleteAccountMatch = matchRoute(url.pathname, '/api/accounts/:id');
  if (method === 'DELETE' && deleteAccountMatch) {
    return json(response, 200, { accounts: await removeAccount(deleteAccountMatch.id) });
  }

  // ── Settings ──────────────────────────────────────────────────
  if (method === 'GET' && url.pathname === '/api/settings') {
    return json(response, 200, { settings: await readSettings() });
  }

  if (method === 'POST' && url.pathname === '/api/settings') {
    const body = await readBody(request);
    return json(response, 200, { settings: await saveSettings(body) });
  }

  // ── News ──────────────────────────────────────────────────────
  if (method === 'GET' && url.pathname === '/api/news') {
    return json(response, 200, { entries: await getNews() });
  }

  // ── Instances ─────────────────────────────────────────────────
  if (method === 'GET' && url.pathname === '/api/instances') {
    return json(response, 200, { instances: await listInstances() });
  }

  if (method === 'GET' && url.pathname === '/api/instances/recent') {
    const limit = Number(url.searchParams.get('limit')) || 6;
    return json(response, 200, { instances: await getRecentInstances(limit) });
  }

  if (method === 'POST' && url.pathname === '/api/instances') {
    const body = await readBody(request);
    return json(response, 201, { instance: await createInstance(body) });
  }

  const instanceOne = matchRoute(url.pathname, '/api/instances/:id');
  if (method === 'GET' && instanceOne) {
    return json(response, 200, { instance: await getInstance(instanceOne.id) });
  }
  if (method === 'PATCH' && instanceOne) {
    const body = await readBody(request);
    return json(response, 200, { instance: await updateInstance(instanceOne.id, body) });
  }
  if (method === 'DELETE' && instanceOne) {
    const deleteFiles = url.searchParams.get('deleteFiles') !== 'false';
    return json(response, 200, { instances: await deleteInstance(instanceOne.id, { deleteFiles }) });
  }

  const instanceRename = matchRoute(url.pathname, '/api/instances/:id/rename');
  if (method === 'POST' && instanceRename) {
    const body = await readBody(request);
    return json(response, 200, { instance: await renameInstance(instanceRename.id, body.name) });
  }

  const instanceDuplicate = matchRoute(url.pathname, '/api/instances/:id/duplicate');
  if (method === 'POST' && instanceDuplicate) {
    const body = await readBody(request);
    return json(response, 201, { instance: await duplicateInstance(instanceDuplicate.id, body.name) });
  }

  const instanceExport = matchRoute(url.pathname, '/api/instances/:id/export');
  if (method === 'POST' && instanceExport) {
    const body = await readBody(request);
    const job = downloadQueue.enqueue({
      name: `Export instance`,
      type: 'export',
      run: async () => exportInstance(instanceExport.id, body.destination)
    });
    return json(response, 202, { job });
  }

  if (method === 'POST' && url.pathname === '/api/instances/import') {
    const body = await readBody(request);
    if (!body.path) throw new Error('path to ZIP is required');
    const job = downloadQueue.enqueue({
      name: `Import instance`,
      type: 'import',
      run: async () => importInstance(body.path, body)
    });
    return json(response, 202, { job });
  }

  // ── Mod loaders ───────────────────────────────────────────────
  if (method === 'GET' && url.pathname === '/api/loaders') {
    return json(response, 200, { loaders: LOADERS });
  }

  if (method === 'GET' && url.pathname === '/api/loaders/versions') {
    const loader = url.searchParams.get('loader') || 'fabric';
    const gameVersion = url.searchParams.get('gameVersion') || url.searchParams.get('version');
    return json(response, 200, await listLoaderVersions(loader, gameVersion));
  }

  if (method === 'POST' && url.pathname === '/api/loaders/install') {
    const body = await readBody(request);
    const job = downloadQueue.enqueue({
      name: `Install ${body.loader} ${body.loaderVersion || ''} for ${body.gameVersion}`,
      type: 'loader',
      run: async () => installLoader(body.loader, body.gameVersion, body.loaderVersion, body)
    });
    return json(response, 202, { job });
  }

  // ── Install / Launch ──────────────────────────────────────────
  if (method === 'POST' && url.pathname === '/api/install') {
    const body = await readBody(request);
    if (!body.versionId && !body.instanceId) throw new Error('versionId or instanceId is required');
    const name = body.instanceId ? `Install instance` : `Install ${body.versionId}`;
    const job = downloadQueue.enqueue({
      name,
      type: 'install',
      run: async () => {
        const result = await installVersion(body.versionId, body);
        return { versionId: result.versionId, gameDir: result.paths.root };
      }
    });
    return json(response, 202, { job, ok: true });
  }

  if (method === 'POST' && url.pathname === '/api/launch') {
    const body = await readBody(request);
    if (!body.versionId && !body.instanceId) throw new Error('versionId or instanceId is required');
    const accounts = await listAccounts();
    const accountId = body.accountId || (await readSettings()).lastAccountId || accounts[0]?.id;
    if (!accountId) throw new Error('Create or sign in to an account before launching.');

    const result = await runExclusive(
      body.instanceId ? 'Launch instance' : `Launch ${body.versionId}`,
      () => launchVersion(body.versionId, accountId, body)
    );
    return json(response, 200, { ok: true, ...result });
  }

  // ── Downloads queue ───────────────────────────────────────────
  if (method === 'GET' && url.pathname === '/api/downloads') {
    return json(response, 200, downloadQueue.snapshot());
  }

  if (method === 'POST' && url.pathname === '/api/downloads/pause') {
    downloadQueue.pause();
    return json(response, 200, downloadQueue.snapshot());
  }

  if (method === 'POST' && url.pathname === '/api/downloads/resume') {
    downloadQueue.resume();
    return json(response, 200, downloadQueue.snapshot());
  }

  if (method === 'POST' && url.pathname === '/api/downloads/clear') {
    downloadQueue.clearFinished();
    return json(response, 200, downloadQueue.snapshot());
  }

  const cancelJob = matchRoute(url.pathname, '/api/downloads/:id/cancel');
  if (method === 'POST' && cancelJob) {
    downloadQueue.cancel(cancelJob.id);
    return json(response, 200, downloadQueue.snapshot());
  }

  // ── Logs ──────────────────────────────────────────────────────
  if (method === 'GET' && url.pathname === '/api/logs') {
    return json(response, 200, {
      lines: getLogs({
        search: url.searchParams.get('search') || '',
        stream: url.searchParams.get('stream') || '',
        limit: Number(url.searchParams.get('limit')) || 500
      })
    });
  }

  if (method === 'GET' && url.pathname === '/api/logs/text') {
    const text = getLogText({
      search: url.searchParams.get('search') || '',
      stream: url.searchParams.get('stream') || ''
    });
    response.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    response.end(text);
    return;
  }

  if (method === 'DELETE' && url.pathname === '/api/logs') {
    return json(response, 200, clearLogs());
  }

  if (method === 'GET' && url.pathname === '/api/crash-reports') {
    const gameDir = url.searchParams.get('gameDir') || undefined;
    const instanceId = url.searchParams.get('instanceId');
    let dir = gameDir;
    if (instanceId) {
      const instance = await getInstance(instanceId);
      dir = instance.gameDir;
    }
    return json(response, 200, { reports: await listCrashReports(dir) });
  }

  if (method === 'GET' && url.pathname === '/api/crash-reports/read') {
    const filePath = url.searchParams.get('path');
    if (!filePath) throw new Error('path is required');
    return json(response, 200, await readCrashReport(filePath));
  }

  if (method === 'POST' && url.pathname === '/api/crash-reports/save') {
    const body = await readBody(request);
    if (!body.path) throw new Error('path is required');
    return json(response, 200, await saveCrashReportCopy(body.path, body.destinationDir));
  }

  // ── File browser shortcuts ────────────────────────────────────
  if (method === 'GET' && url.pathname === '/api/folders') {
    return json(response, 200, {
      folders: await listFolderShortcuts(url.searchParams.get('instanceId') || undefined)
    });
  }

  if (method === 'POST' && url.pathname === '/api/folders/open') {
    const body = await readBody(request);
    return json(response, 200, await openFolder(body.kind || body.folder || 'minecraft', body));
  }

  if (method === 'GET' && url.pathname === '/api/folders/resolve') {
    const kind = url.searchParams.get('kind') || 'minecraft';
    return json(response, 200, await resolveFolder(kind, {
      instanceId: url.searchParams.get('instanceId') || undefined,
      gameDir: url.searchParams.get('gameDir') || undefined
    }));
  }

  json(response, 404, { error: 'Not found' });
}

function createServer() {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    try {
      if (url.pathname.startsWith('/api/')) await handleApi(request, response, url);
      else await serveStatic(request, response, url.pathname);
    } catch (error) {
      json(response, 500, { error: error.message });
    }
  });
}

module.exports = {
  createServer
};
