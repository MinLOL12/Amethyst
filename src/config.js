const os = require('node:os');
const path = require('node:path');

const APP_NAME = 'Amethyst';
const APP_VERSION = '0.2.0';
const MOJANG_MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const NEWS_URL = 'https://launchercontent.mojang.com/news.json';
const RESOURCES_BASE_URL = 'https://resources.download.minecraft.net';
// Fallback mirrors for Minecraft assets (same /<prefix>/<hash> path structure)
const RESOURCES_MIRRORS = [
  'https://resources.fastmcmirror.org',
  'https://bmclapi2.bangbang93.com/assets',
  'https://mcm.xgheaven.com/minecraft/assets',
  'https://launchercontent.mojang.com/assets',
  'https://resourceproxy.pymcl.net'
];

// The Minecraft Launcher's public client is a legacy Microsoft-account app.  It
// is registered on login.live.com, not in the Microsoft Entra "consumers"
// tenant. Sending it to login.microsoftonline.com causes AADSTS700016.
//
// A launcher distributor should normally register and provide its own public
// client with device-code support. A custom client defaults to the modern v2
// consumer endpoints, which can also be overridden for sovereign clouds.
const LEGACY_MINECRAFT_CLIENT_ID = '00000000402b5328';
const MS_CLIENT_ID = process.env.AMETHYST_MS_CLIENT_ID || LEGACY_MINECRAFT_CLIENT_ID;
const MS_SCOPE = process.env.AMETHYST_MS_SCOPE || 'XboxLive.signin offline_access';
const usingCustomMicrosoftClient = Boolean(process.env.AMETHYST_MS_CLIENT_ID);
const MS_DEVICE_CODE_URL = process.env.AMETHYST_MS_DEVICE_CODE_URL || (usingCustomMicrosoftClient
  ? 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode'
  : 'https://login.live.com/oauth20_connect.srf');
const MS_TOKEN_URL = process.env.AMETHYST_MS_TOKEN_URL || (usingCustomMicrosoftClient
  ? 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token'
  : 'https://login.live.com/oauth20_token.srf');

const FABRIC_META_URL = 'https://meta.fabricmc.net/v2';
const QUILT_META_URL = 'https://meta.quiltmc.org/v3';
const FORGE_MAVEN_URL = 'https://maven.minecraftforge.net';
const FORGE_PROMOTIONS_URL = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
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
    rememberMicrosoftLogin: true,
    discordEnabled: false,
    discordClientId: '',
    discordDetails: 'Playing Minecraft {version}',
    discordState: 'via {loader} · {player}',
    discordLargeImageKey: '',
    discordLargeImageText: 'Amethyst Launcher',
    discordShowElapsed: true,
    // `theme` remains the active theme for compatibility with settings files
    // written by earlier Amethyst releases. `themes` keeps a reusable local
    // collection and `activeThemeId` selects the one applied on startup.
    theme: {
      id: 'amethyst',
      name: 'Amethyst',
      background: '#0b0912',
      panel: '#171223',
      accent: '#a879ff',
      accentBright: '#c6a8ff',
      text: '#f7f4ff'
    },
    themes: [
      {
        id: 'amethyst',
        name: 'Amethyst',
        background: '#0b0912',
        panel: '#171223',
        accent: '#a879ff',
        accentBright: '#c6a8ff',
        text: '#f7f4ff'
      }
    ],
    activeThemeId: 'amethyst',
    // Quick Launch uses these to remember the selected runtime. Vanilla is
    // represented explicitly so an old settings file cannot accidentally
    // reuse a stale loader version.
    loaderType: 'vanilla',
    loaderVersion: ''
  };
}

function getAssetUrls(hash) {
  const prefix = String(hash).slice(0, 2);
  const suffix = `${prefix}/${hash}`;
  const bases = [RESOURCES_BASE_URL, ...RESOURCES_MIRRORS];
  // Deduplicate while preserving order
  const seen = new Set();
  const urls = [];
  for (const base of bases) {
    if (!base) continue;
    const normalized = base.replace(/\/+$/, '');
    const url = `${normalized}/${suffix}`;
    if (seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

module.exports = {
  APP_NAME,
  APP_VERSION,
  MOJANG_MANIFEST_URL,
  NEWS_URL,
  RESOURCES_BASE_URL,
  RESOURCES_MIRRORS,
  getAssetUrls,
  MS_CLIENT_ID,
  MS_SCOPE,
  MS_DEVICE_CODE_URL,
  MS_TOKEN_URL,
  FABRIC_META_URL,
  QUILT_META_URL,
  FORGE_MAVEN_URL,
  FORGE_PROMOTIONS_URL,
  NEOFORGE_MAVEN_URL,
  ADOPTIUM_API_URL,
  getDataRoot,
  getDefaultSettings
};
