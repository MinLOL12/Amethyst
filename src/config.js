const os = require('node:os');
const path = require('node:path');

const APP_NAME = 'Amethyst';
const APP_VERSION = '0.1.0';
const MOJANG_MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const NEWS_URL = 'https://launchercontent.mojang.com/news.json';
const RESOURCES_BASE_URL = 'https://resources.download.minecraft.net';

function getDataRoot() {
  return process.env.AMETHYST_HOME
    ? path.resolve(process.env.AMETHYST_HOME)
    : path.join(os.homedir(), '.amethyst');
}

function getDefaultSettings() {
  const dataRoot = getDataRoot();
  return {
    gameDir: path.join(dataRoot, 'minecraft'),
    javaPath: '',
    memoryMb: 2048,
    lastVersion: '',
    lastAccountId: '',
    maxConcurrentDownloads: 8
  };
}

module.exports = {
  APP_NAME,
  APP_VERSION,
  MOJANG_MANIFEST_URL,
  NEWS_URL,
  RESOURCES_BASE_URL,
  getDataRoot,
  getDefaultSettings
};
