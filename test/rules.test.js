const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { isAllowedByRules, osMatches } = require('../src/launcher/rules');
const { offlineUuid, validateUsername } = require('../src/launcher/accounts');
const {
  buildLaunchCommand,
  checkVersionInstalled,
  getLibraryDownloads,
  replacePlaceholders,
  legacySplitArguments
} = require('../src/launcher/minecraft');
const {
  formatJavaRequirement,
  isJavaCompatible,
  recommendedJavaRequirement,
  selectCompatibleJava
} = require('../src/launcher/javaLocator');

assert.equal(osMatches({ name: 'linux' }, { name: 'linux', arch: 'x64', version: '6.0' }), true);
assert.equal(osMatches({ name: 'windows' }, { name: 'linux', arch: 'x64', version: '6.0' }), false);

assert.equal(isAllowedByRules(undefined, { name: 'linux' }), true);
assert.equal(isAllowedByRules([{ action: 'allow', os: { name: 'linux' } }], { name: 'linux' }), true);
assert.equal(isAllowedByRules([{ action: 'allow', os: { name: 'windows' } }], { name: 'linux' }), false);
assert.equal(isAllowedByRules([
  { action: 'allow' },
  { action: 'disallow', os: { name: 'linux' } }
], { name: 'linux' }), false);

assert.equal(validateUsername('Steve_123'), 'Steve_123');
assert.throws(() => validateUsername('bad name'));
assert.equal(offlineUuid('Steve'), '5627dd98-e6be-3c21-b8a8-e92344183641');

assert.equal(replacePlaceholders('Hello ${name}', { name: 'Amethyst' }), 'Hello Amethyst');
assert.deepEqual(legacySplitArguments('--username ${auth_player_name} --demo "two words"'), ['--username', '${auth_player_name}', '--demo', 'two words']);

const legacyLaunch = buildLaunchCommand({
  id: '1.7.10-pre2',
  type: 'snapshot',
  mainClass: 'net.minecraft.client.main.Main',
  assets: '1.7.10',
  minecraftArguments: '--username ${auth_player_name} --version ${version_name} --gameDir ${game_directory} --assetsDir ${assets_root} --assetIndex ${assets_index_name} --uuid ${auth_uuid} --accessToken ${auth_access_token} --userProperties ${user_properties} --userType ${user_type}'
}, {
  root: '/minecraft',
  libraries: '/minecraft/libraries',
  clientJar: '/minecraft/versions/1.7.10-pre2/1.7.10-pre2.jar',
  natives: '/minecraft/versions/1.7.10-pre2/natives',
  assets: '/minecraft/assets'
}, {
  username: 'Steve',
  uuid: '5627dd98-e6be-3c21-b8a8-e92344183641'
}, {
  memoryMb: 2048
}, '/java');
const userPropertiesIndex = legacyLaunch.args.indexOf('--userProperties');
assert.notEqual(userPropertiesIndex, -1);
assert.equal(legacyLaunch.args[userPropertiesIndex + 1], '{}');
assert.equal(legacyLaunch.args.some((arg) => arg.includes('${user_properties}')), false);

const rdStyleLibraries = {
  libraries: [
    {
      name: 'net.java.jinput:jinput-platform:2.0.5',
      downloads: {
        classifiers: {
          'natives-any': {
            path: 'net/java/jinput/jinput-platform/2.0.5/jinput-platform-2.0.5-natives-any.jar',
            url: 'https://libraries.minecraft.net/net/java/jinput/jinput-platform/2.0.5/jinput-platform-2.0.5-natives-any.jar'
          }
        }
      },
      natives: { linux: 'natives-any', windows: 'natives-any', osx: 'natives-any' }
    },
    {
      name: 'net.java.jinput:jinput-platform:2.0.5',
      downloads: {
        classifiers: {
          'natives-any': {
            path: 'net/java/jinput/jinput-platform/2.0.5/jinput-platform-2.0.5-natives-any.jar',
            url: 'https://libraries.minecraft.net/net/java/jinput/jinput-platform/2.0.5/jinput-platform-2.0.5-natives-any.jar'
          }
        }
      },
      natives: { linux: 'natives-any', windows: 'natives-any', osx: 'natives-any' }
    },
    { name: 'net.minecraft:launchwrapper:1.6' }
  ]
};
const libraryDownloads = getLibraryDownloads(rdStyleLibraries, { libraries: '/minecraft/libraries' });
assert.deepEqual(libraryDownloads.downloads.map((download) => download.label), [
  'net.java.jinput:jinput-platform:2.0.5 (natives-any)',
  'net.minecraft:launchwrapper:1.6'
]);
assert.equal(libraryDownloads.downloads.some((download) => download.destination.endsWith('jinput-platform-2.0.5.jar')), false);
assert.equal(libraryDownloads.natives.length, 1);
assert.equal(libraryDownloads.downloads[1].url, 'https://libraries.minecraft.net/net/minecraft/launchwrapper/1.6/launchwrapper-1.6.jar');

const launchWrapperRequirement = recommendedJavaRequirement({
  id: 'a1.0.17_04',
  mainClass: 'net.minecraft.launchwrapper.Launch'
});
assert.equal(formatJavaRequirement(launchWrapperRequirement), 'Java 8');
assert.equal(isJavaCompatible({ major: 8 }, launchWrapperRequirement), true);
assert.equal(isJavaCompatible({ major: 21 }, launchWrapperRequirement), false);
assert.equal(isJavaCompatible({ major: 0 }, launchWrapperRequirement), false);
assert.equal(selectCompatibleJava([{ path: 'java21', major: 21 }], launchWrapperRequirement), null);
assert.equal(selectCompatibleJava([{ path: 'java21', major: 21 }, { path: 'java8', major: 8 }], launchWrapperRequirement).path, 'java8');

const java17Requirement = recommendedJavaRequirement({ javaVersion: { majorVersion: 17, component: 'java-runtime-gamma' } });
assert.equal(selectCompatibleJava([{ path: 'java21', major: 21 }, { path: 'java17', major: 17 }], java17Requirement).path, 'java17');

const java8PreferredRequirement = recommendedJavaRequirement({ id: '1.12.2', javaVersion: { majorVersion: 8, component: 'jre-legacy' } });
assert.equal(selectCompatibleJava([{ path: 'java21', major: 21 }, { path: 'java8', major: 8 }], java8PreferredRequirement).path, 'java8');
assert.equal(selectCompatibleJava([{ path: 'java21', major: 21 }], java8PreferredRequirement).path, 'java21');

(async () => {
  const gameDir = await fs.mkdtemp(path.join(os.tmpdir(), 'amethyst-check-'));
  const versionId = '1.20.4';
  const versionDir = path.join(gameDir, 'versions', versionId);
  const librariesDir = path.join(gameDir, 'libraries');
  const assetIndexPath = path.join(gameDir, 'assets', 'indexes', '1.20.json');
  const assetHash = '00112233445566778899aabbccddeeff00112233';
  const assetObjectPath = path.join(gameDir, 'assets', 'objects', assetHash.slice(0, 2), assetHash);
  const libraryPath = path.join(librariesDir, 'com', 'example', 'demo', '1.0.0', 'demo-1.0.0.jar');
  const nativesDir = path.join(versionDir, 'natives');
  const nativeLibraryPath = path.join(librariesDir, 'com', 'example', 'native-demo', '1.0.0', 'native-demo-1.0.0-natives-linux.jar');

  await fs.mkdir(versionDir, { recursive: true });
  await fs.writeFile(path.join(versionDir, `${versionId}.json`), JSON.stringify({
    id: versionId,
    downloads: { client: { url: 'https://example.invalid/client.jar' } },
    assetIndex: { id: '1.20', url: 'https://example.invalid/assets.json' },
    libraries: [
      { name: 'com.example:demo:1.0.0' },
      {
        name: 'com.example:native-demo:1.0.0',
        downloads: {
          classifiers: {
            'natives-linux': {
              path: 'com/example/native-demo/1.0.0/native-demo-1.0.0-natives-linux.jar',
              url: 'https://example.invalid/native-demo.jar'
            }
          }
        },
        natives: { linux: 'natives-linux' }
      }
    ]
  }));

  const missingCheck = await checkVersionInstalled(versionId, { gameDir, concurrency: 2 });
  assert.equal(missingCheck.installed, false);
  assert.equal(missingCheck.missingCount > 0, true);

  await fs.writeFile(path.join(versionDir, `${versionId}.jar`), 'client');
  await fs.mkdir(path.dirname(libraryPath), { recursive: true });
  await fs.writeFile(libraryPath, 'library');
  await fs.mkdir(path.dirname(nativeLibraryPath), { recursive: true });
  await fs.writeFile(nativeLibraryPath, 'native-archive');
  await fs.mkdir(path.dirname(assetIndexPath), { recursive: true });
  await fs.writeFile(assetIndexPath, JSON.stringify({
    objects: {
      'minecraft/sounds/dig/grass1.ogg': { hash: assetHash, size: 1 }
    }
  }));
  await fs.mkdir(path.dirname(assetObjectPath), { recursive: true });
  await fs.writeFile(assetObjectPath, 'a');
  await fs.mkdir(nativesDir, { recursive: true });
  await fs.writeFile(path.join(nativesDir, 'demo.dll'), 'native');

  const installedCheck = await checkVersionInstalled(versionId, { gameDir, concurrency: 2 });
  assert.equal(installedCheck.installed, true);
  assert.equal(installedCheck.missingCount, 0);

  console.log('All tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
