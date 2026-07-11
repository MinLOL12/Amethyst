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

const USER_AGENT = 'AmethystLauncher/0.2 (+https://github.com/MinLOL12/Amethyst)';
const DEFAULT_TIMEOUT_MS = 45000;
const DEFAULT_MAX_RETRIES = 5;
const RETRYABLE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'EPROTO', 'EPIPE', 'ECONNABORTED', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT']);

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
  // Empty files are never valid, even if size wasn't specified
  if (stat.size === 0) return false;
  return true;
}

function markRetryable(error, retryable = true) {
  if (error && typeof error === 'object') {
    try { error.retryable = retryable; } catch (_) {}
  }
  return error;
}

function isRetryableError(error) {
  if (!error) return true;
  if (error.retryable === true) return true;
  if (error.retryable === false) return false;
  if (error.name === 'AbortError') return true;
  const code = error.code || (error.cause && error.cause.code);
  if (code && RETRYABLE_CODES.has(code)) return true;
  if (error.status && (error.status >= 500 || error.status === 429 || error.status === 408 || error.status === 0)) return true;

  const msg = String(error.message || '').toLowerCase();
  // Network / empty response patterns that should be retried
  if (msg.includes('empty response') ||
      msg.includes('produced no data') ||
      msg.includes('checksum mismatch') ||
      msg.includes('socket') ||
      msg.includes('econnreset') ||
      msg.includes('etimedout') ||
      msg.includes('eai_again') ||
      msg.includes('unexpected end') ||
      msg.includes('premature close') ||
      msg.includes('aborted') ||
      msg.includes('timeout') ||
      msg.includes('network') ||
      msg.includes('failed to fetch') ||
      msg.includes('other side closed') ||
      msg.includes('size mismatch') ||
      msg.includes('0 bytes')) {
    return true;
  }
  return false;
}

async function withRetry(operation, options = {}) {
  const maxRetries = Math.max(0, Number(options.maxRetries ?? DEFAULT_MAX_RETRIES));
  const baseDelayMs = Math.max(100, Number(options.baseDelayMs ?? 800));
  const timeoutMs = Math.max(1000, Number(options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const label = options.label || 'request';
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await operation(controller.signal, attempt);
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries) break;

      if (isRetryableError(error)) {
        const delay = Math.min(baseDelayMs * (2 ** attempt), 8000) + Math.floor(Math.random() * 250);
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
  if (lastError?.code) wrapped.code = lastError.code;
  markRetryable(wrapped, isRetryableError(lastError));
  throw wrapped;
}

async function fetchJson(url, label = url, options = {}) {
  progressBus.emitEvent('status', { message: `Fetching ${label}` });
  const response = await withRetry(async (signal) => {
    const res = await fetch(url, {
      signal,
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      redirect: 'follow'
    });
    if (!res.ok) {
      const error = new Error(`${label} failed: HTTP ${res.status} ${res.statusText} (${url})`);
      error.status = res.status;
      markRetryable(error, res.status >= 500 || res.status === 429 || res.status === 408);
      throw error;
    }
    return res;
  }, { label, maxRetries: options.maxRetries, timeoutMs: options.timeoutMs });
  return response.json();
}

// Build a list of mirror URLs to try, automatically expanding Minecraft asset URLs.
function buildTryUrls(primaryUrl) {
  const urls = [];
  const seen = new Set();
  function add(u) {
    if (!u || seen.has(u)) return;
    seen.add(u);
    urls.push(u);
  }
  add(primaryUrl);

  try {
    const parsed = new URL(primaryUrl);
    // If this looks like a Minecraft asset object URL: /aa/<40-hex-hash>
    const assetMatch = parsed.pathname.match(/^\/([a-f0-9]{2})\/([a-f0-9]{38,})$/i);
    if (assetMatch && parsed.hostname.includes('minecraft.net')) {
      const { RESOURCES_MIRRORS, RESOURCES_BASE_URL } = require('../config');
      const prefix = assetMatch[1];
      const hash = assetMatch[2];
      const bases = [RESOURCES_BASE_URL, ...(RESOURCES_MIRRORS || [])];
      for (const base of bases) {
        try {
          const baseUrl = new URL(base);
          const mirrorPath = `${baseUrl.pathname.replace(/\/+$/, '')}/${prefix}/${hash}`;
          baseUrl.pathname = mirrorPath;
          baseUrl.search = '';
          add(baseUrl.toString());
        } catch (_) {}
      }
    }
  } catch (_) {}

  return urls;
}

async function downloadFromUrlOnce(downloadUrl, temp, signal, label, destination, expectedSize) {
  // Remove any partial file from a previous failed attempt.
  await fsp.rm(temp, { force: true });

  const response = await fetch(downloadUrl, {
    signal,
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': '*/*',
      'Connection': 'keep-alive',
      'Accept-Encoding': 'identity'
    },
    redirect: 'follow'
  });

  if (!response.ok || !response.body) {
    const error = new Error(`HTTP ${response.status} ${response.statusText} for ${label}`);
    error.status = response.status;
    markRetryable(error, response.status >= 500 || response.status === 429 || response.status === 408);
    throw error;
  }

  const contentLengthHeader = response.headers.get('content-length');
  const totalBytes = Number(contentLengthHeader) || expectedSize || 0;

  // Empty content-length is suspicious for assets, but not necessarily fatal – we’ll validate after.
  if (contentLengthHeader === '0') {
    const error = new Error(`Download ${label} produced no data — the server returned an empty response (content-length: 0)`);
    error.code = 'EMPTY_RESPONSE';
    markRetryable(error, true);
    throw error;
  }

  let receivedBytes = 0;
  let lastEmit = 0;

  const writable = fs.createWriteStream(temp);

  // Use a web TransformStream to count bytes, then pipe to Node writable via pipeline which supports web streams in modern Node.
  const counter = new TransformStream({
    transform(chunk, controller) {
      receivedBytes += chunk.byteLength;
      const now = Date.now();
      if (now - lastEmit > 120 || (totalBytes && receivedBytes >= totalBytes)) {
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

  try {
    await pipeline(response.body.pipeThrough(counter), writable);
  } catch (pipeError) {
    // Ensure writable is closed and temp cleaned up
    try { writable.destroy(); } catch (_) {}
    await fsp.rm(temp, { force: true }).catch(() => {});
    markRetryable(pipeError, true);
    throw pipeError;
  }

  // Verify the file actually exists on disk after pipeline completes.
  let fileStat;
  try { fileStat = await fsp.stat(temp); } catch (_) { fileStat = null; }
  if (!fileStat || !fileStat.isFile() || fileStat.size === 0) {
    if (fileStat) await fsp.rm(temp, { force: true }).catch(() => {});
    const error = new Error(`Download ${label} produced no data — the server returned an empty response`);
    error.code = 'EMPTY_RESPONSE';
    markRetryable(error, true);
    throw error;
  }

  if (receivedBytes === 0) {
    await fsp.rm(temp, { force: true }).catch(() => {});
    const error = new Error(`Download ${label} produced no data — 0 bytes received`);
    error.code = 'EMPTY_RESPONSE';
    markRetryable(error, true);
    throw error;
  }

  // If server told us a size, validate it
  if (totalBytes && fileStat.size !== totalBytes && expectedSize !== fileStat.size) {
    // Allow mismatch only if expectedSize was provided and matches, otherwise retry
    if (!expectedSize || fileStat.size !== expectedSize) {
      await fsp.rm(temp, { force: true }).catch(() => {});
      const error = new Error(`Download ${label} size mismatch: expected ${totalBytes} bytes, got ${fileStat.size}`);
      error.code = 'SIZE_MISMATCH';
      markRetryable(error, true);
      throw error;
    }
  }

  if (expectedSize && fileStat.size !== expectedSize) {
    await fsp.rm(temp, { force: true }).catch(() => {});
    const error = new Error(`Download ${label} size mismatch: expected ${expectedSize} bytes, got ${fileStat.size}`);
    error.code = 'SIZE_MISMATCH';
    markRetryable(error, true);
    throw error;
  }

  return { received: receivedBytes || fileStat.size, total: totalBytes || fileStat.size };
}

// Pure Node.js HTTP/HTTPS downloader (no fetch web streams, avoids freezes/hangs on large files)
async function downloadFile(url, destination, options = {}) {
  const { sha1, size, label = path.basename(destination), alternativeUrls = [] } = options;
  if (await isValidExistingFile(destination, { sha1, size })) {
    progressBus.emitEvent('download-skip', { label, destination });
    return { destination, skipped: true };
  }

  await ensureDir(path.dirname(destination));
  const temp = `${destination}.part`;

  // Build ordered list of URLs to try: explicit alternatives first, then auto-mirrors
  const tryUrls = [];
  const seen = new Set();
  function pushUrl(u) {
    if (!u || seen.has(u)) return;
    seen.add(u);
    tryUrls.push(u);
  }
  pushUrl(url);
  for (const alt of alternativeUrls || []) pushUrl(alt);
  for (const auto of buildTryUrls(url)) pushUrl(auto);

  progressBus.emitEvent('download-start', { label, url: tryUrls[0], destination, size: size || 0 });

  let lastError = null;
  for (let urlIndex = 0; urlIndex < tryUrls.length; urlIndex++) {
    const tryUrl = tryUrls[urlIndex];
    if (urlIndex > 0) {
      progressBus.emitEvent('status', {
        message: `${label}: trying mirror ${urlIndex + 1}/${tryUrls.length}: ${new URL(tryUrl).hostname}`
      });
    }

    try {
      const { received, total } = await withRetry(async (signal, attempt) => {
        return downloadFromUrlOnce(tryUrl, temp, signal, label, destination, size);
      }, {
        label: `${label} [${new URL(tryUrl).hostname}]`,
        maxRetries: options.maxRetries,
        timeoutMs: options.timeoutMs,
        baseDelayMs: options.baseDelayMs
      });

      // Verify checksum if provided
      if (sha1) {
        const actual = await hashFile(temp, 'sha1');
        if (actual.toLowerCase() !== String(sha1).toLowerCase()) {
          await fsp.rm(temp, { force: true }).catch(() => {});
          const error = new Error(`Checksum mismatch for ${label}; expected ${sha1}, got ${actual}`);
          error.code = 'CHECKSUM_MISMATCH';
          markRetryable(error, true);
          throw error;
        }
      }

      await fsp.rename(temp, destination);
      progressBus.emitEvent('download-complete', { label, destination, received, total, url: tryUrl });
      return { destination, skipped: false, url: tryUrl };
    } catch (error) {
      lastError = error;
      // Clean up temp file before trying next mirror
      await fsp.rm(temp, { force: true }).catch(() => {});
      progressBus.emitEvent('status', {
        message: `${label} failed from ${new URL(tryUrl).hostname}: ${error.message}`
      });
      // Try next mirror
      continue;
    }
  }

  // All mirrors exhausted
  const finalMessage = lastError?.message || `${label} failed from all ${tryUrls.length} mirror(s)`;
  const wrapped = new Error(finalMessage);
  wrapped.cause = lastError;
  if (lastError?.status) wrapped.status = lastError.status;
  if (lastError?.code) wrapped.code = lastError.code;
  markRetryable(wrapped, true);
  throw wrapped;
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
  DEFAULT_MAX_RETRIES,
  isRetryableError,
  markRetryable
};
