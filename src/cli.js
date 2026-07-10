const readline = require('node:readline');
const { listVersions } = require('./launcher/mojangApi');
const { scanJavaInstallations, pickJava, recommendedJavaMajor } = require('./launcher/javaLocator');
const { listAccounts, addOfflineAccount, readSettings, saveSettings } = require('./launcher/accounts');
const { installVersion, launchVersion } = require('./launcher/minecraft');
const { progressBus } = require('./launcher/downloader');
const { APP_NAME, APP_VERSION } = require('./config');

let rl;

function createReadline() {
  if (!rl) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '> '
    });
  }
  return rl;
}

function closeReadline() {
  if (rl) {
    rl.close();
    rl = null;
  }
}

function log(message) {
  console.log(`[${new Date().toLocaleTimeString()}] ${message}`);
}

function question(prompt) {
  return new Promise((resolve) => {
    const r = createReadline();
    r.question(prompt, (answer) => {
      resolve(answer.trim());
    });
  });
}

progressBus.on('event', (event) => {
  const e = event;
  if (e.type === 'download-progress') {
    const pct = e.percent ? `${e.percent}%` : '';
    process.stdout.write(`\r${e.label}: ${pct} (${e.received}/${e.total || '?'})   `);
  } else if (e.type === 'download-start') {
    process.stdout.write(`\nDownloading ${e.label}...\n`);
  } else if (e.type === 'download-complete') {
    console.log(`\nDownloaded ${e.label}`);
  } else if (e.type === 'download-skip') {
    log(`Already have ${e.label}`);
  } else if (e.type === 'status') {
    log(e.message);
  } else if (e.type === 'task-start') {
    log(`Started: ${e.name}`);
  } else if (e.type === 'task-complete') {
    log(`Complete: ${e.name}`);
  } else if (e.type === 'task-error') {
    log(`ERROR: ${e.name} - ${e.message}`);
  } else if (e.type === 'install-start') {
    log(`Installing ${e.versionId}...`);
  } else if (e.type === 'install-complete') {
    log(`Installed ${e.versionId}`);
  } else if (e.type === 'launch-start') {
    log(`Launching ${e.versionId}...`);
  }
});

async function chooseVersion() {
  log('Fetching version list...');
  const data = await listVersions();
  const versions = data.versions.slice(0, 60); // limit for display

  console.log('\nAvailable versions (recent first):');
  versions.forEach((v, i) => {
    console.log(`  ${i + 1}. ${v.id} (${v.type})`);
  });

  const answer = await question('\nEnter version number or ID (e.g. 1 or 1.21.1): ');
  if (/^\d+$/.test(answer)) {
    const idx = parseInt(answer, 10) - 1;
    if (versions[idx]) return versions[idx].id;
  }
  // fallback to exact match
  const found = data.versions.find(v => v.id === answer || v.id.startsWith(answer));
  if (found) return found.id;
  return answer; // let backend validate
}

async function ensureAccount() {
  const accounts = await listAccounts();
  if (accounts.length > 0) {
    console.log('\nAccounts:');
    accounts.forEach((a, i) => console.log(`  ${i + 1}. ${a.username}`));
    const ans = await question('Select account number or press Enter for first: ');
    if (ans && /^\d+$/.test(ans)) {
      const idx = parseInt(ans, 10) - 1;
      if (accounts[idx]) return accounts[idx];
    }
    return accounts[0];
  }

  // create new
  const username = await question('No accounts. Enter offline username (3-16 chars): ');
  if (!username) throw new Error('Username required');
  return await addOfflineAccount(username);
}

async function getSettings() {
  const settings = await readSettings();
  console.log(`\nCurrent settings: memory=${settings.memoryMb}MB, java=${settings.javaPath || '(auto)'}`);
  const mem = await question(`Memory MB [${settings.memoryMb}]: `);
  const java = await question(`Java path [${settings.javaPath || 'auto'}]: `);

  if (mem || java) {
    const newSettings = await saveSettings({
      ...settings,
      memoryMb: mem ? parseInt(mem, 10) : settings.memoryMb,
      javaPath: java || settings.javaPath
    });
    return newSettings;
  }
  return settings;
}

async function cmdList() {
  try {
    const data = await listVersions();
    console.log(`\n${APP_NAME} ${APP_VERSION}`);
    console.log(`Latest: ${data.latest?.release} / ${data.latest?.snapshot}`);
    console.log(`Total versions: ${data.versions.length}`);
    console.log('\nFirst 20 releases:');
    data.versions.filter(v => v.type === 'release').slice(0, 20).forEach(v => {
      console.log(`  ${v.id}`);
    });
  } catch (e) {
    console.error('Failed to fetch versions:', e.message);
    console.log('You can still use a known version ID directly, e.g. "install 1.21.1"');
  }
}

async function cmdInstall(versionIdArg) {
  let versionId = versionIdArg;
  if (!versionId) {
    versionId = await chooseVersion();
  }
  if (!versionId) throw new Error('Version required');

  const settings = await getSettings();
  const account = await ensureAccount();

  log(`Installing ${versionId}...`);
  const result = await installVersion(versionId, {
    gameDir: settings.gameDir,
    concurrency: settings.maxConcurrentDownloads,
    memoryMb: settings.memoryMb,
    javaPath: settings.javaPath
  });
  log(`Install complete. Game dir: ${result.paths.root}`);

  // save last used
  await saveSettings({ ...settings, lastVersion: versionId, lastAccountId: account.id });
}

async function cmdLaunch(versionIdArg) {
  let versionId = versionIdArg;
  if (!versionId) {
    versionId = await chooseVersion();
  }
  if (!versionId) throw new Error('Version required');

  const settings = await getSettings();
  const account = await ensureAccount();

  // make sure installed
  log('Ensuring installed...');
  await installVersion(versionId, {
    gameDir: settings.gameDir,
    concurrency: settings.maxConcurrentDownloads
  });

  log(`Launching ${versionId}...`);
  const result = await launchVersion(versionId, account, {
    gameDir: settings.gameDir,
    memoryMb: settings.memoryMb,
    javaPath: settings.javaPath
  });
  log(`Launched PID ${result.pid}`);
}

async function cmdJava() {
  log('Scanning Java...');
  const installs = await scanJavaInstallations();
  if (!installs.length) {
    console.log('No Java found. Install Java 17+ (recommended 21).');
    return;
  }
  console.log('\nDetected Java:');
  installs.forEach((j, i) => console.log(`  ${i + 1}. ${j.path} (Java ${j.major || j.version})`));
}

async function showMenu() {
  console.log(`
${APP_NAME} ${APP_VERSION} - Standalone CLI
1. List versions
2. Install version
3. Launch version
4. Scan Java
5. Settings / Accounts
6. Exit
`);
  const choice = await question('Choose [1-6]: ');
  switch (choice) {
    case '1':
      await cmdList();
      break;
    case '2':
      await cmdInstall();
      break;
    case '3':
      await cmdLaunch();
      break;
    case '4':
      await cmdJava();
      break;
    case '5':
      await getSettings();
      await ensureAccount();
      break;
    case '6':
      return false;
    default:
      log('Invalid choice');
  }
  return true;
}

async function runInteractive() {
  console.log(`${APP_NAME} ${APP_VERSION} (standalone CLI - no browser/HTML required)`);
  console.log('Tip: You can also pass commands: node src/main.js install 1.21.1');
  let keep = true;
  while (keep) {
    try {
      keep = await showMenu();
    } catch (err) {
      console.error('Error:', err.message);
    }
  }
  closeReadline();
  console.log('Goodbye.');
}

async function runCLI(args) {
  const cmd = args[0];
  try {
    if (!cmd || cmd === 'menu' || cmd === 'interactive') {
      await runInteractive();
      return;
    }
    if (cmd === 'list' || cmd === 'versions') {
      await cmdList();
    } else if (cmd === 'install') {
      await cmdInstall(args[1]);
    } else if (cmd === 'launch') {
      await cmdLaunch(args[1]);
    } else if (cmd === 'java') {
      await cmdJava();
    } else if (cmd === 'help') {
      console.log(`Usage:
  node src/main.js                  # interactive menu
  node src/main.js list
  node src/main.js install <version>
  node src/main.js launch <version>
  node src/main.js java
  node src/main.js --server         # start web UI (if desired)
`);
    } else {
      console.log('Unknown command. Try: node src/main.js help');
    }
  } catch (err) {
    console.error('CLI Error:', err.message);
    process.exitCode = 1;
  } finally {
    closeReadline();
  }
}

module.exports = {
  runCLI,
  runInteractive
};
