'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { requestedPort } = require('../src/main');

function waitForLauncherUrl(child, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => {
      reject(new Error(`Launcher did not print its URL within ${timeoutMs}ms. Output:\n${output}`));
    }, timeoutMs);

    const inspect = (chunk) => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//u);
      if (!match) return;
      clearTimeout(timeout);
      resolve({ url: match[0], output });
    };

    child.stdout.on('data', inspect);
    child.stderr.on('data', inspect);
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(`Launcher exited before becoming ready (${signal || code}). Output:\n${output}`));
    });
  });
}

function getPage(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ statusCode: response.statusCode, body }));
    });
    request.setTimeout(3000, () => request.destroy(new Error('Timed out loading the launcher page.')));
    request.on('error', reject);
  });
}

async function run() {
  assert.equal(requestedPort(undefined), 0);
  assert.equal(requestedPort('8080'), 8080);
  assert.throws(() => requestedPort('not-a-port'), /PORT must be an integer/u);

  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'amethyst-startup-'));
  const child = spawn(process.execPath, ['src/main.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      AMETHYST_HOME: dataRoot,
      AMETHYST_NO_OPEN: '1',
      PORT: '0'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const exited = new Promise((resolve) => child.once('exit', resolve));

  try {
    const ready = await waitForLauncherUrl(child);
    assert.match(ready.output, /Open the launcher in your browser:/u);

    const page = await getPage(ready.url);
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /<title>[^<]*Amethyst[^<]*<\/title>/iu);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2000))]);
    await fs.rm(dataRoot, { recursive: true, force: true });
  }

  console.log('startup tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
