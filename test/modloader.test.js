/**
 * Tests for the modloader module.
 * These tests verify the resolveVersionChain merging logic and
 * the modLoaderVersionId helper without making network requests.
 */

const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');

// ── Helper: create a temp directory with version JSONs ─────────────

async function createTempGameDir(structure) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'amethyst-test-'));
  for (const [versionId, meta] of Object.entries(structure)) {
    const versionDir = path.join(tmpDir, 'versions', versionId);
    await fs.mkdir(versionDir, { recursive: true });
    await fs.writeFile(
      path.join(versionDir, `${versionId}.json`),
      JSON.stringify(meta, null, 2)
    );
  }
  return tmpDir;
}

async function cleanup(dir) {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}

// ── Tests ──────────────────────────────────────────────────────────

async function testModLoaderVersionId() {
  const { modLoaderVersionId } = require('../src/launcher/modloader');

  assert.strictEqual(modLoaderVersionId('fabric', '0.15.11', '1.20.1'), 'fabric-loader-0.15.11-1.20.1');
  assert.strictEqual(modLoaderVersionId('quilt', '0.26.4', '1.20.1'), 'quilt-loader-0.26.4-1.20.1');
  assert.strictEqual(modLoaderVersionId('forge', '47.3.0', '1.20.1'), '1.20.1-forge-47.3.0');
  assert.strictEqual(modLoaderVersionId('', '', '1.20.1'), '1.20.1');

  console.log('  ✅ modLoaderVersionId');
}

async function testResolveVersionChainVanilla() {
  const { resolveVersionChain } = require('../src/launcher/modloader');

  const vanillaMeta = {
    id: '1.20.1',
    type: 'release',
    mainClass: 'net.minecraft.client.main.Main',
    libraries: [
      { name: 'com.mojang:logging:1.1.1', downloads: { artifact: { path: 'com/mojang/logging/1.1.1/logging-1.1.1.jar', url: 'https://example.com/logging.jar' } } },
    ],
    minecraftArguments: '--username ${auth_player_name} --version ${version_name}',
    downloads: { client: { url: 'https://example.com/client.jar' } },
    assetIndex: { id: '12' }
  };

  const gameDir = await createTempGameDir({ '1.20.1': vanillaMeta });

  try {
    const merged = await resolveVersionChain('1.20.1', gameDir);
    assert.strictEqual(merged.id, '1.20.1');
    assert.strictEqual(merged.mainClass, 'net.minecraft.client.main.Main');
    assert.strictEqual(merged.libraries.length, 1);
    assert.strictEqual(merged.inheritsFrom, undefined);
    console.log('  ✅ resolveVersionChain (vanilla, no inheritance)');
  } finally {
    await cleanup(gameDir);
  }
}

async function testResolveVersionChainWithModLoader() {
  const { resolveVersionChain } = require('../src/launcher/modloader');

  const vanillaMeta = {
    id: '1.20.1',
    type: 'release',
    mainClass: 'net.minecraft.client.main.Main',
    libraries: [
      { name: 'com.mojang:logging:1.1.1', downloads: { artifact: { path: 'com/mojang/logging/1.1.1/logging-1.1.1.jar', url: 'https://example.com/logging.jar' } } },
      { name: 'com.mojang:brigadier:1.1.0', downloads: { artifact: { path: 'com/mojang/brigadier/1.1.0/brigadier-1.1.0.jar', url: 'https://example.com/brigadier.jar' } } },
    ],
    minecraftArguments: '--username ${auth_player_name} --version ${version_name}',
    downloads: { client: { url: 'https://example.com/client.jar' } },
    assetIndex: { id: '12' }
  };

  const fabricMeta = {
    id: 'fabric-loader-0.15.11-1.20.1',
    inheritsFrom: '1.20.1',
    jar: '1.20.1',
    type: 'release',
    mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
    libraries: [
      { name: 'net.fabricmc:fabric-loader:0.15.11', downloads: { artifact: { path: 'net/fabricmc/fabric-loader/0.15.11/fabric-loader-0.15.11.jar', url: 'https://example.com/fabric-loader.jar' } } },
      { name: 'com.mojang:logging:1.1.1', downloads: { artifact: { path: 'com/mojang/logging/1.1.1/logging-1.1.1.jar', url: 'https://example.com/logging-override.jar' } } },
    ],
    arguments: {
      game: ['--fabric', '--version ${version_name}'],
      jvm: ['-Dfabric.skipMcProvider=true']
    }
  };

  const gameDir = await createTempGameDir({
    '1.20.1': vanillaMeta,
    'fabric-loader-0.15.11-1.20.1': fabricMeta
  });

  try {
    const merged = await resolveVersionChain('fabric-loader-0.15.11-1.20.1', gameDir);

    // Child's id and mainClass win
    assert.strictEqual(merged.id, 'fabric-loader-0.15.11-1.20.1');
    assert.strictEqual(merged.mainClass, 'net.fabricmc.loader.impl.launch.knot.KnotClient');

    // No inheritsFrom on merged result
    assert.strictEqual(merged.inheritsFrom, undefined);
    assert.strictEqual(merged.jar, undefined);

    // Libraries merged: child overrides parent for same name
    // Child has "com.mojang:logging:1.1.1" and "net.fabricmc:fabric-loader:0.15.11"
    // Parent has "com.mojang:logging:1.1.1" and "com.mojang:brigadier:1.1.0"
    // Merged should have: fabric-loader (child), logging (child override), brigadier (parent)
    const libNames = merged.libraries.map((l) => l.name);
    assert.ok(libNames.includes('net.fabricmc:fabric-loader:0.15.11'), 'fabric-loader library present');
    assert.ok(libNames.includes('com.mojang:brigadier:1.1.0'), 'brigadier from parent present');
    assert.ok(libNames.includes('com.mojang:logging:1.1.1'), 'logging from child present');

    // Child's logging should be the override (different URL)
    const loggingLib = merged.libraries.find((l) => l.name === 'com.mojang:logging:1.1.1');
    assert.strictEqual(loggingLib.downloads.artifact.url, 'https://example.com/logging-override.jar');

    // Arguments merged: child first
    assert.ok(merged.arguments.game.length >= 2, 'game arguments merged');
    assert.ok(merged.arguments.jvm.length >= 1, 'jvm arguments merged');

    console.log('  ✅ resolveVersionChain (with mod loader inheritance)');
  } finally {
    await cleanup(gameDir);
  }
}

async function testGetInstalledLoaders() {
  const { getInstalledLoaders } = require('../src/launcher/modloader');

  const fabricMeta = {
    id: 'fabric-loader-0.15.11-1.20.1',
    inheritsFrom: '1.20.1',
    mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
    libraries: []
  };

  const gameDir = await createTempGameDir({
    'fabric-loader-0.15.11-1.20.1': fabricMeta
  });

  try {
    const installed = await getInstalledLoaders('1.20.1', gameDir);
    assert.ok(installed.fabric, 'fabric loader detected');
    assert.strictEqual(installed.fabric.loaderVersion, '0.15.11');
    assert.strictEqual(installed.quilt, null);
    assert.strictEqual(installed.forge, null);
    console.log('  ✅ getInstalledLoaders');
  } finally {
    await cleanup(gameDir);
  }
}

// ── Run ────────────────────────────────────────────────────────────

async function main() {
  console.log('Modloader tests:');
  await testModLoaderVersionId();
  await testResolveVersionChainVanilla();
  await testResolveVersionChainWithModLoader();
  await testGetInstalledLoaders();
  console.log('\nAll modloader tests passed.');
}

main().catch((err) => {
  console.error('Test failed:', err.message);
  console.error(err.stack);
  process.exitCode = 1;
});
