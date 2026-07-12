const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');

// Isolate data root for tests.
const tmpRoot = path.join(os.tmpdir(), `amethyst-test-${Date.now()}`);
process.env.AMETHYST_HOME = tmpRoot;

const {
  addOfflineAccount,
  listAccounts,
  saveSettings,
  readSettings,
  setActiveAccount
} = require('../src/launcher/accounts');
const {
  createInstance,
  listInstances,
  renameInstance,
  duplicateInstance,
  deleteInstance,
  updateInstance,
  exportInstance,
  importInstance
} = require('../src/launcher/instances');
const { LOADERS } = require('../src/launcher/modLoaders');
const { DownloadQueue, formatSpeed, formatEta } = require('../src/launcher/downloadQueue');
const { appendLog, getLogs, getLogText, clearLogs } = require('../src/launcher/logs');
const { resolveFolder, listFolderShortcuts } = require('../src/launcher/folders');
const { gamePaths } = require('../src/launcher/minecraftPaths');
const { replacePlaceholders, legacySplitArguments, buildLaunchCommand } = require('../src/launcher/minecraft');

async function main() {
  // Accounts: multiple offline accounts + switch without reauth.
  const a1 = await addOfflineAccount('Steve_One');
  const a2 = await addOfflineAccount('Alex_Two');
  const accounts = await listAccounts();
  assert.equal(accounts.length, 2);
  assert.equal(a1.type, 'offline');
  assert.ok(accounts.some((a) => a.username === 'Alex_Two'));

  const switched = await setActiveAccount(a2.id);
  assert.equal(switched.username, 'Alex_Two');
  const settings = await readSettings();
  assert.equal(settings.lastAccountId, a2.id);

  // Settings: game options.
  const saved = await saveSettings({
    memoryMb: 4096,
    resolutionWidth: 1920,
    resolutionHeight: 1080,
    fullscreen: true,
    jvmArgs: '-XX:+UseG1GC',
    launchArgs: '--demo',
    rememberMicrosoftLogin: true
  });
  assert.equal(saved.memoryMb, 4096);
  assert.equal(saved.resolutionWidth, 1920);
  assert.equal(saved.fullscreen, true);
  assert.equal(saved.jvmArgs, '-XX:+UseG1GC');

  // Discord RPC remains optional, but enabling it requires a valid
  // Application ID (snowflake) or a bot-token paste that encodes one.
  await assert.rejects(
    saveSettings({ discordEnabled: true, discordClientId: '' }),
    /Discord Application ID is required/u
  );
  await assert.rejects(
    saveSettings({ discordEnabled: true, discordClientId: 'not-an-id' }),
    /valid Discord Application ID or bot token/u
  );
  const discordSettings = await saveSettings({
    discordEnabled: true,
    discordClientId: '123456789012345678'
  });
  assert.equal(discordSettings.discordEnabled, true);
  assert.equal(discordSettings.discordClientId, '123456789012345678');

  // Bot tokens contain letters and must be accepted; the snowflake is stored.
  const tokenSettings = await saveSettings({
    discordEnabled: true,
    discordClientId: 'MTQ1OTc2MDg4NzI2NjAxNzQ4NA.GZthgJ.CP-KZ2hoNEnXBqcps_3wWs8bN5qKmpOAsCQh9g'
  });
  assert.equal(tokenSettings.discordEnabled, true);
  assert.equal(tokenSettings.discordClientId, '1459760887266017484');

  await assert.rejects(
    saveSettings({ discordClientId: '' }),
    /Discord Application ID is required/u
  );
  const discordDisabled = await saveSettings({ discordEnabled: false, discordClientId: '' });
  assert.equal(discordDisabled.discordEnabled, false);
  assert.equal(discordDisabled.discordClientId, '');

  // Theme collection: a player can retain multiple sanitized themes and select
  // one to apply on the next launch. Invalid colour input falls back safely.
  const themed = await saveSettings({
    themes: [
      { id: 'amethyst', name: 'Amethyst', background: '#0b0912', panel: '#171223', accent: '#a879ff', accentBright: '#c6a8ff', text: '#f7f4ff' },
      { id: 'sunset', name: 'Sunset', background: '#20121f', panel: '#35203a', accent: '#ed7bba', accentBright: '#ffc3e5', text: '#fff4fb' },
      { id: 'broken', name: 'Broken colour', background: 'not-a-colour' }
    ],
    activeThemeId: 'sunset'
  });
  assert.equal(themed.themes.length, 3);
  assert.equal(themed.activeThemeId, 'sunset');
  assert.equal(themed.theme.name, 'Sunset');
  assert.equal(themed.themes.find((theme) => theme.id === 'broken').background, '#0b0912');
  assert.equal((await readSettings()).theme.id, 'sunset');

  // Instances: create, rename, duplicate, delete, export/import.
  const inst = await createInstance({
    name: 'Test Fabric Pack',
    versionId: '1.21.1',
    loader: 'fabric',
    loaderVersion: '0.16.0',
    memoryMb: 3072,
    javaPath: '',
    jvmArgs: '-Xss1M'
  });
  assert.equal(inst.loader, 'fabric');
  assert.ok(inst.gameDir.includes('instances'));
  assert.equal((await listInstances()).length, 1);

  const renamed = await renameInstance(inst.id, 'Renamed Pack');
  assert.equal(renamed.name, 'Renamed Pack');

  const copy = await duplicateInstance(inst.id, 'Pack Copy');
  assert.equal(copy.name, 'Pack Copy');
  assert.equal(copy.versionId, '1.21.1');
  assert.notEqual(copy.id, inst.id);
  assert.equal((await listInstances()).length, 2);

  const updated = await updateInstance(copy.id, {
    memoryMb: 8192,
    resolutionWidth: 1280,
    resolutionHeight: 720,
    fullscreen: false
  });
  assert.equal(updated.memoryMb, 8192);

  const exported = await exportInstance(inst.id);
  assert.ok(exported.destination.endsWith('.zip'));
  const zipStat = await fs.stat(exported.destination);
  assert.ok(zipStat.size > 20);

  const imported = await importInstance(exported.destination, { name: 'Imported Pack' });
  assert.equal(imported.name, 'Imported Pack');
  assert.equal(imported.versionId, '1.21.1');

  await deleteInstance(copy.id, { deleteFiles: true });
  assert.ok((await listInstances()).every((i) => i.id !== copy.id));

  // Mod loaders list.
  assert.deepEqual(LOADERS, ['vanilla', 'fabric', 'forge', 'neoforge', 'quilt']);

  // Download queue: progress / speed / ETA helpers + queue.
  assert.equal(formatSpeed(0), '—');
  assert.match(formatSpeed(2048), /KB\/s/);
  assert.match(formatEta(90), /1m/);

  const queue = new DownloadQueue({ concurrency: 1 });
  let ran = false;
  const job = queue.enqueue({
    name: 'Test job',
    type: 'test',
    run: async ({ setProgress }) => {
      setProgress({ received: 50, total: 100, percent: 50 });
      ran = true;
      return { ok: true };
    }
  });
  assert.ok(['queued', 'running', 'complete'].includes(job.status));
  // Wait for completion.
  for (let i = 0; i < 80 && !ran; i++) await new Promise((r) => setTimeout(r, 25));
  assert.equal(ran, true);
  for (let i = 0; i < 40; i++) {
    const snap = queue.snapshot();
    if (snap.history.some((h) => h.name === 'Test job' && h.status === 'complete')) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  const snap = queue.snapshot();
  assert.ok(snap.history.some((h) => h.name === 'Test job' && h.status === 'complete'));

  // Logs: live buffer, search, copy text.
  clearLogs();
  appendLog({ stream: 'stdout', message: 'Hello Minecraft' });
  appendLog({ stream: 'error', message: 'Something failed' });
  const logs = getLogs({ search: 'minecraft' });
  assert.equal(logs.length, 1);
  const text = getLogText();
  assert.match(text, /Hello Minecraft/);
  assert.match(text, /Something failed/);

  // Folder shortcuts.
  const folders = await listFolderShortcuts(inst.id);
  assert.ok(folders.some((f) => f.id === 'mods'));
  assert.ok(folders.some((f) => f.id === 'saves'));
  assert.ok(folders.some((f) => f.id === 'screenshots'));
  assert.ok(folders.some((f) => f.id === 'resourcepacks'));
  assert.ok(folders.some((f) => f.id === 'minecraft'));

  const mods = await resolveFolder('mods', { instanceId: inst.id });
  assert.ok(mods.path.endsWith(`${path.sep}mods`) || mods.path.endsWith('/mods'));

  // Game paths + launch command placeholders (auth + resolution).
  const paths = gamePaths('/tmp/mc', '1.21.1');
  assert.equal(paths.clientJar.endsWith(`${path.sep}1.21.1.jar`) || paths.clientJar.endsWith('/1.21.1.jar'), true);
  assert.ok(paths.mods.includes('mods'));

  assert.equal(replacePlaceholders('hi ${auth_player_name}', { auth_player_name: 'Steve' }), 'hi Steve');
  assert.deepEqual(legacySplitArguments('--width 1280 --height 720'), ['--width', '1280', '--height', '720']);

  const cmd = buildLaunchCommand(
    {
      id: '1.21.1',
      type: 'release',
      mainClass: 'net.minecraft.client.main.Main',
      libraries: [],
      arguments: {
        jvm: ['-cp', '${classpath}'],
        game: ['--username', '${auth_player_name}', '--accessToken', '${auth_access_token}', '--userType', '${user_type}']
      },
      assetIndex: { id: '17' }
    },
    { ...paths, clientJar: '/tmp/mc/versions/1.21.1/1.21.1.jar', natives: '/tmp/mc/natives', assets: '/tmp/mc/assets', root: '/tmp/mc', libraries: '/tmp/mc/libraries' },
    {
      username: 'Notch',
      uuid: '11111111-1111-1111-1111-111111111111',
      accessToken: 'ms-token-abc',
      userType: 'msa',
      xuid: '123'
    },
    { memoryMb: 2048, resolutionWidth: 1280, resolutionHeight: 720, fullscreen: false, jvmArgs: '-Dtest=1', launchArgs: '' },
    '/usr/bin/java'
  );
  assert.equal(cmd.executable, '/usr/bin/java');
  assert.ok(cmd.args.includes('-Xmx2048M'));
  assert.ok(cmd.args.includes('Notch'));
  assert.ok(cmd.args.includes('ms-token-abc'));
  assert.ok(cmd.args.includes('msa'));
  assert.ok(cmd.args.includes('--width'));
  assert.ok(cmd.args.includes('1280'));
  assert.ok(cmd.args.includes('-Dtest=1'));

  // Requested navigation and home-page presentation remain represented in the
  // shipped Electron UI.
  const ui = await fs.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const uiScript = await fs.readFile(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.doesNotMatch(ui, /class="hero-card"/u);
  assert.doesNotMatch(ui, /id="versions-import-prism"/u);
  assert.match(ui, /id="page-credits"/u);
  assert.match(ui, /Credits for Amethyst/u);
  assert.match(ui, /Lumi\/Lumi Faye - Main collaborator\/co-owner/u);
  assert.match(ui, /MinLol12\/Minveraz - Owner, Main creator/u);
  assert.match(ui, /from amethyst team :3/u);
  assert.match(ui, /REQUIRED FOR RPC/u);
  assert.match(uiScript, /syncDiscordRequirement/u);

  // Cleanup
  await fs.rm(tmpRoot, { recursive: true, force: true });
  console.log('Feature tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
