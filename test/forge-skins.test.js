const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const {
  ensureLauncherProfiles,
  runForgeInstaller,
  findInstalledLoaderVersion,
  profileId
} = require('../src/launcher/forgeInstaller');
const { publicAccount } = require('../src/launcher/accounts');
const {
  normalizeVariant,
  inspectPng,
  decodeImageData,
  resolveProviderUrl,
  isPrivateAddress,
  multipartSkinBody
} = require('../src/launcher/skins');

function skinPngHeader(width = 64, height = 64) {
  const buffer = Buffer.alloc(32);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  buffer[24] = 8;
  buffer[25] = 6;
  return buffer;
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'amethyst-forge-skins-'));
  try {
    const gameDir = path.join(root, 'minecraft');
    const initialized = await ensureLauncherProfiles(gameDir, {
      minecraftVersion: '1.20.1',
      name: 'Something Cool'
    });
    assert.equal(initialized.profileId, 'amethyst-something-cool');
    assert.equal(initialized.profiles.version, 3);
    assert.equal(initialized.profiles.profiles[initialized.profileId].lastVersionId, '1.20.1');
    assert.equal(initialized.profiles.profiles[initialized.profileId].gameDir, gameDir);
    assert.ok(initialized.profiles.clientToken);

    // Existing launcher data must survive initialization.
    initialized.profiles.profiles.existing = { name: 'Keep me' };
    initialized.profiles.extraSetting = true;
    await fs.writeFile(initialized.path, JSON.stringify(initialized.profiles));
    const preserved = await ensureLauncherProfiles(gameDir, { minecraftVersion: '1.20.1', name: 'Something Cool' });
    assert.equal(preserved.profiles.profiles.existing.name, 'Keep me');
    assert.equal(preserved.profiles.extraSetting, true);

    // The launcher profile must exist before Java is spawned; this is the exact
    // precondition the official Forge installer checks for isolated instances.
    const installerPath = path.join(root, 'forge-installer.jar');
    await fs.writeFile(installerPath, 'test');
    let spawnedArgs = null;
    await runForgeInstaller({
      javaPath: '/fake/java',
      installerPath,
      gameDir: path.join(root, 'second-instance'),
      minecraftVersion: '1.20.1',
      loaderVersion: '47.4.0',
      timeoutMs: 1000,
      spawnImpl(executable, args) {
        spawnedArgs = { executable, args };
        assert.equal(require('node:fs').existsSync(path.join(root, 'second-instance', 'launcher_profiles.json')), true);
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => {};
        process.nextTick(() => child.emit('close', 0, null));
        return child;
      }
    });
    assert.equal(spawnedArgs.executable, '/fake/java');
    assert.deepEqual(spawnedArgs.args, ['-jar', installerPath, '--installClient', path.join(root, 'second-instance')]);

    const forgeId = '1.20.1-forge-47.4.0';
    const forgeDir = path.join(gameDir, 'versions', forgeId);
    await fs.mkdir(forgeDir, { recursive: true });
    await fs.writeFile(path.join(forgeDir, `${forgeId}.json`), JSON.stringify({
      id: forgeId,
      mainClass: 'cpw.mods.bootstraplauncher.BootstrapLauncher',
      libraries: [{ name: 'net.minecraftforge:forge:1.20.1-47.4.0' }]
    }));
    assert.equal(await findInstalledLoaderVersion(gameDir, { loader: 'forge', loaderVersion: '47.4.0' }), forgeId);
    assert.equal(await findInstalledLoaderVersion(gameDir, { loader: 'forge', loaderVersion: '99.0.0' }), null);
    assert.equal(profileId('  A / Weird Pack!  '), 'amethyst-a-weird-pack');

    const modern = skinPngHeader(64, 64);
    assert.deepEqual(inspectPng(modern), { width: 64, height: 64, size: modern.length, legacy: false });
    assert.equal(inspectPng(skinPngHeader(64, 32)).legacy, true);
    assert.throws(() => inspectPng(skinPngHeader(128, 128)), /64×64/);
    assert.equal(decodeImageData(`data:image/png;base64,${modern.toString('base64')}`).metadata.width, 64);
    assert.throws(() => decodeImageData('data:image/jpeg;base64,abcd'), /PNG/);
    assert.equal(normalizeVariant('SLIM'), 'slim');
    assert.throws(() => normalizeVariant('wide'), /classic or slim/);

    const hash = '0123456789abcdef'.repeat(4);
    assert.equal(
      resolveProviderUrl(`https://namemc.com/skin/${hash}`),
      `https://texture.namemc.com/01/23/${hash}.png`
    );
    assert.equal(resolveProviderUrl('http://textures.minecraft.net/texture/abc'), 'https://textures.minecraft.net/texture/abc');
    assert.equal(
      resolveProviderUrl('https://www.minecraftskins.com/skin/23948650/tiny-takeover/'),
      'https://www.minecraftskins.com/skin/download/23948650'
    );
    assert.throws(() => resolveProviderUrl('http://example.com/skin.png'), /HTTPS/);
    assert.equal(isPrivateAddress('127.0.0.1'), true);
    assert.equal(isPrivateAddress('192.168.1.3'), true);
    assert.equal(isPrivateAddress('1.1.1.1'), false);
    assert.equal(isPrivateAddress('::1'), true);

    const safeAccount = publicAccount({
      id: 'account',
      username: 'Alex',
      mcToken: 'secret-minecraft-token',
      msAccessToken: 'secret-microsoft-token',
      refreshToken: 'secret-refresh-token'
    });
    assert.equal(safeAccount.hasToken, true);
    assert.equal(safeAccount.mcToken, undefined);
    assert.equal(safeAccount.msAccessToken, undefined);
    assert.equal(safeAccount.refreshToken, undefined);

    const multipart = multipartSkinBody(modern, 'classic');
    assert.match(multipart.boundary, /^----AmethystSkin/);
    assert.ok(multipart.body.includes(Buffer.from('name="variant"')));
    assert.ok(multipart.body.includes(Buffer.from('image/png')));

    console.log('Forge and skin tests passed.');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
