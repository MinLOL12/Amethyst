#!/usr/bin/env node
const { initializeStore } = require('./launcher/accounts');
const { runCLI } = require('./cli');
const { createServer } = require('./server');
const { APP_NAME, APP_VERSION } = require('./config');

const args = process.argv.slice(2);
const wantsServer = args.includes('--server') || args.includes('server') ||
                    process.env.AMETHYST_SERVER === '1' || process.env.PORT;

async function startServer() {
  const server = createServer();
  const port = Number(process.env.PORT) || 0;
  server.listen(port, '127.0.0.1', () => {
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}/`;
    console.log(`${APP_NAME} ${APP_VERSION} web UI running at ${url}`);
    console.log('Use --server or set AMETHYST_SERVER=1 to start the browser UI mode.');
    console.log('Close this terminal to stop.');
    if (!process.env.AMETHYST_NO_OPEN) {
      // optional browser open kept for server mode only
      const { spawn } = require('node:child_process');
      const platform = process.platform;
      const cmd = platform === 'win32' ? 'cmd' : platform === 'darwin' ? 'open' : 'xdg-open';
      const cmdArgs = platform === 'win32' ? ['/c', 'start', '', url] : [url];
      const child = spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true });
      child.on('error', () => {});
      child.unref();
    }
  });
}

async function main() {
  await initializeStore();

  if (wantsServer) {
    await startServer();
    return;
  }

  // Default: pure standalone CLI (no HTML, no browser, no web JS required)
  console.log(`${APP_NAME} ${APP_VERSION} - Standalone CLI mode`);
  console.log('No browser or web UI required. Use "help" for commands.');
  await runCLI(args);
}

main().catch((error) => {
  console.error('Fatal error:', error.message || error);
  process.exitCode = 1;
});
