const crypto = require('node:crypto');
const path = require('node:path');
const { getDataRoot, getDefaultSettings } = require('../config');
const { readJson, writeJson, ensureDir } = require('./store');

function paths() {
  const root = getDataRoot();
  return {
    root,
    accounts: path.join(root, 'accounts.json'),
    settings: path.join(root, 'settings.json')
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

async function initializeStore() {
  const p = paths();
  await ensureDir(p.root);
  const accounts = await readJson(p.accounts, []);
  const settings = await readSettings();
  return { accounts, settings };
}

async function listAccounts() {
  return readJson(paths().accounts, []);
}

async function addOfflineAccount(username) {
  const clean = validateUsername(username);
  const all = await listAccounts();
  const existing = all.find((account) => account.username.toLowerCase() === clean.toLowerCase());
  if (existing) return existing;

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
  await writeJson(paths().accounts, all);

  const settings = await readSettings();
  settings.lastAccountId = account.id;
  await saveSettings(settings);
  return account;
}

async function touchAccount(accountId) {
  const all = await listAccounts();
  const account = all.find((item) => item.id === accountId);
  if (account) {
    account.lastUsedAt = new Date().toISOString();
    await writeJson(paths().accounts, all);
  }
  return account;
}

async function removeAccount(accountId) {
  const all = await listAccounts();
  const next = all.filter((account) => account.id !== accountId);
  await writeJson(paths().accounts, next);
  const settings = await readSettings();
  if (settings.lastAccountId === accountId) {
    settings.lastAccountId = next[0]?.id || '';
    await saveSettings(settings);
  }
  return next;
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
  next.maxConcurrentDownloads = Math.min(16, Math.max(1, Number(next.maxConcurrentDownloads) || defaults.maxConcurrentDownloads));
  await writeJson(paths().settings, next);
  return next;
}

module.exports = {
  initializeStore,
  listAccounts,
  addOfflineAccount,
  removeAccount,
  touchAccount,
  readSettings,
  saveSettings,
  offlineUuid,
  validateUsername
};
