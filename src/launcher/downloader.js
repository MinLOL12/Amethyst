const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { pipeline } = require('node:stream/promises');
const crypto = require('node:crypto');
const { ensureDir } = require('./store');

class ProgressBus extends EventEmitter {
  emitEvent(type, payload = {}) {
    this.emit('event', {
      type,
      at: new Date().toISOString(),
      ...payload
    });
  }
}

const progressBus = new ProgressBus();

async function fileExists(file) {
  try {
    await fsp.access(file, fs.constants.F_OK);
    return true;
  } catch (_) {
    return false;
  }
}

async function hashFile(file, algorithm = 'sha1') {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    const stream = fs.createReadStream(file);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function isValidExistingFile(file, expected = {}) {
  if (!(await fileExists(file))) return false;
  const stat = await fsp.stat(file);
  if (expected.size && stat.size !== expected.size) return false;
  if (expected.sha1) {
    const actual = await hashFile(file, 'sha1');
    return actual.toLowerCase() === String(expected.sha1).toLowerCase();
  }
  return true;
}

async function fetchJson(url, label = url) {
  progressBus.emitEvent('status', { message: `Fetching ${label}` });
  const response = await fetch(url, {
    headers: { 'User-Agent': 'AmethystLauncher/0.1 (+https://github.com/MinLOL12/Amethyst)' }
  });
  if (!response.ok) throw new Error(`Failed to fetch ${label}: HTTP ${response.status}`);
  return response.json();
}

async function downloadFile(url, destination, options = {}) {
  const { sha1, size, label = path.basename(destination), retries = 3 } = options;
  if (await isValidExistingFile(destination, { sha1, size })) {
    progressBus.emitEvent('download-skip', { label, destination });
    return { destination, skipped: true };
  }

  await ensureDir(path.dirname(destination));
  const temp = `${destination}.part`;

  let attempt = 0;
  while (true) {
    attempt++;
    const controller = new AbortController();
    const signal = controller.signal;

    // Set connection timeout: 15 seconds to establish headers
    const connectionTimeout = setTimeout(() => {
      controller.abort(new Error('Connection timeout (15s exceeded)'));
    }, 15000);

    try {
      progressBus.emitEvent('download-start', { label, url, destination, size: size || 0 });

      const response = await fetch(url, {
        headers: { 'User-Agent': 'AmethystLauncher/0.1 (+https://github.com/MinLOL12/Amethyst)' },
        signal
      });

      clearTimeout(connectionTimeout);

      if (!response.ok || !response.body) {
        throw new Error(`Failed to download ${label}: HTTP ${response.status}`);
      }

      const total = Number(response.headers.get('content-length')) || size || 0;
      let received = 0;
      let lastEmit = 0;

      const writable = fs.createWriteStream(temp);

      // Inactivity/activity timeout: if no chunks are received for 15 seconds, abort.
      let inactivityTimeout;
      const resetInactivityTimeout = () => {
        clearTimeout(inactivityTimeout);
        inactivityTimeout = setTimeout(() => {
          controller.abort(new Error('Inactivity timeout (15s without data stream chunks)'));
        }, 15000);
      };

      resetInactivityTimeout();

      const counter = new TransformStream({
        transform(chunk, controllerInstance) {
          resetInactivityTimeout();
          received += chunk.byteLength;
          const now = Date.now();
          if (now - lastEmit > 150 || received === total) {
            lastEmit = now;
            progressBus.emitEvent('download-progress', {
              label,
              destination,
              received,
              total,
              percent: total ? Math.round((received / total) * 1000) / 10 : 0
            });
          }
          controllerInstance.enqueue(chunk);
        },
        flush() {
          clearTimeout(inactivityTimeout);
        }
      });

      await pipeline(response.body.pipeThrough(counter), writable);
      clearTimeout(inactivityTimeout);

      if (sha1) {
        const actual = await hashFile(temp, 'sha1');
        if (actual.toLowerCase() !== String(sha1).toLowerCase()) {
          throw new Error(`Checksum mismatch for ${label}; expected ${sha1}, got ${actual}`);
        }
      }

      await fsp.rename(temp, destination);
      progressBus.emitEvent('download-complete', { label, destination, received, total });
      return { destination, skipped: false };

    } catch (err) {
      clearTimeout(connectionTimeout);
      // Ensure temp/part file is removed on failure
      try {
        await fsp.rm(temp, { force: true });
      } catch (_) {}

      if (attempt > retries) {
        throw err;
      }
      console.warn(`Download failed for ${label} (attempt ${attempt}/${retries + 1}): ${err.message}. Retrying...`);
      // Wait a short backoff period before retrying
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await worker(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

module.exports = {
  progressBus,
  fetchJson,
  downloadFile,
  isValidExistingFile,
  hashFile,
  mapLimit
};
