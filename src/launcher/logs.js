const fs = require('node:fs/promises');
const path = require('node:path');
const { getDataRoot } = require('../config');
const { ensureDir, readJson, writeJson } = require('./store');
const { progressBus } = require('./downloader');

const MAX_LINES = 5000;
const logBuffer = [];
const listeners = new Set();

function launcherLogPath() {
  return path.join(getDataRoot(), 'logs', 'launcher.log');
}

function crashReportsDir(gameDir) {
  return path.join(gameDir || path.join(getDataRoot(), 'minecraft'), 'crash-reports');
}

function appendLog(entry) {
  const line = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    stream: entry.stream || 'info',
    message: String(entry.message || '').replace(/\r/g, ''),
    source: entry.source || 'launcher'
  };

  logBuffer.push(line);
  if (logBuffer.length > MAX_LINES) {
    logBuffer.splice(0, logBuffer.length - MAX_LINES);
  }

  progressBus.emitEvent('console-log', line);
  for (const fn of listeners) {
    try { fn(line); } catch (_) { /* ignore */ }
  }

  // Fire-and-forget persist (throttled lightly by not awaiting).
  persistLine(line).catch(() => {});
  return line;
}

let persistQueue = Promise.resolve();
async function persistLine(line) {
  persistQueue = persistQueue.then(async () => {
    const file = launcherLogPath();
    await ensureDir(path.dirname(file));
    await fs.appendFile(file, `[${line.at}] [${line.stream}] ${line.message}\n`, 'utf8');
  });
  return persistQueue;
}

function getLogs({ search = '', stream = '', limit = 500 } = {}) {
  let lines = logBuffer;
  if (stream) lines = lines.filter((l) => l.stream === stream);
  if (search) {
    const q = search.toLowerCase();
    lines = lines.filter((l) => l.message.toLowerCase().includes(q));
  }
  return lines.slice(-Math.min(2000, Math.max(1, Number(limit) || 500)));
}

function clearLogs() {
  logBuffer.length = 0;
  return { ok: true };
}

function getLogText({ search = '', stream = '' } = {}) {
  return getLogs({ search, stream, limit: MAX_LINES })
    .map((l) => `[${l.at}] [${l.stream}] ${l.message}`)
    .join('\n');
}

async function listCrashReports(gameDir) {
  const dir = crashReportsDir(gameDir);
  try {
    const files = await fs.readdir(dir);
    const reports = [];
    for (const name of files.filter((f) => f.endsWith('.txt')).sort().reverse().slice(0, 50)) {
      const full = path.join(dir, name);
      const stat = await fs.stat(full);
      reports.push({
        name,
        path: full,
        size: stat.size,
        mtime: stat.mtime.toISOString()
      });
    }
    return reports;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function readCrashReport(filePath) {
  const resolved = path.resolve(filePath);
  // Safety: only allow reading under data root or obvious crash-report names.
  const dataRoot = path.resolve(getDataRoot());
  if (!resolved.startsWith(dataRoot) && !resolved.includes(`${path.sep}crash-reports${path.sep}`)) {
    throw new Error('Crash report path is not allowed');
  }
  const content = await fs.readFile(resolved, 'utf8');
  return { path: resolved, content };
}

async function saveCrashReportCopy(sourcePath, destinationDir) {
  const report = await readCrashReport(sourcePath);
  const destDir = destinationDir
    ? path.resolve(destinationDir)
    : path.join(getDataRoot(), 'crash-reports');
  await ensureDir(destDir);
  const dest = path.join(destDir, path.basename(sourcePath));
  await fs.writeFile(dest, report.content, 'utf8');
  return { destination: dest };
}

// Hook game / launcher events into the live console.
progressBus.on('event', (event) => {
  if (event.type === 'game-log') {
    appendLog({ stream: event.stream || 'stdout', message: event.message, source: 'minecraft' });
  } else if (event.type === 'launch-start') {
    appendLog({ stream: 'info', message: `Launching ${event.versionId} with ${event.java}`, source: 'launcher' });
  } else if (event.type === 'launch-exit') {
    appendLog({
      stream: event.code && event.code !== 0 ? 'error' : 'info',
      message: `Minecraft exited code=${event.code ?? 'n/a'} signal=${event.signal ?? 'none'}`,
      source: 'launcher'
    });
  } else if (event.type === 'launch-error') {
    appendLog({ stream: 'error', message: event.message, source: 'launcher' });
  } else if (event.type === 'task-error') {
    appendLog({ stream: 'error', message: `${event.name}: ${event.message}`, source: 'launcher' });
  } else if (event.type === 'status') {
    appendLog({ stream: 'info', message: event.message, source: 'launcher' });
  }
});

module.exports = {
  appendLog,
  getLogs,
  getLogText,
  clearLogs,
  listCrashReports,
  readCrashReport,
  saveCrashReportCopy,
  launcherLogPath
};
