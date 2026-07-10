const assert = require('node:assert/strict');
const { isAllowedByRules, osMatches } = require('../src/launcher/rules');
const { offlineUuid, validateUsername } = require('../src/launcher/accounts');
const {
  buildLaunchCommand,
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

console.log('All tests passed.');
