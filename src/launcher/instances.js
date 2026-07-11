const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createWriteStream, createReadStream } = require('node:fs');
const { pipeline } = require('node:stream/promises');
const { getDataRoot, getDefaultSettings } = require('../config');
const { readJson, writeJson, ensureDir } = require('./store');
const { readSettings, saveSettings } = require('./accounts');
const { progressBus } = require('./downloader');

function instancesRoot() {
  return path.join(getDataRoot(), 'instances');
}

function instancesIndexPath() {
  return path.join(getDataRoot(), 'instances.json');
}

function defaultInstanceFields() {
  const defaults = getDefaultSettings();
  return {
    memoryMb: defaults.memoryMb,
    javaPath: '',
    jvmArgs: '',
    launchArgs: '',
    resolutionWidth: defaults.resolutionWidth,
    resolutionHeight: defaults.resolutionHeight,
    fullscreen: false,
    loader: 'vanilla',
    loaderVersion: '',
    icon: '',
    notes: ''
  };
}

function sanitizeName(name) {
  return String(name || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .slice(0, 64) || 'Instance';
}

function slugify(name) {
  return sanitizeName(name)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'instance';
}

async function listInstances() {
  const list = await readJson(instancesIndexPath(), []);
  return list.sort((a, b) => {
    const aTime = a.lastPlayed || a.createdAt || '';
    const bTime = b.lastPlayed || b.createdAt || '';
    return String(bTime).localeCompare(String(aTime));
  });
}

async function saveIndex(list) {
  await writeJson(instancesIndexPath(), list);
  return list;
}

async function getInstance(id) {
  const list = await listInstances();
  const instance = list.find((item) => item.id === id);
  if (!instance) throw new Error(`Instance not found: ${id}`);
  return instance;
}

async function createInstance(input = {}) {
  const name = sanitizeName(input.name || `Minecraft ${input.versionId || ''}`.trim());
  const versionId = String(input.versionId || '').trim();
  if (!versionId) throw new Error('versionId is required');

  const id = crypto.randomUUID();
  const folderName = `${slugify(name)}-${id.slice(0, 8)}`;
  const gameDir = input.gameDir
    ? path.resolve(input.gameDir)
    : path.join(instancesRoot(), folderName);

  await ensureDir(gameDir);
  await ensureDir(path.join(gameDir, 'mods'));
  await ensureDir(path.join(gameDir, 'saves'));
  await ensureDir(path.join(gameDir, 'resourcepacks'));
  await ensureDir(path.join(gameDir, 'screenshots'));
  await ensureDir(path.join(gameDir, 'logs'));
  await ensureDir(path.join(gameDir, 'crash-reports'));

  const now = new Date().toISOString();
  const defaults = defaultInstanceFields();
  const instance = {
    id,
    name,
    versionId,
    gameDir,
    folderName,
    loader: input.loader || 'vanilla',
    loaderVersion: input.loaderVersion || '',
    javaPath: input.javaPath || defaults.javaPath,
    jvmArgs: input.jvmArgs || defaults.jvmArgs,
    launchArgs: input.launchArgs || defaults.launchArgs,
    memoryMb: Number(input.memoryMb) || defaults.memoryMb,
    resolutionWidth: Number(input.resolutionWidth) || defaults.resolutionWidth,
    resolutionHeight: Number(input.resolutionHeight) || defaults.resolutionHeight,
    fullscreen: Boolean(input.fullscreen),
    icon: input.icon || '',
    notes: input.notes || '',
    createdAt: now,
    updatedAt: now,
    lastPlayed: null,
    playCount: 0
  };

  // Persist per-instance config inside the game directory for portability.
  await writeJson(path.join(gameDir, 'instance.json'), instance);

  const list = await listInstances();
  list.push(instance);
  await saveIndex(list);

  const settings = await readSettings();
  settings.lastInstanceId = id;
  await saveSettings(settings);

  progressBus.emitEvent('instance-created', { id, name });
  return instance;
}

async function updateInstance(id, patch = {}) {
  const list = await listInstances();
  const index = list.findIndex((item) => item.id === id);
  if (index < 0) throw new Error(`Instance not found: ${id}`);

  const current = list[index];
  const next = {
    ...current,
    ...patch,
    id: current.id,
    gameDir: patch.gameDir ? path.resolve(patch.gameDir) : current.gameDir,
    name: patch.name !== undefined ? sanitizeName(patch.name) : current.name,
    memoryMb: patch.memoryMb !== undefined
      ? Math.min(16384, Math.max(512, Number(patch.memoryMb) || current.memoryMb))
      : current.memoryMb,
    resolutionWidth: patch.resolutionWidth !== undefined
      ? Math.min(7680, Math.max(640, Number(patch.resolutionWidth) || current.resolutionWidth))
      : current.resolutionWidth,
    resolutionHeight: patch.resolutionHeight !== undefined
      ? Math.min(4320, Math.max(480, Number(patch.resolutionHeight) || current.resolutionHeight))
      : current.resolutionHeight,
    fullscreen: patch.fullscreen !== undefined ? Boolean(patch.fullscreen) : current.fullscreen,
    updatedAt: new Date().toISOString()
  };

  list[index] = next;
  await saveIndex(list);
  await ensureDir(next.gameDir);
  await writeJson(path.join(next.gameDir, 'instance.json'), next);
  return next;
}

async function renameInstance(id, name) {
  return updateInstance(id, { name });
}

async function duplicateInstance(id, newName) {
  const source = await getInstance(id);
  const copy = await createInstance({
    name: newName || `${source.name} (Copy)`,
    versionId: source.versionId,
    loader: source.loader,
    loaderVersion: source.loaderVersion,
    javaPath: source.javaPath,
    jvmArgs: source.jvmArgs,
    launchArgs: source.launchArgs,
    memoryMb: source.memoryMb,
    resolutionWidth: source.resolutionWidth,
    resolutionHeight: source.resolutionHeight,
    fullscreen: source.fullscreen,
    notes: source.notes
  });

  // Copy common user content folders (not full libraries — those are re-downloaded).
  const folders = ['mods', 'saves', 'resourcepacks', 'shaderpacks', 'config', 'options.txt'];
  for (const folder of folders) {
    const from = path.join(source.gameDir, folder);
    const to = path.join(copy.gameDir, folder);
    try {
      await copyPath(from, to);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  progressBus.emitEvent('instance-duplicated', { sourceId: id, id: copy.id });
  return copy;
}

async function deleteInstance(id, { deleteFiles = true } = {}) {
  const list = await listInstances();
  const instance = list.find((item) => item.id === id);
  if (!instance) throw new Error(`Instance not found: ${id}`);

  const next = list.filter((item) => item.id !== id);
  await saveIndex(next);

  if (deleteFiles && instance.gameDir) {
    // Only delete if under the instances root for safety.
    const root = path.resolve(instancesRoot());
    const target = path.resolve(instance.gameDir);
    if (target.startsWith(root + path.sep) || target === root) {
      await fs.rm(target, { recursive: true, force: true });
    }
  }

  const settings = await readSettings();
  if (settings.lastInstanceId === id) {
    settings.lastInstanceId = next[0]?.id || '';
    await saveSettings(settings);
  }

  progressBus.emitEvent('instance-deleted', { id });
  return next;
}

async function touchPlayed(id) {
  const instance = await getInstance(id);
  return updateInstance(id, {
    lastPlayed: new Date().toISOString(),
    playCount: (instance.playCount || 0) + 1
  });
}

async function getRecentInstances(limit = 6) {
  const list = await listInstances();
  return list
    .filter((item) => item.lastPlayed)
    .sort((a, b) => String(b.lastPlayed).localeCompare(String(a.lastPlayed)))
    .slice(0, limit);
}

/**
 * Export an instance as a ZIP archive (config + mods/saves/etc, not shared libraries).
 */
async function exportInstance(id, destination) {
  const instance = await getInstance(id);
  const dest = destination
    ? path.resolve(destination)
    : path.join(getDataRoot(), 'exports', `${slugify(instance.name)}.zip`);

  await ensureDir(path.dirname(dest));
  progressBus.emitEvent('status', { message: `Exporting ${instance.name}…` });

  const zlib = require('node:zlib');
  const entries = [];

  async function walk(dir, prefix = '') {
    let items;
    try {
      items = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const item of items) {
      const full = path.join(dir, item.name);
      const rel = prefix ? `${prefix}/${item.name}` : item.name;
      // Skip bulky runtime caches.
      if (['versions', 'libraries', 'assets', 'natives', '.cache'].includes(item.name) && !prefix) continue;
      if (item.isDirectory()) await walk(full, rel);
      else {
        const data = await fs.readFile(full);
        entries.push({ name: rel.replaceAll('\\', '/'), data });
      }
    }
  }

  // Always include instance metadata.
  entries.push({
    name: 'instance.json',
    data: Buffer.from(JSON.stringify(instance, null, 2), 'utf8')
  });
  await walk(instance.gameDir);

  await writeZip(dest, entries);
  progressBus.emitEvent('instance-exported', { id, destination: dest, files: entries.length });
  return { destination: dest, files: entries.length };
}

/**
 * Import an instance from a ZIP previously exported by Amethyst (or similar layout).
 */
async function importInstance(zipPath, options = {}) {
  const source = path.resolve(zipPath);
  progressBus.emitEvent('status', { message: `Importing instance from ${path.basename(source)}…` });

  const entries = await readZip(source);
  const metaEntry = entries.find((e) => e.name === 'instance.json' || e.name.endsWith('/instance.json'));
  let meta = {};
  if (metaEntry) {
    try {
      meta = JSON.parse(metaEntry.data.toString('utf8'));
    } catch (_) {
      meta = {};
    }
  }

  const instance = await createInstance({
    name: options.name || meta.name || path.basename(source, '.zip'),
    versionId: options.versionId || meta.versionId || 'latest',
    loader: options.loader || meta.loader || 'vanilla',
    loaderVersion: options.loaderVersion || meta.loaderVersion || '',
    javaPath: meta.javaPath || '',
    jvmArgs: meta.jvmArgs || '',
    launchArgs: meta.launchArgs || '',
    memoryMb: meta.memoryMb,
    resolutionWidth: meta.resolutionWidth,
    resolutionHeight: meta.resolutionHeight,
    fullscreen: meta.fullscreen,
    notes: meta.notes || ''
  });

  for (const entry of entries) {
    if (entry.name.endsWith('/')) continue;
    const base = entry.name.replace(/^[^/]+\//, entry.name.includes('/') ? '' : entry.name);
    // Skip overwriting instance.json with old id.
    if (path.basename(entry.name) === 'instance.json') continue;
    const target = path.join(instance.gameDir, entry.name.includes('/') ? entry.name.split('/').slice(1).join('/') || path.basename(entry.name) : entry.name);
    // Prefer relative path without leading folder.
    const rel = entry.name.replace(/\\/g, '/');
    const outRel = rel.startsWith('instance.json') ? null : rel.replace(/^[^/]+\//, '');
    const outPath = path.join(instance.gameDir, outRel || path.basename(rel));
    if (path.basename(outPath) === 'instance.json') continue;
    await ensureDir(path.dirname(outPath));
    await fs.writeFile(outPath, entry.data);
  }

  progressBus.emitEvent('instance-imported', { id: instance.id, source });
  return instance;
}

async function openInstanceFolder(id, subfolder = '') {
  const instance = await getInstance(id);
  const allowed = {
    '': instance.gameDir,
    root: instance.gameDir,
    minecraft: instance.gameDir,
    saves: path.join(instance.gameDir, 'saves'),
    mods: path.join(instance.gameDir, 'mods'),
    screenshots: path.join(instance.gameDir, 'screenshots'),
    resourcepacks: path.join(instance.gameDir, 'resourcepacks'),
    shaderpacks: path.join(instance.gameDir, 'shaderpacks'),
    logs: path.join(instance.gameDir, 'logs'),
    'crash-reports': path.join(instance.gameDir, 'crash-reports'),
    config: path.join(instance.gameDir, 'config')
  };
  const key = String(subfolder || '').toLowerCase();
  const target = allowed[key];
  if (!target) throw new Error(`Unknown folder shortcut: ${subfolder}`);
  await ensureDir(target);
  return { path: target };
}

async function copyPath(from, to) {
  const stat = await fs.stat(from);
  if (stat.isDirectory()) {
    await ensureDir(to);
    const items = await fs.readdir(from);
    for (const item of items) {
      await copyPath(path.join(from, item), path.join(to, item));
    }
  } else {
    await ensureDir(path.dirname(to));
    await fs.copyFile(from, to);
  }
}

/** Minimal ZIP writer (store + deflate) using Node built-ins. */
async function writeZip(destination, entries) {
  const zlib = require('node:zlib');
  const files = [];
  let offset = 0;
  const chunks = [];

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const compressed = zlib.deflateRawSync(raw);
    const useCompression = compressed.length < raw.length;
    const payload = useCompression ? compressed : raw;
    const method = useCompression ? 8 : 0;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    files.push({ name, crc, method, compressedSize: payload.length, size: raw.length, offset });
    chunks.push(local, name, payload);
    offset += local.length + name.length + payload.length;
  }

  const centralStart = offset;
  for (const file of files) {
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(file.method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(file.crc, 16);
    central.writeUInt32LE(file.compressedSize, 20);
    central.writeUInt32LE(file.size, 24);
    central.writeUInt16LE(file.name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(file.offset, 42);
    chunks.push(central, file.name);
    offset += central.length + file.name.length;
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(offset - centralStart, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);
  chunks.push(eocd);

  await fs.writeFile(destination, Buffer.concat(chunks));
}

async function readZip(filePath) {
  const zlib = require('node:zlib');
  const buf = await fs.readFile(filePath);
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error('Not a valid ZIP file');

  const cdEntries = buf.readUInt16LE(eocdOffset + 8);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  const entries = [];
  let pos = cdOffset;

  for (let i = 0; i < cdEntries; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;
    const compressionMethod = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const fileNameLength = buf.readUInt16LE(pos + 28);
    const extraFieldLength = buf.readUInt16LE(pos + 30);
    const commentLength = buf.readUInt16LE(pos + 32);
    const localHeaderOffset = buf.readUInt32LE(pos + 42);
    const entryName = buf.toString('utf8', pos + 46, pos + 46 + fileNameLength);
    pos += 46 + fileNameLength + extraFieldLength + commentLength;

    if (entryName.endsWith('/')) continue;
    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const localFileNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const dataOffset = localHeaderOffset + 30 + localFileNameLen + localExtraLen;
    const compressed = buf.subarray(dataOffset, dataOffset + compressedSize);
    let data;
    if (compressionMethod === 0) data = Buffer.from(compressed);
    else if (compressionMethod === 8) data = zlib.inflateRawSync(compressed);
    else throw new Error(`Unsupported ZIP compression method ${compressionMethod}`);
    entries.push({ name: entryName, data });
  }
  return entries;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Parse Prism Launcher's instance.cfg (INI format) into an object.
 */
function parsePrismIni(content) {
  const result = {};
  const lines = content.split(/\r?\n/);
  let currentSection = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;
    const sectionMatch = trimmed.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      result[currentSection] = {};
      continue;
    }
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex > 0) {
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      if (currentSection) {
        result[currentSection][key] = value;
      } else {
        result[key] = value;
      }
    }
  }
  return result;
}

/**
 * Import a Prism Launcher instance from its folder.
 * Expects a folder containing instance.cfg and optionally mmc-pack.json and .minecraft/
 */
async function importPrismInstance(prismInstancePath, options = {}) {
  const source = path.resolve(prismInstancePath);
  progressBus.emitEvent('status', { message: `Importing Prism instance from ${path.basename(source)}…` });

  // Read instance.cfg
  const instanceCfgPath = path.join(source, 'instance.cfg');
  let instanceCfg = {};
  try {
    const content = await fs.readFile(instanceCfgPath, 'utf8');
    instanceCfg = parsePrismIni(content);
  } catch (error) {
    throw new Error(`Failed to read instance.cfg: ${error.message}`);
  }

  // Read mmc-pack.json for version/loader info
  const mmcPackPath = path.join(source, 'mmc-pack.json');
  let mmcPack = {};
  try {
    const content = await fs.readFile(mmcPackPath, 'utf8');
    mmcPack = JSON.parse(content);
  } catch (_) {
    // mmc-pack.json is optional
  }

  // Determine instance name
  const name = options.name || instanceCfg.Instance?.name || instanceCfg.name || path.basename(source);

  // Determine Minecraft version and loader from mmc-pack.json or instance.cfg
  let versionId = options.versionId || mmcPack.components?.find((c) => c.uid === 'net.minecraft')?.version || instanceCfg.Instance?.MCVersion || 'latest';
  let loader = 'vanilla';
  let loaderVersion = '';

  // Check mmc-pack.json for loader components
  if (mmcPack.components) {
    const fabricComp = mmcPack.components.find((c) => c.uid === 'org.quiltmc' || c.uid === 'net.fabricmc');
    const forgeComp = mmcPack.components.find((c) => c.uid === 'net.minecraftforge');
    const neoforgeComp = mmcPack.components.find((c) => c.uid === 'net.neoforged');
    const quiltComp = mmcPack.components.find((c) => c.uid === 'org.quiltmc');

    if (fabricComp && fabricComp.uid === 'net.fabricmc') {
      loader = 'fabric';
      loaderVersion = fabricComp.version || '';
    } else if (forgeComp) {
      loader = 'forge';
      loaderVersion = forgeComp.version || '';
    } else if (neoforgeComp) {
      loader = 'neoforge';
      loaderVersion = neoforgeComp.version || '';
    } else if (quiltComp) {
      loader = 'quilt';
      loaderVersion = quiltComp.version || '';
    }
  }

  // Fallback to instance.cfg for loader info
  if (loader === 'vanilla' && instanceCfg.Instance) {
    const loaderName = instanceCfg.Instance.Loader || instanceCfg.Instance.loader || '';
    if (loaderName.toLowerCase().includes('fabric')) loader = 'fabric';
    else if (loaderName.toLowerCase().includes('forge')) loader = 'forge';
    else if (loaderName.toLowerCase().includes('neoforge')) loader = 'neoforge';
    else if (loaderName.toLowerCase().includes('quilt')) loader = 'quilt';
    loaderVersion = instanceCfg.Instance.LoaderVersion || instanceCfg.Instance.loaderVersion || '';
  }

  // Java settings
  const javaPath = instanceCfg.Java?.JavaPath || instanceCfg.Java?.javaPath || '';

  // Memory settings
  const memoryMb = Number(instanceCfg.Java?.MaxMemory || instanceCfg.Java?.maxMemory || instanceCfg.Instance?.MaxMemory || 2048);

  // Resolution
  const resolutionWidth = Number(instanceCfg.Instance?.WindowWidth || 854);
  const resolutionHeight = Number(instanceCfg.Instance?.WindowHeight || 480);
  const fullscreen = instanceCfg.Instance?.Fullscreen === 'true' || instanceCfg.Instance?.fullscreen === 'true';

  // JVM args
  const jvmArgs = instanceCfg.Java?.JvmArgs || instanceCfg.Java?.jvmArgs || '';

  // Game directory - Prism uses .minecraft subfolder
  const prismGameDir = path.join(source, '.minecraft');
  const gameDir = options.gameDir || prismGameDir;

  // Create the Amethyst instance
  const instance = await createInstance({
    name,
    versionId,
    loader,
    loaderVersion,
    javaPath,
    jvmArgs,
    launchArgs: '',
    memoryMb: Number.isFinite(memoryMb) ? memoryMb : 2048,
    resolutionWidth: Number.isFinite(resolutionWidth) ? resolutionWidth : 854,
    resolutionHeight: Number.isFinite(resolutionHeight) ? resolutionHeight : 480,
    fullscreen,
    notes: `Imported from Prism Launcher: ${source}`
  });

  // Copy game directory content (mods, saves, resourcepacks, etc.)
  const folders = ['mods', 'saves', 'resourcepacks', 'shaderpacks', 'config', 'options.txt', 'optionsof.txt'];
  for (const folder of folders) {
    const from = path.join(prismGameDir, folder);
    const to = path.join(instance.gameDir, folder);
    try {
      await copyPath(from, to);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  progressBus.emitEvent('instance-imported', { id: instance.id, source, prism: true });
  return instance;
}

module.exports = {
  listInstances,
  getInstance,
  createInstance,
  updateInstance,
  renameInstance,
  duplicateInstance,
  deleteInstance,
  touchPlayed,
  getRecentInstances,
  exportInstance,
  importInstance,
  importPrismInstance,
  openInstanceFolder,
  instancesRoot
};
