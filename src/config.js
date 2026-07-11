const os = require('node:os');
const path = require('node:path');

const APP_NAME = 'Amethyst';
const APP_VERSION = '0.2.0';
const MOJANG_MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const NEWS_URL = 'https://launchercontent.mojang.com/news.json';
const RESOURCES_BASE_URL = 'https://resources.download.minecraft.net';

const FABRIC_META_URL = 'https://meta.fabricmc.net/v2';
const QUILT_META_URL = 'https://meta.quiltmc.org/v3';
const FORGE_MAVEN_URL = 'https://maven.minecraftforge.net';
const FORGE_PROMOTIONS_URL = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';

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
    maxConcurrentDownloads: 8,
    loaderType: '',
    loaderVersion: ''
  };
}

module.exports = {
  APP_NAME,
  APP_VERSION,
  MOJANG_MANIFEST_URL,
  NEWS_URL,
  RESOURCES_BASE_URL,
  FABRIC_META_URL,
  QUILT_META_URL,
  FORGE_MAVEN_URL,
  FORGE_PROMOTIONS_URL,
  getDataRoot,
  getDefaultSettings
};
