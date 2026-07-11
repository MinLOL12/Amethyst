'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const root = path.join(os.tmpdir(), `amethyst-mod-loading-${process.pid}-${Date.now()}`);
process.env.AMETHYST_HOME = root;

const { writeJson } = require('../src/launcher/store');
const { gamePaths } = require('../src/launcher/minecraftPaths');
const {
  loaderVersionId,
  findInstalledLoaderProfile
} = require('../src/launcher/modLoaders');
const {
  checkVersionInstalled,
  resolveVersionDetails,
  buildLaunchCommand
} = require('../src/launcher/minecraft');
const { readSettings, saveSettings } = require('../src/launcher/accounts');

async function touch(file, content = 'test') {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

async function main() {
  const gameDir = path.join(root, 'minecraft');
  const minecraftVersion = '1.20.1';
  const fabricVersion = '0.15.11';
  const fabricId = loaderVersionId('fabric', minecraftVersion, fabricVersion);

  assert.equal(fabricId, 'fabric-loader-0.15.11-1.20.1');
  assert.equal(loaderVersionId('quilt', minecraftVersion, '0.26.4'), 'quilt-loader-0.26.4-1.20.1');
  assert.equal(loaderVersionId('forge', minecraftVersion, '47.3.0'), '1.20.1-forge-47.3.0');
  assert.equal(loaderVersionId('forge', minecraftVersion, '1.20.1-47.3.0'), '1.20.1-forge-47.3.0');
  assert.equal(loaderVersionId('neoforge', '1.21.1', '21.1.100'), 'neoforge-21.1.100');

  const vanilla = {
    id: minecraftVersion,
    type: 'release',
    mainClass: 'net.minecraft.client.main.Main',
    downloads: {
      client: { url: 'https://example.invalid/client.jar' }
    },
    assetIndex: { id: '12', url: 'https://example.invalid/assets.json' },
    libraries: [
      {
        name: 'com.example:parent:1.0.0',
        downloads: {
          artifact: {
            path: 'com/example/parent/1.0.0/parent-1.0.0.jar',
            url: 'https://example.invalid/parent.jar'
          }
        }
      },
      {
        name: 'com.example:shared:1.0.0',
        downloads: {
          artifact: {
            path: 'com/example/shared/1.0.0/shared-1.0.0.jar',
            url: 'https://example.invalid/old-shared.jar'
          }
        }
      }
    ],
    arguments: {
      jvm: ['-Djava.library.path=${natives_directory}', '-cp', '${classpath}'],
      game: ['--username', '${auth_player_name}']
    }
  };
  const fabric = {
    id: fabricId,
    inheritsFrom: minecraftVersion,
    jar: minecraftVersion,
    type: 'release',
    mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
    libraries: [
      {
        name: 'net.fabricmc:fabric-loader:0.15.11',
        downloads: {
          artifact: {
            path: 'net/fabricmc/fabric-loader/0.15.11/fabric-loader-0.15.11.jar',
            url: 'https://example.invalid/fabric-loader.jar'
          }
        }
      },
      {
        name: 'com.example:shared:1.0.0',
        downloads: {
          artifact: {
            path: 'com/example/shared/1.0.0/shared-1.0.0.jar',
            url: 'https://example.invalid/new-shared.jar'
          }
        }
      }
    ],
    arguments: { game: ['--fabric-test'], jvm: ['-Dfabric.test=true'] }
  };

  await writeJson(gamePaths(gameDir, minecraftVersion).versionJson, vanilla);
  await writeJson(gamePaths(gameDir, fabricId).versionJson, fabric);
  await touch(gamePaths(gameDir, minecraftVersion).clientJar);
  await touch(path.join(gameDir, 'libraries/com/example/parent/1.0.0/parent-1.0.0.jar'));
  await touch(path.join(gameDir, 'libraries/com/example/shared/1.0.0/shared-1.0.0.jar'));
  await touch(path.join(gameDir, 'libraries/net/fabricmc/fabric-loader/0.15.11/fabric-loader-0.15.11.jar'));
  await touch(path.join(gameDir, 'assets/indexes/12.json'), '{}');
  await fs.mkdir(path.join(gameDir, 'mods'), { recursive: true });

  assert.equal(
    await findInstalledLoaderProfile('fabric', minecraftVersion, fabricVersion, gameDir),
    fabricId
  );

  const details = await resolveVersionDetails(fabricId, gameDir);
  assert.equal(details.versionMeta.mainClass, 'net.fabricmc.loader.impl.launch.knot.KnotClient');
  assert.equal(details.clientVersionId, minecraftVersion);
  assert.equal(details.versionMeta.libraries.length, 3);
  const shared = details.versionMeta.libraries.find((library) => library.name === 'com.example:shared:1.0.0');
  assert.equal(shared.downloads.artifact.url, 'https://example.invalid/new-shared.jar');
  assert.deepEqual(details.versionMeta.arguments.game.slice(0, 1), ['--fabric-test']);

  // Resolving inheritance must not overwrite the raw child profile with merged
  // vanilla metadata; doing so duplicated libraries on every launch.
  const childOnDisk = JSON.parse(await fs.readFile(gamePaths(gameDir, fabricId).versionJson, 'utf8'));
  assert.equal(childOnDisk.downloads, undefined);
  assert.equal(childOnDisk.libraries.length, 2);

  const installed = await checkVersionInstalled(minecraftVersion, {
    gameDir,
    loaderType: 'fabric',
    loaderVersion: fabricVersion
  });
  assert.equal(installed.installed, true);
  assert.equal(installed.versionId, fabricId);
  assert.equal(installed.paths.clientJar, gamePaths(gameDir, minecraftVersion).clientJar);
  assert.equal(installed.versionMeta.mainClass, 'net.fabricmc.loader.impl.launch.knot.KnotClient');

  const missingForge = await checkVersionInstalled(minecraftVersion, {
    gameDir,
    loaderType: 'forge',
    loaderVersion: '47.3.0'
  });
  assert.equal(missingForge.installed, false);
  assert.equal(missingForge.reason, 'mod-loader-profile-missing');

  // A profile created by the old extract-only implementation is not a valid
  // Forge install and must not suppress the official installer repair path.
  const brokenForgeId = '1.20.1-forge-47.3.0';
  await writeJson(gamePaths(gameDir, brokenForgeId).versionJson, {
    id: brokenForgeId,
    inheritsFrom: minecraftVersion,
    mainClass: 'net.minecraft.client.main.Main',
    libraries: [],
    _amethyst: { loader: 'forge' }
  });
  assert.equal(
    await findInstalledLoaderProfile('forge', minecraftVersion, '47.3.0', gameDir),
    null
  );

  const command = buildLaunchCommand(
    details.versionMeta,
    installed.paths,
    { username: 'Alex', uuid: '00000000-0000-0000-0000-000000000001', type: 'offline' },
    {
      memoryMb: 2048,
      resolutionWidth: 854,
      resolutionHeight: 480,
      fullscreen: false,
      jvmArgs: '',
      launchArgs: ''
    },
    '/fake/java'
  );
  assert.ok(command.args.includes('net.fabricmc.loader.impl.launch.knot.KnotClient'));
  assert.ok(command.args.some((argument) => argument.includes('fabric-loader-0.15.11.jar')));
  assert.equal(command.cwd, gameDir);

  assert.equal((await readSettings()).loaderType, 'vanilla');
  const saved = await saveSettings({ loaderType: 'FABRIC', loaderVersion: fabricVersion });
  assert.equal(saved.loaderType, 'fabric');
  assert.equal(saved.loaderVersion, fabricVersion);
  const vanillaSettings = await saveSettings({ loaderType: 'vanilla', loaderVersion: 'stale' });
  assert.equal(vanillaSettings.loaderVersion, '');

  const ui = await fs.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(ui, /id="ql-loader-type"/);
  assert.match(ui, /id="ql-loader-version"/);
  assert.match(ui, /id="detail-loader-type"/);
  assert.match(ui, /id="settings-loader-type"/);

  console.log('Mod loading tests passed.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => fs.rm(root, { recursive: true, force: true }).catch(() => {}));
