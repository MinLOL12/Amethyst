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

async function readSettings() {
  const defaults = getDefaultSettings();
  const current = await readJson(paths().settings, defaults);
  return { ...defaults, ...current };
}

async function saveSettings(partial) {
  const defaults = getDefaultSettings();
  const current = await readJson(paths().settings, defaults);
  const next = { ...defaults, ...current, ...partial };
  next.memoryMb = Math.min(16384, Math.max(512, Number(next.memoryMb) || defaults.memoryMb));
  next.resolutionWidth = Math.min(7680, Math.max(640, Number(next.resolutionWidth) || defaults.resolutionWidth));
  next.resolutionHeight = Math.min(4320, Math.max(480, Number(next.resolutionHeight) || defaults.resolutionHeight));
  next.fullscreen = Boolean(next.fullscreen);
  next.maxConcurrentDownloads = Math.min(16, Math.max(1, Number(next.maxConcurrentDownloads) || defaults.maxConcurrentDownloads));
  next.rememberMicrosoftLogin = next.rememberMicrosoftLogin !== false;
  next.discordEnabled = Boolean(next.discordEnabled);
  next.discordClientId = String(next.discordClientId || '').replace(/\D/g, '').slice(0, 32);
  next.discordDetails = String(next.discordDetails || defaults.discordDetails).slice(0, 128);
  next.discordState = String(next.discordState || defaults.discordState).slice(0, 128);
  next.discordLargeImageKey = String(next.discordLargeImageKey || '').trim().slice(0, 64);
  next.discordLargeImageText = String(next.discordLargeImageText || defaults.discordLargeImageText).slice(0, 128);
  next.discordShowElapsed = next.discordShowElapsed !== false;
  const inputTheme = next.theme && typeof next.theme === 'object' ? next.theme : {};
  const color = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : fallback;
  next.theme = {
    name: String(inputTheme.name || defaults.theme.name).trim().slice(0, 32),
    background: color(inputTheme.background, defaults.theme.background),
    panel: color(inputTheme.panel, defaults.theme.panel),
    accent: color(inputTheme.accent, defaults.theme.accent),
    accentBright: color(inputTheme.accentBright, defaults.theme.accentBright),
    text: color(inputTheme.text, defaults.theme.text)
  };
  next.jvmArgs = String(next.jvmArgs || '');
  next.launchArgs = String(next.launchArgs || '');
  const loaderType = String(next.loaderType || 'vanilla').toLowerCase();
  next.loaderType = ['vanilla', 'fabric', 'forge', 'neoforge', 'quilt'].includes(loaderType)
    ? loaderType
    : 'vanilla';
  next.loaderVersion = next.loaderType === 'vanilla' ? '' : String(next.loaderVersion || '');
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
