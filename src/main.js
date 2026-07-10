const { spawn } = require('node:child_process');
const { initializeStore } = require('./launcher/accounts');
const { createServer } = require('./server');
const { APP_NAME, APP_VERSION } = require('./config');

function openBrowser(url) {
  if (process.env.AMETHYST_NO_OPEN) return;
  const platform = process.platform;
  const command = platform === 'win32' ? 'cmd' : platform === 'darwin' ? 'open' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  child.on('error', () => {});
  child.unref();
}

async function startBackend() {
  await initializeStore();
  const server = createServer();
  const port = Number(process.env.PORT) || 0;
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const url = `http://127.0.0.1:${address.port}/`;
      console.log(`${APP_NAME} ${APP_VERSION} is running at ${url}`);
      console.log('Close this terminal to stop the launcher backend.');
      resolve({ server, url });
    });
  });
}

async function main() {
  const { url } = await startBackend();
  openBrowser(url);
}

// Only run main() when this file is executed directly (not when imported by Electron)
if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { startBackend };
