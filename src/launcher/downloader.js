const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');
const crypto = require('node:crypto');
const { ensureDir } = require('./store');

const USER_AGENT = 'AmethystLauncher/0.1 (+https://github.com/MinLOL12/Amethyst)';
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_RETRIES = 3;
const RETRYABLE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'EPROTO', 'EPIPE']);

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

function isRetryableError(error) {
  if (!error) return true;
  if (error.name === 'AbortError') return true;
  const code = error.code || (error.cause && error.cause.code);
  if (RETRYABLE_CODES.has(code)) return true;
  if (error.status && (error.status >= 500 || error.status === 429 || error.status === 408)) return true;
  return false;
}

async function withRetry(operation, options = {}) {
  const maxRetries = Math.max(0, Number(options.maxRetries ?? DEFAULT_MAX_RETRIES));
  const baseDelayMs = Math.max(100, Number(options.baseDelayMs ?? 1000));
  const timeoutMs = Math.max(1000, Number(options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const label = options.label || 'request';
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await operation(controller.signal);
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries) break;

      if (isRetryableError(error)) {
        const delay = baseDelayMs * (2 ** attempt);
        progressBus.emitEvent('status', {
          message: `${label} failed (${error.message}). Retrying ${attempt + 1}/${maxRetries} in ${delay}ms...`
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  const message = lastError?.message || `${label} failed after ${maxRetries + 1} attempts`;
  const wrapped = new Error(message);
  wrapped.cause = lastError;
  if (lastError?.status) wrapped.status = lastError.status;
  throw wrapped;
}

async function fetchJson(url, label = url, options = {}) {
  progressBus.emitEvent('status', { message: `Fetching ${label}` });
  const response = await withRetry(async (signal) => {
    const res = await fetch(url, {
      signal,
      headers: { 'User-Agent': USER_AGENT }
    });
    if (!res.ok) {
      const error = new Error(`${label} failed: HTTP ${res.status} ${res.statusText} (${url})`);
      error.status = res.status;
      throw error;
    }
    return res;
  }, { label, maxRetries: options.maxRetries, timeoutMs: options.timeoutMs });
  return response.json();
}

// Pure Node.js HTTP/HTTPS downloader (no fetch web streams, avoids freezes/hangs on large files)
async function downloadFile(url, destination, options = {}) {
  const { sha1, size, label = path.basename(destination) } = options;
  if (await isValidExistingFile(destination, { sha1, size })) {
    progressBus.emitEvent('download-skip', { label, destination });
    return { destination, skipped: true };
  }

  await ensureDir(path.dirname(destination));
  const temp = `${destination}.part`;
  progressBus.emitEvent('download-start', { label, url, destination, size: size || 0 });

  const { received, total } = await withRetry(async (signal) => {
    // Remove any partial file from a previous failed attempt.
    await fsp.rm(temp, { force: true });

    const response = await fetch(url, {
      signal,
      headers: { 'User-Agent': USER_AGENT }
    });
    if (!response.ok || !response.body) {
      const error = new Error(`${label} failed: HTTP ${response.status} ${response.statusText} (${url})`);
      error.status = response.status;
      throw error;
    }

    const totalBytes = Number(response.headers.get('content-length')) || size || 0;
    let receivedBytes = 0;
    let lastEmit = 0;

    const writable = fs.createWriteStream(temp);
    const counter = new TransformStream({
      transform(chunk, controller) {
        receivedBytes += chunk.byteLength;
        const now = Date.now();
        if (now - lastEmit > 150 || receivedBytes === totalBytes) {
          lastEmit = now;
          progressBus.emitEvent('download-progress', {
            label,
            destination,
            received: receivedBytes,
            total: totalBytes,
            percent: totalBytes ? Math.round((receivedBytes / totalBytes) * 1000) / 10 : 0
          });
        }
        controller.enqueue(chunk);
      }
    });

    await pipeline(response.body.pipeThrough(counter), writable);

    // Verify the file actually exists on disk after pipeline completes.
    // Under some conditions (empty web stream, premature close, Windows file
    // flush ordering) the writable may resolve without creating the file.
    let fileStat;
    try { fileStat = await fsp.stat(temp); } catch (_) { fileStat = null; }
    if (!fileStat || !fileStat.isFile() || fileStat.size === 0) {
      if (fileStat) await fsp.rm(temp, { force: true });
      throw new Error(`Download ${label} produced no data — the server returned an empty response`);
    }

    return { received: receivedBytes, total: totalBytes };
  }, { label, maxRetries: options.maxRetries, timeoutMs: options.timeoutMs });

  if (sha1) {
    const actual = await hashFile(temp, 'sha1');
    if (actual.toLowerCase() !== String(sha1).toLowerCase()) {
      await fsp.rm(temp, { force: true });
      throw new Error(`Checksum mismatch for ${label}; expected ${sha1}, got ${actual}`);
    }
  }

  await fsp.rename(temp, destination);
  progressBus.emitEvent('download-complete', { label, destination, received, total });
  return { destination, skipped: false };
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
  mapLimit,
  withRetry,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES
};
