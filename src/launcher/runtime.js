let pidusage = null;
try {
  // pidusage gives accurate cross-platform CPU/RAM for the Minecraft child
  // process when the optional dependency is installed. Keep a built-in fallback
  // so tests and source checkouts without node_modules can still start.
  pidusage = require('pidusage');
} catch (_) {
  pidusage = null;
}

const fs = require('node:fs/promises');
const os = require('node:os');
const { progressBus } = require('./downloader');

let active = null;
let timer = null;
let previousProcSample = null;

function snapshot() {
  if (!active) return { running: false, pid: null, cpu: 0, memory: 0 };
  return { ...active };
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

async function procfsUsage(pid) {
  if (process.platform !== 'linux') {
    if (!processExists(pid)) {
      const error = new Error(`No matching pid ${pid}`);
      error.code = 'ESRCH';
      throw error;
    }
    return { cpu: 0, memory: 0 };
  }

  const [stat, statm] = await Promise.all([
    fs.readFile(`/proc/${pid}/stat`, 'utf8'),
    fs.readFile(`/proc/${pid}/statm`, 'utf8').catch(() => '')
  ]);

  // /proc/<pid>/stat wraps the command in parentheses and the command can
  // contain spaces, so split after the final close-paren.
  const afterCommand = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
  const utimeTicks = Number(afterCommand[11]) || 0;
  const stimeTicks = Number(afterCommand[12]) || 0;
  const clockTicks = Number(process.env.CLK_TCK) || 100;
  const processMs = ((utimeTicks + stimeTicks) / clockTicks) * 1000;
  const now = Date.now();

  let cpu = 0;
  if (previousProcSample?.pid === pid) {
    const elapsedMs = Math.max(1, now - previousProcSample.now);
    cpu = Math.max(0, ((processMs - previousProcSample.processMs) / elapsedMs) * 100);
    // Match common process-monitor semantics: 100% is one fully-used core, so a
    // multi-threaded Minecraft session may exceed 100% on multi-core systems.
    cpu = Math.min(cpu, Math.max(1, os.cpus().length) * 100);
  }
  previousProcSample = { pid, now, processMs };

  const residentPages = Number(String(statm).trim().split(/\s+/)[1]) || 0;
  const memory = residentPages * 4096;
  return { cpu, memory };
}

async function getProcessUsage(pid) {
  if (pidusage) return pidusage(pid);
  return procfsUsage(pid);
}

function stopRuntimeMonitor(pid = null) {
  if (pid && active?.pid !== pid) return;
  if (timer) clearInterval(timer);
  timer = null;
  if (active?.pid && pidusage) {
    try { pidusage.clear(active.pid); } catch (_) { /* process already gone */ }
  }
  previousProcSample = null;
  active = null;
  progressBus.emitEvent('resource-usage', snapshot());
}

function startRuntimeMonitor(child, metadata = {}) {
  stopRuntimeMonitor();
  active = {
    running: true,
    pid: child.pid,
    cpu: 0,
    memory: 0,
    elapsed: 0,
    startedAt: new Date().toISOString(),
    versionId: metadata.versionId || '',
    baseVersionId: metadata.baseVersionId || metadata.versionId || '',
    loader: metadata.loader || 'vanilla',
    username: metadata.username || ''
  };

  const poll = async () => {
    if (!active || active.pid !== child.pid) return;
    try {
      const usage = await getProcessUsage(child.pid);
      active.cpu = Math.max(0, Number(usage.cpu) || 0);
      active.memory = Math.max(0, Number(usage.memory) || 0);
      active.elapsed = Math.max(0, Date.now() - Date.parse(active.startedAt));
      progressBus.emitEvent('resource-usage', snapshot());
    } catch (error) {
      if (error.code === 'ESRCH' || error.message?.includes('No matching pid') || error.code === 'ENOENT') {
        stopRuntimeMonitor(child.pid);
      }
    }
  };

  poll();
  timer = setInterval(poll, 2000);
  timer.unref?.();
  child.once('close', () => stopRuntimeMonitor(child.pid));
  child.once('error', () => stopRuntimeMonitor(child.pid));
  return snapshot();
}

module.exports = { startRuntimeMonitor, stopRuntimeMonitor, getRuntimeUsage: snapshot };
