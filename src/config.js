const os = require('node:os');
const path = require('node:path');

const APP_NAME = 'Amethyst';
const APP_VERSION = '0.2.0';
const MOJANG_MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const NEWS_URL = 'https://launchercontent.mojang.com/news.json';
const RESOURCES_BASE_URL = 'https://resources.download.minecraft.net';

// Public Xbox Live / Minecraft client id used by community launchers for device-code OAuth.
// Override with AMETHYST_MS_CLIENT_ID if you register your own Azure application.
const MS_CLIENT_ID = process.env.AMETHYST_MS_CLIENT_ID || '00000000402b5328';
const MS_SCOPE = 'XboxLive.signin offline_access';
const MS_DEVICE_CODE_URL = 'https://login.live.com/oauth20_connect.srf';
const MS_TOKEN_URL = 'https://login.live.com/oauth20_token.srf';

const FABRIC_META_URL = 'https://meta.fabricmc.net/v2';
const QUILT_META_URL = 'https://meta.quiltmc.org/v3';
const FORGE_MAVEN_URL = 'https://maven.minecraftforge.net';
const NEOFORGE_MAVEN_URL = 'https://maven.neoforged.net/releases';
const ADOPTIUM_API_URL = 'https://api.adoptium.net/v3';

function getDataRoot() {
  return process.env.AMETHYST_HOME
    ? path.resolve(process.env.AMETHYST_HOME)
    : path.join(os.homedir(), '.amethyst');
}

function getDefaultSettings() {
  const dataRoot = getDataRoot();
  return {
    gameDir: path.join(dataRoot, 'minecraft'),
    instancesDir: path.join(dataRoot, 'instances'),
    javaDir: path.join(dataRoot, 'java'),
    javaPath: '',
    memoryMb: 2048,
    resolutionWidth: 854,
    resolutionHeight: 480,
    fullscreen: false,
    jvmArgs: '',
    launchArgs: '',
    lastVersion: '',
    lastAccountId: '',
    lastInstanceId: '',
    maxConcurrentDownloads: 8,
    rememberMicrosoftLogin: true
  };
}

module.exports = {
  APP_NAME,
  APP_VERSION,
  MOJANG_MANIFEST_URL,
  NEWS_URL,
  RESOURCES_BASE_URL,
  MS_CLIENT_ID,
  MS_SCOPE,
  MS_DEVICE_CODE_URL,
  MS_TOKEN_URL,
  FABRIC_META_URL,
  QUILT_META_URL,
  FORGE_MAVEN_URL,
  NEOFORGE_MAVEN_URL,
  ADOPTIUM_API_URL,
  getDataRoot,
  getDefaultSettings
};
