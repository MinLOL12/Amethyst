'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const root = path.join(os.tmpdir(), `amethyst-modpacks-auth-${process.pid}-${Date.now()}`);
process.env.AMETHYST_HOME = root;
delete process.env.AMETHYST_MS_CLIENT_ID;
delete process.env.AMETHYST_MS_DEVICE_CODE_URL;
delete process.env.AMETHYST_MS_TOKEN_URL;

const config = require('../src/config');
const { deviceCodeFields, deviceTokenFields } = require('../src/launcher/microsoftAuth');
const {
  createModpack,
  getModpack,
  listModpacks,
  modsFolder,
  validatedModDownload,
  validatePackId
} = require('../src/launcher/modpacks');
const { initializeStore } = require('../src/launcher/accounts');

async function main() {
  // The legacy Minecraft public client must use login.live.com. Sending this
  // id to the Entra consumers tenant produces AADSTS700016.
  assert.equal(config.MS_CLIENT_ID, '00000000402b5328');
  assert.equal(new URL(config.MS_DEVICE_CODE_URL).hostname, 'login.live.com');
  assert.equal(new URL(config.MS_TOKEN_URL).hostname, 'login.live.com');
  assert.equal(deviceCodeFields().response_type, 'device_code');
  assert.deepEqual(deviceTokenFields('real-code'), {
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    client_id: '00000000402b5328',
    device_code: 'real-code'
  });

  await initializeStore();
  assert.equal((await fs.stat(path.join(root, 'modpacks'))).isDirectory(), true);

  const pack = await createModpack({
    name: 'My Fabric Pack',
    minecraftVersion: '1.21.1',
    loader: 'fabric'
  });
  const expectedMods = path.join(root, 'modpacks', pack.id, 'minecraft', 'mods');
  assert.equal(pack.modsDir, expectedMods);
  assert.equal(modsFolder(pack.id), expectedMods);
  assert.equal((await fs.stat(expectedMods)).isDirectory(), true);
  assert.equal((await fs.stat(path.join(root, 'modpacks', pack.id, 'modpack.json'))).isFile(), true);
  assert.equal((await getModpack(pack.id)).gameDir, path.join(root, 'modpacks', pack.id, 'minecraft'));
  assert.equal((await listModpacks()).length, 1);

  assert.deepEqual(
    validatedModDownload({ fileName: 'sodium.jar', fileUrl: 'https://cdn.modrinth.com/sodium.jar' }),
    { fileName: 'sodium.jar', fileUrl: 'https://cdn.modrinth.com/sodium.jar' }
  );
  assert.throws(() => validatedModDownload({ fileName: '../outside.jar', fileUrl: 'https://example.com/x.jar' }), /file name/);
  assert.throws(() => validatedModDownload({ fileName: 'readme.txt', fileUrl: 'https://example.com/readme.txt' }), /\.jar/);
  assert.throws(() => validatedModDownload({ fileName: 'mod.jar', fileUrl: 'http://example.com/mod.jar' }), /HTTPS/);
  assert.throws(() => validatePackId('../outside'), /Invalid modpack id/);

  await fs.rm(root, { recursive: true, force: true });
  console.log('Modpack and Microsoft auth tests passed.');
}

main().catch(async (error) => {
  console.error(error);
  await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  process.exitCode = 1;
});
