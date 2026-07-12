const crypto = require('node:crypto');
const path = require('node:path');
const { getDataRoot, getDefaultSettings } = require('../config');
const { readJson, writeJson, ensureDir } = require('./store');

function paths() {
  const root = getDataRoot();
  return {
    root,
    accounts: path.join(root, 'accounts.json'),
    settings: path.join(root, 'settings.json'),
    tokens: path.join(root, 'ms-tokens.json')
  };
}

function offlineUuid(username) {
  // UUID v3-compatible offline UUID: md5("OfflinePlayer:" + username), with RFC 4122 bits.
  const hash = crypto.createHash('md5').update(`OfflinePlayer:${username}`, 'utf8').digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function validateUsername(username) {
  const clean = String(username || '').trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(clean)) {
    throw new Error('Offline username must be 3-16 characters and only use letters, numbers, or underscores.');
  }
  return clean;
}

function publicAccount(account) {
  if (!account) return null;
  const {
    accessToken,
    refreshToken,
    xblToken,
    xstsToken,
    mcToken,
    msAccessToken,
    deviceCode,
    ...safe
  } = account;
  return {
    ...safe,
    hasToken: Boolean(accessToken || mcToken),
    tokenExpired: account.expiresAt ? Date.parse(account.expiresAt) <= Date.now() : false
  };
}

async function initializeStore() {
  const p = paths();
  // Create launcher-owned roots at startup. This makes the on-disk layout
  // predictable even before the first pack is created.
  await Promise.all([
    ensureDir(p.root),
    ensureDir(path.join(p.root, 'modpacks')),
    ensureDir(path.join(p.root, 'instances')),
    ensureDir(path.join(p.root, 'minecraft'))
  ]);
  const accounts = await readJson(p.accounts, []);
  const settings = await readSettings();
  return { accounts, settings };
}

async function listAccounts() {
  const all = await readJson(paths().accounts, []);
  return all.map(publicAccount);
}

async function listAccountsRaw() {
  return readJson(paths().accounts, []);
}

async function getAccountRaw(accountId) {
  const all = await listAccountsRaw();
  return all.find((item) => item.id === accountId) || null;
}

async function saveAccounts(accounts) {
  await writeJson(paths().accounts, accounts);
  return accounts;
}

async function addOfflineAccount(username) {
  const clean = validateUsername(username);
  const all = await listAccountsRaw();
  const existing = all.find(
    (account) => account.type === 'offline' && account.username.toLowerCase() === clean.toLowerCase()
  );
  if (existing) return publicAccount(existing);

  const now = new Date().toISOString();
  const account = {
    id: offlineUuid(clean),
    username: clean,
    uuid: offlineUuid(clean),
    type: 'offline',
    createdAt: now,
    lastUsedAt: now
  };
  all.push(account);
  await saveAccounts(all);

  const settings = await readSettings();
  settings.lastAccountId = account.id;
  await saveSettings(settings);
  return publicAccount(account);
}

async function upsertMicrosoftAccount(profile) {
  const all = await listAccountsRaw();
  const now = new Date().toISOString();
  const existingIndex = all.findIndex(
    (account) => account.type === 'microsoft' && (account.uuid === profile.uuid || account.username === profile.username)
  );

  const account = {
    id: profile.uuid || crypto.randomUUID(),
    username: profile.username,
    uuid: profile.uuid,
    type: 'microsoft',
    skinUrl: profile.skinUrl || '',
    skinVariant: String(profile.skinVariant || 'classic').toLowerCase(),
    mcToken: profile.mcToken,
    refreshToken: profile.refreshToken || '',
    msAccessToken: profile.msAccessToken || '',
    expiresAt: profile.expiresAt || '',
    xuid: profile.xuid || '',
    createdAt: existingIndex >= 0 ? all[existingIndex].createdAt : now,
    lastUsedAt: now,
    remembered: profile.remembered !== false
  };

  if (existingIndex >= 0) {
    all[existingIndex] = { ...all[existingIndex], ...account, createdAt: all[existingIndex].createdAt };
  } else {
    all.push(account);
  }

  await saveAccounts(all);
  const settings = await readSettings();
  settings.lastAccountId = account.id;
  await saveSettings(settings);
  return publicAccount(account);
}

async function updateAccountTokens(accountId, tokens) {
  const all = await listAccountsRaw();
  const account = all.find((item) => item.id === accountId);
  if (!account) throw new Error('Account not found');
  Object.assign(account, tokens, { lastUsedAt: new Date().toISOString() });
  await saveAccounts(all);
  return publicAccount(account);
}

async function touchAccount(accountId) {
  const all = await listAccountsRaw();
  const account = all.find((item) => item.id === accountId);
  if (account) {
    account.lastUsedAt = new Date().toISOString();
    await saveAccounts(all);
  }
  return publicAccount(account);
}

async function setActiveAccount(accountId) {
  const account = await getAccountRaw(accountId);
  if (!account) throw new Error('Account not found');
  const settings = await readSettings();
  settings.lastAccountId = accountId;
  await saveSettings(settings);
  await touchAccount(accountId);
  return publicAccount(account);
}

async function removeAccount(accountId) {
  const all = await listAccountsRaw();
  const next = all.filter((account) => account.id !== accountId);
  await saveAccounts(next);
  const settings = await readSettings();
  if (settings.lastAccountId === accountId) {
    settings.lastAccountId = next[0]?.id || '';
    await saveSettings(settings);
  }
  return next.map(publicAccount);
}

const MAX_SAVED_THEMES = 24;

function normalizeDiscordApplicationId(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 32);
}

function themeId(value, index = 0) {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 36);
  return normalized || `theme-${index + 1}`;
}

function normalizeTheme(input, fallback, index = 0) {
  const source = input && typeof input === 'object' ? input : {};
  const color = (value, fallbackValue) => /^#[0-9a-f]{6}$/i.test(String(value || ''))
    ? String(value).toLowerCase()
    : fallbackValue;
  return {
    id: themeId(source.id || source.name, index),
    name: String(source.name || fallback.name).trim().slice(0, 32) || fallback.name,
    background: color(source.background, fallback.background),
    panel: color(source.panel, fallback.panel),
    accent: color(source.accent, fallback.accent),
    accentBright: color(source.accentBright, fallback.accentBright),
    text: color(source.text, fallback.text)
  };
}

function normalizeThemes(input, fallback) {
  const candidates = Array.isArray(input) ? input : [input];
  const usedIds = new Set();
  const themes = [];

  for (const [index, item] of candidates.entries()) {
    if (!item || typeof item !== 'object' || themes.length >= MAX_SAVED_THEMES) continue;
    const theme = normalizeTheme(item, fallback, index);
    const baseId = theme.id;
    let suffix = 2;
    while (usedIds.has(theme.id)) theme.id = `${baseId.slice(0, 32)}-${suffix++}`;
    usedIds.add(theme.id);
    themes.push(theme);
  }

  return themes.length ? themes : [normalizeTheme(fallback, fallback)];
}

function normalizeSettings(next, defaults, { hasThemeCollection = false } = {}) {
  next.memoryMb = Math.min(16384, Math.max(512, Number(next.memoryMb) || defaults.memoryMb));
  next.resolutionWidth = Math.min(7680, Math.max(640, Number(next.resolutionWidth) || defaults.resolutionWidth));
  next.resolutionHeight = Math.min(4320, Math.max(480, Number(next.resolutionHeight) || defaults.resolutionHeight));
  next.fullscreen = Boolean(next.fullscreen);
  next.maxConcurrentDownloads = Math.min(16, Math.max(1, Number(next.maxConcurrentDownloads) || defaults.maxConcurrentDownloads));
  next.rememberMicrosoftLogin = next.rememberMicrosoftLogin !== false;
  next.discordClientId = normalizeDiscordApplicationId(next.discordClientId);
  // Discord RPC is optional, but it can never remain enabled without a
  // user-provided Application ID. This also safely migrates invalid old files.
  next.discordEnabled = Boolean(next.discordEnabled && next.discordClientId);
  next.discordDetails = String(next.discordDetails || defaults.discordDetails).slice(0, 128);
  next.discordState = String(next.discordState || defaults.discordState).slice(0, 128);
  next.discordLargeImageKey = String(next.discordLargeImageKey || '').trim().slice(0, 64);
  next.discordLargeImageText = String(next.discordLargeImageText || defaults.discordLargeImageText).slice(0, 128);
  next.discordShowElapsed = next.discordShowElapsed !== false;

  // A single `theme` was used before collections existed. Prefer it whenever
  // an older settings file does not contain `themes`, so users keep their
  // existing colours after upgrading.
  next.themes = normalizeThemes(hasThemeCollection ? next.themes : next.theme, defaults.theme);
  const requestedThemeId = themeId(next.activeThemeId || next.theme?.id || next.themes[0].id);
  const active = next.themes.find((theme) => theme.id === requestedThemeId) || next.themes[0];
  next.activeThemeId = active.id;
  next.theme = { ...active };

  next.jvmArgs = String(next.jvmArgs || '');
  next.launchArgs = String(next.launchArgs || '');
  const loaderType = String(next.loaderType || 'vanilla').toLowerCase();
  next.loaderType = ['vanilla', 'fabric', 'forge', 'neoforge', 'quilt'].includes(loaderType)
    ? loaderType
    : 'vanilla';
  next.loaderVersion = next.loaderType === 'vanilla' ? '' : String(next.loaderVersion || '');
  return next;
}

async function readSettings() {
  const defaults = getDefaultSettings();
  const current = await readJson(paths().settings, defaults);
  return normalizeSettings(
    { ...defaults, ...current },
    defaults,
    { hasThemeCollection: Array.isArray(current.themes) }
  );
}

async function saveSettings(partial) {
  const defaults = getDefaultSettings();
  const current = await readJson(paths().settings, defaults);
  const incoming = partial && typeof partial === 'object' ? partial : {};
  const hasCurrentThemeCollection = Array.isArray(current.themes);
  const hasIncomingThemes = Object.prototype.hasOwnProperty.call(incoming, 'themes');
  const hasIncomingLegacyTheme = Object.prototype.hasOwnProperty.call(incoming, 'theme');
  const normalizedCurrent = normalizeSettings(
    { ...defaults, ...current },
    defaults,
    { hasThemeCollection: hasCurrentThemeCollection }
  );
  const merged = { ...normalizedCurrent, ...incoming };
  const discordApplicationId = String(merged.discordClientId || '').trim();

  if (Boolean(merged.discordEnabled) && !discordApplicationId) {
    const error = new Error('A Discord Application ID is required to enable Discord RPC.');
    error.status = 400;
    throw error;
  }
  if (Boolean(merged.discordEnabled) && !/^\d+$/.test(discordApplicationId)) {
    const error = new Error('The Discord Application ID must contain only numbers.');
    error.status = 400;
    throw error;
  }

  const next = normalizeSettings(
    merged,
    defaults,
    {
      // An old client that only posts `theme` can still update the active
      // theme, while modern clients retain their whole collection.
      hasThemeCollection: hasIncomingThemes || (!hasIncomingLegacyTheme && hasCurrentThemeCollection)
    }
  );
  await writeJson(paths().settings, next);
  return next;
}

module.exports = {
  initializeStore,
  listAccounts,
  listAccountsRaw,
  getAccountRaw,
  addOfflineAccount,
  upsertMicrosoftAccount,
  updateAccountTokens,
  removeAccount,
  touchAccount,
  setActiveAccount,
  readSettings,
  saveSettings,
  offlineUuid,
  validateUsername,
  publicAccount
};
