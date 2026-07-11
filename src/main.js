#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const os = require('node:os');
const { initializeStore } = require('./launcher/accounts');
const { createServer } = require('./server');
const { APP_NAME, APP_VERSION } = require('./config');

function browserCommands(url) {
  if (process.platform === 'win32') {
    return [{ command: 'cmd', args: ['/d', '/s', '/c', 'start', '', url] }];
  }

  if (process.platform === 'darwin') {
    return [{ command: 'open', args: [url] }];
  }

  const isWsl = Boolean(process.env.WSL_DISTRO_NAME) || /microsoft/iu.test(os.release());
  return [
    ...(isWsl ? [{ command: 'cmd.exe', args: ['/c', 'start', '', url] }] : []),
    { command: 'xdg-open', args: [url] },
    { command: 'gio', args: ['open', url] }
  ];
}

function runBrowserCommand({ command, args }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (opened) => {
      if (settled) return;
      settled = true;
      resolve(opened);
    };

    let child;
    try {
      child = spawn(command, args, {
        stdio: 'ignore',
        detached: true,
        windowsHide: true
      });
    } catch {
      finish(false);
      return;
    }

    child.once('error', () => finish(false));
    child.once('exit', (code) => finish(code === 0));
    child.unref();
  });
}

async function openBrowser(url) {
  for (const candidate of browserCommands(url)) {
    if (await runBrowserCommand(candidate)) return true;
  }
  return false;
}

function requestedPort(value) {
  if (value === undefined || value === '') return 0;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT must be an integer between 0 and 65535; received "${value}".`);
  }
  return port;
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

function printLauncherUrl(url) {
  // Keep the URL on its own line so terminals reliably make it clickable.
  console.log(`\n${APP_NAME} ${APP_VERSION} is ready.`);
  console.log('Open the launcher in your browser:');
  console.log(`\n  ${url}\n`);
  console.log('Keep this terminal open while you use the launcher.');
}

async function startBackend() {
  await initializeStore();

  const server = createServer();
  await listen(server, requestedPort(process.env.PORT));

  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

async function startLauncher() {
  const result = await startBackend();
  printLauncherUrl(result.url);

  if (process.env.AMETHYST_NO_OPEN) {
    console.log('Automatic browser opening is disabled; use the URL above.');
  } else {
    console.log('Opening your default browser...');
    void openBrowser(result.url).then((opened) => {
      if (!opened) {
        console.warn('\nCould not open a browser automatically. Open this URL manually:');
        console.warn(`\n  ${result.url}\n`);
      }
    });
  }

  return result;
}

if (require.main === module) {
  startLauncher().catch((error) => {
    console.error(`Unable to start ${APP_NAME}: ${error.message || error}`);
    process.exitCode = 1;
  });
}

module.exports = {
  browserCommands,
  openBrowser,
  requestedPort,
  startBackend,
  startLauncher
};
