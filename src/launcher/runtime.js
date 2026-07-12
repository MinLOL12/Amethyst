const pidusage = require('pidusage');
const { progressBus } = require('./downloader');

let active = null;
let timer = null;

function snapshot() {
  if (!active) return { running: false, pid: null, cpu: 0, memory: 0 };
  return { ...active };
}

function stopRuntimeMonitor(pid = null) {
  if (pid && active?.pid !== pid) return;
  if (timer) clearInterval(timer);
  timer = null;
  if (active?.pid) {
    try { pidusage.clear(active.pid); } catch (_) { /* process already gone */ }
  }
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
      const usage = await pidusage(child.pid);
      active.cpu = Math.max(0, Number(usage.cpu) || 0);
      active.memory = Math.max(0, Number(usage.memory) || 0);
      active.elapsed = Math.max(0, Date.now() - Date.parse(active.startedAt));
      progressBus.emitEvent('resource-usage', snapshot());
    } catch (error) {
      if (error.code === 'ESRCH' || error.message?.includes('No matching pid')) {
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
