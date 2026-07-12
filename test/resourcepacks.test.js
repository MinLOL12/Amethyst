'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const root = path.join(os.tmpdir(), `amethyst-resourcepacks-${process.pid}-${Date.now()}`);
process.env.AMETHYST_HOME = root;

const {
  createModpack,
  getModpack,
  updateModpack,
  resourcepacksFolder,
  listResourcePacks,
  addResourcePackToPack,
  removeResourcePackFromPack
} = require('../src/launcher/modpacks');

const modrinth = require('../src/launcher/modrinth');

async function main() {
  await fs.mkdir(root, { recursive: true });

  // Test 1: createModpack initializes resourcepacks array
  const pack = await createModpack({
    name: 'Resource Pack Test',
    minecraftVersion: '1.20.1',
    loader: 'vanilla'
  });
  assert.equal(Array.isArray(pack.resourcepacks), true);
  assert.equal(pack.resourcepacks.length, 0);

  const rpDir = resourcepacksFolder(pack.id);
  assert.equal((await fs.stat(rpDir)).isDirectory(), true);

  // Test 2: updateModpack retains resourcepacks array
  const updated = await updateModpack(pack.id, { description: 'Updated desc' });
  assert.equal(Array.isArray(updated.resourcepacks), true);

  // Test 3: addResourcePackToPack, listResourcePacks, removeResourcePackFromPack
  const downloader = require('../src/launcher/downloader');
  const origDownloadFile = downloader.downloadFile;
  downloader.downloadFile = async (url, destPath, options) => {
    await fs.writeFile(destPath, 'mock-zip-content');
  };

  try {
    const entry = await addResourcePackToPack(pack.id, {
      fileName: 'my-resource-pack.zip',
      fileUrl: 'https://example.com/my-resource-pack.zip',
      title: 'My Resource Pack',
      versionId: 'ver-123'
    });
    assert.equal(entry.fileName, 'my-resource-pack.zip');
    assert.equal(entry.installed, true);

    const listed = await listResourcePacks(pack.id);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].fileName, 'my-resource-pack.zip');
    assert.equal(listed[0].installed, true);

    const remaining = await removeResourcePackFromPack(pack.id, entry.id);
    assert.equal(remaining.length, 0);
    assert.equal((await listResourcePacks(pack.id)).length, 0);
  } finally {
    downloader.downloadFile = origDownloadFile;
  }

  // Test 4: buildFacets and projectType in modrinth.js
  const origFetch = global.fetch;
  let capturedUrl = '';
  global.fetch = async (url, options) => {
    capturedUrl = url.toString();
    return {
      ok: true,
      status: 200,
      json: async () => ({ hits: [], offset: 20, limit: 20, total_hits: 100 })
    };
  };

  try {
    await modrinth.searchProjects({ query: 'test', projectType: 'resourcepack', gameVersions: ['1.20.1'], limit: 20, offset: 20 });
    assert.ok(capturedUrl.includes('project_type%3Aresourcepack') || capturedUrl.includes('project_type:resourcepack'), 'URL should include project_type:resourcepack');
    assert.ok(capturedUrl.includes('offset=20'), 'URL should include offset=20 for pagination');
    assert.ok(capturedUrl.includes('limit=20'), 'URL should include limit=20');
  } finally {
    global.fetch = origFetch;
  }

  await fs.rm(root, { recursive: true, force: true });
  console.log('Resourcepack and pagination tests passed.');
}

main().catch(async (error) => {
  console.error(error);
  await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  process.exitCode = 1;
});
