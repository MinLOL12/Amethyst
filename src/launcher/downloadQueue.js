const { EventEmitter } = require('node:events');
const { progressBus } = require('./downloader');

/**
 * Download / install queue with progress, speed, and ETA reporting.
 */
class DownloadQueue extends EventEmitter {
  constructor({ concurrency = 1 } = {}) {
    super();
    this.concurrency = concurrency;
    this.queue = [];
    this.active = new Map();
    this.history = [];
    this.paused = false;
    this._running = 0;
    this._id = 0;
  }

  snapshot() {
    return {
      paused: this.paused,
      concurrency: this.concurrency,
      pending: this.queue.map(publicJob),
      active: [...this.active.values()].map(publicJob),
      history: this.history.slice(-20)
    };
  }

  enqueue(job) {
    const id = `job-${++this._id}-${Date.now()}`;
    const entry = {
      id,
      name: job.name || 'Download',
      type: job.type || 'generic',
      status: 'queued',
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      error: null,
      progress: { received: 0, total: 0, percent: 0, speedBps: 0, etaSeconds: null },
      run: job.run
    };
    this.queue.push(entry);
    progressBus.emitEvent('queue-update', this.snapshot());
    this._pump();
    return publicJob(entry);
  }

  pause() {
    this.paused = true;
    progressBus.emitEvent('queue-update', this.snapshot());
  }

  resume() {
    this.paused = false;
    progressBus.emitEvent('queue-update', this.snapshot());
    this._pump();
  }

  cancel(jobId) {
    const idx = this.queue.findIndex((j) => j.id === jobId);
    if (idx >= 0) {
      const [job] = this.queue.splice(idx, 1);
      job.status = 'cancelled';
      job.finishedAt = new Date().toISOString();
      this.history.push(publicJob(job));
      progressBus.emitEvent('queue-update', this.snapshot());
      return true;
    }
    const active = this.active.get(jobId);
    if (active) {
      active.status = 'cancelling';
      active._cancel = true;
      progressBus.emitEvent('queue-update', this.snapshot());
      return true;
    }
    return false;
  }

  clearFinished() {
    this.history = [];
    progressBus.emitEvent('queue-update', this.snapshot());
  }

  updateJobProgress(jobId, progress) {
    const job = this.active.get(jobId);
    if (!job) return;
    const now = Date.now();
    const received = Number(progress.received) || 0;
    const total = Number(progress.total) || job.progress.total || 0;

    if (!job._speedWindow) {
      job._speedWindow = { t: now, bytes: received };
    }
    const dt = (now - job._speedWindow.t) / 1000;
    let speedBps = job.progress.speedBps || 0;
    if (dt >= 0.5) {
      speedBps = Math.max(0, (received - job._speedWindow.bytes) / dt);
      job._speedWindow = { t: now, bytes: received };
    }

    const remaining = total > received ? total - received : 0;
    const etaSeconds = speedBps > 0 ? Math.round(remaining / speedBps) : null;

    job.progress = {
      received,
      total,
      percent: total ? Math.round((received / total) * 1000) / 10 : Number(progress.percent) || 0,
      speedBps: Math.round(speedBps),
      etaSeconds,
      label: progress.label || job.progress.label
    };

    progressBus.emitEvent('queue-progress', {
      id: job.id,
      name: job.name,
      ...job.progress,
      speedText: formatSpeed(speedBps),
      etaText: formatEta(etaSeconds)
    });
  }

  async _pump() {
    if (this.paused) return;
    while (this._running < this.concurrency && this.queue.length) {
      const job = this.queue.shift();
      this._running += 1;
      job.status = 'running';
      job.startedAt = new Date().toISOString();
      this.active.set(job.id, job);
      progressBus.emitEvent('queue-update', this.snapshot());
      progressBus.emitEvent('queue-start', { id: job.id, name: job.name, type: job.type });

      this._runJob(job).finally(() => {
        this.active.delete(job.id);
        this._running -= 1;
        this.history.push(publicJob(job));
        progressBus.emitEvent('queue-update', this.snapshot());
        this._pump();
      });
    }
  }

  async _runJob(job) {
    try {
      const result = await job.run({
        jobId: job.id,
        isCancelled: () => Boolean(job._cancel),
        setProgress: (progress) => this.updateJobProgress(job.id, progress)
      });
      if (job._cancel) {
        job.status = 'cancelled';
      } else {
        job.status = 'complete';
        job.result = result;
        job.progress.percent = 100;
      }
      job.finishedAt = new Date().toISOString();
      progressBus.emitEvent('queue-complete', { id: job.id, name: job.name, status: job.status });
    } catch (error) {
      job.status = 'error';
      job.error = error.message;
      job.finishedAt = new Date().toISOString();
      progressBus.emitEvent('queue-error', { id: job.id, name: job.name, message: error.message });
    }
  }
}

function publicJob(job) {
  return {
    id: job.id,
    name: job.name,
    type: job.type,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
    progress: job.progress
  };
}

function formatSpeed(bps) {
  if (!bps || bps < 1) return '—';
  if (bps < 1024) return `${Math.round(bps)} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${(bps / (1024 * 1024)).toFixed(2)} MB/s`;
}

function formatEta(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

const downloadQueue = new DownloadQueue({ concurrency: 1 });

// Bridge raw download-progress events into the active queue job when only one is running.
progressBus.on('event', (event) => {
  if (event.type !== 'download-progress') return;
  const activeJobs = [...downloadQueue.active.values()];
  if (activeJobs.length === 1) {
    downloadQueue.updateJobProgress(activeJobs[0].id, event);
  }
});

module.exports = {
  DownloadQueue,
  downloadQueue,
  formatSpeed,
  formatEta
};
