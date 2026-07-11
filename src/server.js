const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { URL } = require('node:url');
const { progressBus } = require('./launcher/downloader');
const { listVersions } = require('./launcher/mojangApi');
const { scanJavaInstallations } = require('./launcher/javaLocator');
const { listAccounts, addOfflineAccount, removeAccount, readSettings, saveSettings } = require('./launcher/accounts');
const { installVersion, launchVersion } = require('./launcher/minecraft');
const { listModLoaders, getInstalledLoaders } = require('./launcher/modloader');
const { getNews } = require('./launcher/news');
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

async function handleApi(request, response, url) {
  if (url.pathname === '/api/events') {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    response.write(`data: ${JSON.stringify({ type: 'hello', app: APP_NAME, version: APP_VERSION, at: new Date().toISOString() })}\n\n`);
    clients.add(response);
    request.on('close', () => clients.delete(response));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/status') {
    return json(response, 200, { app: APP_NAME, version: APP_VERSION, dataRoot: getDataRoot(), busyTask });
  }

  if (request.method === 'GET' && url.pathname === '/api/versions') {
    return json(response, 200, await listVersions());
  }

  if (request.method === 'GET' && url.pathname === '/api/java') {
    return json(response, 200, { installations: await scanJavaInstallations() });
  }

  if (request.method === 'GET' && url.pathname === '/api/accounts') {
    return json(response, 200, { accounts: await listAccounts() });
  }

  if (request.method === 'POST' && url.pathname === '/api/accounts') {
    const body = await readBody(request);
    return json(response, 201, { account: await addOfflineAccount(body.username) });
  }

  const deleteAccountMatch = url.pathname.match(/^\/api\/accounts\/([^/]+)$/);
  if (request.method === 'DELETE' && deleteAccountMatch) {
    return json(response, 200, { accounts: await removeAccount(decodeURIComponent(deleteAccountMatch[1])) });
  }

  if (request.method === 'GET' && url.pathname === '/api/settings') {
    return json(response, 200, { settings: await readSettings() });
  }

  if (request.method === 'POST' && url.pathname === '/api/settings') {
    const body = await readBody(request);
    return json(response, 200, { settings: await saveSettings(body) });
  }

  if (request.method === 'GET' && url.pathname === '/api/news') {
    return json(response, 200, { entries: await getNews() });
  }

  // ── Mod Loader Endpoints ────────────────────────────────────────

  if (request.method === 'GET' && url.pathname === '/api/modloaders') {
    const mcVersion = url.searchParams.get('mcVersion') || '';
    if (!mcVersion) return json(response, 400, { error: 'mcVersion query parameter is required' });
    const loaders = await listModLoaders(mcVersion);
    return json(response, 200, { mcVersion, loaders });
  }

  if (request.method === 'GET' && url.pathname === '/api/modloaders/installed') {
    const settings = await readSettings();
    const mcVersion = url.searchParams.get('mcVersion') || settings.lastVersion || '';
    const gameDir = settings.gameDir;
    if (!mcVersion) return json(response, 200, { installed: { fabric: null, quilt: null, forge: null } });
    const installed = await getInstalledLoaders(mcVersion, gameDir);
    return json(response, 200, { mcVersion, installed });
  }

  // ── Install & Launch ────────────────────────────────────────────

  if (request.method === 'POST' && url.pathname === '/api/install') {
    const body = await readBody(request);
    if (!body.versionId) throw new Error('versionId is required');
    const result = await runExclusive(`Install ${body.versionId}`, () => installVersion(body.versionId, body));
    return json(response, 200, { ok: true, versionId: body.versionId, gameDir: result.paths.root });
  }

  if (request.method === 'POST' && url.pathname === '/api/launch') {
    const body = await readBody(request);
    if (!body.versionId) throw new Error('versionId is required');
    const accounts = await listAccounts();
    const account = accounts.find((item) => item.id === body.accountId) || accounts[0];
    if (!account) throw new Error('Create an offline account before launching.');
    const result = await runExclusive(`Launch ${body.versionId}`, () => launchVersion(body.versionId, account, body));
    return json(response, 200, { ok: true, ...result });
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
