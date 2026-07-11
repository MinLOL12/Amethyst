const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs/promises');
const { getDataRoot, getDefaultSettings } = require('../config');
const { readSettings } = require('./accounts');
const { getInstance } = require('./instances');
const { ensureDir } = require('./store');

/**
 * Resolve well-known Minecraft / Amethyst folders.
 */
async function resolveFolder(kind, { instanceId, gameDir } = {}) {
  const settings = await readSettings();
  let root = gameDir || settings.gameDir || getDefaultSettings().gameDir;

  if (instanceId) {
    const instance = await getInstance(instanceId);
    root = instance.gameDir;
  }

  const map = {
    data: getDataRoot(),
    minecraft: root,
    '.minecraft': root,
    root,
    saves: path.join(root, 'saves'),
    mods: path.join(root, 'mods'),
    screenshots: path.join(root, 'screenshots'),
    resourcepacks: path.join(root, 'resourcepacks'),
    shaderpacks: path.join(root, 'shaderpacks'),
    logs: path.join(root, 'logs'),
    'crash-reports': path.join(root, 'crash-reports'),
    config: path.join(root, 'config'),
    versions: path.join(root, 'versions'),
    libraries: path.join(root, 'libraries'),
    assets: path.join(root, 'assets'),
    instances: path.join(getDataRoot(), 'instances'),
    java: path.join(getDataRoot(), 'java'),
    exports: path.join(getDataRoot(), 'exports')
  };

  const key = String(kind || 'minecraft').toLowerCase();
  const target = map[key];
  if (!target) throw new Error(`Unknown folder: ${kind}`);
  await ensureDir(target);
  return { kind: key, path: target };
}

/**
 * Open a folder in the system file manager.
 */
async function openFolder(kind, options = {}) {
  const { path: target } = await resolveFolder(kind, options);
  await ensureDir(target);

  const platform = process.platform;
  let command;
  let args;

  if (platform === 'win32') {
    command = 'explorer';
    args = [target];
  } else if (platform === 'darwin') {
    command = 'open';
    args = [target];
  } else {
    command = 'xdg-open';
    args = [target];
  }

  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  child.on('error', () => {});
  child.unref();

  return { ok: true, path: target, opened: true };
}

async function listFolderShortcuts(instanceId) {
  const kinds = [
    { id: 'minecraft', label: 'Open .minecraft', icon: '📁' },
    { id: 'saves', label: 'Open saves', icon: '🌍' },
    { id: 'mods', label: 'Open mods', icon: '🧩' },
    { id: 'screenshots', label: 'Open screenshots', icon: '📷' },
    { id: 'resourcepacks', label: 'Open resource packs', icon: '🎨' },
    { id: 'logs', label: 'Open logs', icon: '📋' },
    { id: 'crash-reports', label: 'Open crash reports', icon: '💥' },
    { id: 'instances', label: 'Open instances', icon: '📦' }
  ];

  const resolved = [];
  for (const item of kinds) {
    try {
      const folder = await resolveFolder(item.id, { instanceId });
      resolved.push({ ...item, path: folder.path });
    } catch (_) {
      resolved.push({ ...item, path: null });
    }
  }
  return resolved;
}

module.exports = {
  resolveFolder,
  openFolder,
  listFolderShortcuts
};
