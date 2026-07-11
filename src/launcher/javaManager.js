const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { ADOPTIUM_API_URL, getDataRoot } = require('../config');
const { downloadFile, progressBus, fetchJson } = require('./downloader');
const { ensureDir, readJson, writeJson } = require('./store');
const {
  scanJavaInstallations,
  pickJava,
  getJavaVersion,
  recommendedJavaMajor,
  javaExecutableName
} = require('./javaLocator');

function managedJavaRoot() {
  return path.join(getDataRoot(), 'java');
}

function managedIndexPath() {
  return path.join(managedJavaRoot(), 'managed.json');
}

function platformPackage() {
  if (process.platform === 'win32') return { os: 'windows', arch: process.arch === 'arm64' ? 'aarch64' : 'x64', ext: 'zip' };
  if (process.platform === 'darwin') return { os: 'mac', arch: process.arch === 'arm64' ? 'aarch64' : 'x64', ext: 'tar.gz' };
  return { os: 'linux', arch: process.arch === 'arm64' ? 'aarch64' : 'x64', ext: 'tar.gz' };
}

async function listManagedJava() {
  return readJson(managedIndexPath(), []);
}

async function saveManaged(list) {
  await writeJson(managedIndexPath(), list);
  return list;
}

/**
 * Detect system Java + Amethyst-managed downloads.
 */
async function listAllJava() {
  const system = await scanJavaInstallations();
  const managed = await listManagedJava();
  const combined = [
    ...managed.map((item) => ({ ...item, source: 'managed' })),
    ...system.map((item) => ({ ...item, source: 'system' }))
  ];

  // De-dupe by path.
  const seen = new Set();
  return combined.filter((item) => {
    if (!item.path || seen.has(item.path)) return false;
    seen.add(item.path);
    return true;
  });
}

/**
 * Query Adoptium for available LTS / major versions.
 */
async function listDownloadableJava() {
  const majors = [8, 11, 17, 21];
  const { os, arch } = platformPackage();
  const results = [];

  for (const major of majors) {
    try {
      const url = `${ADOPTIUM_API_URL}/assets/feature_releases/${major}/ga?os=${os}&architecture=${arch}&image_type=jdk&jvm_impl=hotspot&heap_size=normal&vendor=eclipse&page_size=1`;
      const assets = await fetchJson(url, `Adoptium Java ${major}`);
      const asset = Array.isArray(assets) ? assets[0] : null;
      if (!asset) continue;
      const pkg = asset.binary?.package;
      if (!pkg?.link) continue;
      results.push({
        major,
        version: asset.version_data?.openjdk_version || String(major),
        releaseName: asset.release_name,
        downloadUrl: pkg.link,
        checksum: pkg.checksum,
        size: pkg.size,
        os,
        arch
      });
    } catch (error) {
      results.push({ major, error: error.message });
    }
  }
  return results;
}

/**
 * Download and extract a managed Java runtime for the given major version.
 */
async function downloadJava(majorVersion, options = {}) {
  const major = Number(majorVersion) || 17;
  const { os, arch, ext } = platformPackage();

  progressBus.emitEvent('status', { message: `Looking up Java ${major} for ${os}/${arch}…` });
  const url = `${ADOPTIUM_API_URL}/assets/feature_releases/${major}/ga?os=${os}&architecture=${arch}&image_type=jdk&jvm_impl=hotspot&heap_size=normal&vendor=eclipse&page_size=1`;
  const assets = await fetchJson(url, `Adoptium Java ${major}`);
  const asset = Array.isArray(assets) ? assets[0] : null;
  if (!asset?.binary?.package?.link) {
    throw new Error(`No Adoptium build found for Java ${major} on ${os}/${arch}`);
  }

  const pkg = asset.binary.package;
  const versionLabel = asset.version_data?.openjdk_version || String(major);
  const destDir = path.join(managedJavaRoot(), `jdk-${major}-${versionLabel.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
  await ensureDir(managedJavaRoot());
  await ensureDir(destDir);

  const archivePath = path.join(managedJavaRoot(), `jdk-${major}.${ext === 'zip' ? 'zip' : 'tar.gz'}`);
  await downloadFile(pkg.link, archivePath, {
    size: pkg.size,
    label: `Java ${versionLabel}`
  });

  progressBus.emitEvent('status', { message: `Extracting Java ${versionLabel}…` });
  await extractArchive(archivePath, destDir);

  const javaPath = await findJavaBinary(destDir);
  if (!javaPath) throw new Error('Extracted Java archive but could not find java executable');

  const info = await getJavaVersion(javaPath);
  const record = {
    path: javaPath,
    home: path.resolve(javaPath, '..', '..'),
    version: info?.version || versionLabel,
    major: info?.major || major,
    vendor: 'Eclipse Temurin',
    releaseName: asset.release_name,
    downloadedAt: new Date().toISOString()
  };

  const managed = await listManagedJava();
  const next = managed.filter((item) => item.path !== record.path);
  next.push(record);
  await saveManaged(next);

  // Optionally remove archive to save space.
  if (options.keepArchive !== true) {
    await fs.rm(archivePath, { force: true }).catch(() => {});
  }

  progressBus.emitEvent('java-downloaded', record);
  return record;
}

async function findJavaBinary(root) {
  const exe = javaExecutableName();
  const queue = [root];
  while (queue.length) {
    const dir = queue.shift();
    let items;
    try {
      items = await fs.readdir(dir, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const item of items) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) {
        if (item.name === 'bin') {
          const candidate = path.join(full, exe);
          try {
            await fs.access(candidate);
            return candidate;
          } catch (_) {
            // continue
          }
        }
        if (!['legal', 'man', 'jmods', 'include', 'lib'].includes(item.name)) {
          queue.push(full);
        }
      } else if (item.name === exe) {
        return full;
      }
    }
  }
  return null;
}

async function extractArchive(archivePath, destination) {
  await ensureDir(destination);
  if (archivePath.endsWith('.zip')) {
    await extractZip(archivePath, destination);
    return;
  }

  // tar.gz via system tar when available; fallback message otherwise.
  await new Promise((resolve, reject) => {
    const child = spawn('tar', ['-xzf', archivePath, '-C', destination], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let err = '';
    child.stderr.on('data', (c) => { err += c.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar failed (${code}): ${err.slice(0, 300)}`));
    });
  });
}

async function extractZip(archivePath, destination) {
  const zlib = require('node:zlib');
  const buf = await fs.readFile(archivePath);
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error('Invalid ZIP archive');

  const cdEntries = buf.readUInt16LE(eocdOffset + 8);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
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
    if (entryName.endsWith('/')) {
      await ensureDir(path.join(destination, entryName));
      continue;
    }
    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const localFileNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const dataOffset = localHeaderOffset + 30 + localFileNameLen + localExtraLen;
    const compressed = buf.subarray(dataOffset, dataOffset + compressedSize);
    let content;
    if (compressionMethod === 0) content = compressed;
    else if (compressionMethod === 8) content = zlib.inflateRawSync(compressed);
    else continue;
    const outPath = path.join(destination, entryName);
    await ensureDir(path.dirname(outPath));
    await fs.writeFile(outPath, content);
    if (process.platform !== 'win32' && (entryName.endsWith('/java') || entryName.endsWith('/javac') || entryName.endsWith('bin/java') || entryName.endsWith('bin/javac'))) {
      await fs.chmod(outPath, 0o755).catch(() => {});
    }
  }
}

/**
 * Pick Java for an instance: instance override → settings → managed → system scan.
 */
async function resolveJavaForLaunch(requiredMajor, preferredPath = '') {
  if (preferredPath) {
    const picked = await pickJava(requiredMajor, preferredPath);
    if (picked) return picked;
  }

  const managed = await listManagedJava();
  const managedMatch = managed
    .filter((j) => !requiredMajor || !j.major || j.major >= requiredMajor)
    .sort((a, b) => (b.major || 0) - (a.major || 0))[0];
  if (managedMatch) {
    return { ...managedMatch, selected: true, reason: `managed Java ${managedMatch.major}` };
  }

  return pickJava(requiredMajor, '');
}

async function autoDownloadIfMissing(requiredMajor) {
  const existing = await resolveJavaForLaunch(requiredMajor, '');
  if (existing) return existing;
  progressBus.emitEvent('status', { message: `No Java ${requiredMajor}+ found — downloading automatically…` });
  return downloadJava(requiredMajor);
}

module.exports = {
  listAllJava,
  listManagedJava,
  listDownloadableJava,
  downloadJava,
  resolveJavaForLaunch,
  autoDownloadIfMissing,
  recommendedJavaMajor,
  managedJavaRoot
};
