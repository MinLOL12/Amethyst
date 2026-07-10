const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { APP_NAME, APP_VERSION, RESOURCES_BASE_URL } = require('../config');
const { getVersionMeta, artifactPathFromName } = require('./mojangApi');
const { downloadFile, fetchJson, mapLimit, progressBus } = require('./downloader');
const { ensureDir, writeJson } = require('./store');
const { isAllowedByRules } = require('./rules');
const { minecraftOsName, classpathSeparator } = require('./os');
const { pickJava, recommendedJavaMajor } = require('./javaLocator');
const { readSettings, saveSettings, touchAccount } = require('./accounts');

function gamePaths(gameDir, versionId) {
  return {
    root: gameDir,
    versions: path.join(gameDir, 'versions'),
    versionDir: path.join(gameDir, 'versions', versionId),
    versionJson: path.join(gameDir, 'versions', versionId, `${versionId}.json`),
    clientJar: path.join(gameDir, 'versions', versionId, `${versionId}.jar`),
    libraries: path.join(gameDir, 'libraries'),
    assets: path.join(gameDir, 'assets'),
    assetIndexes: path.join(gameDir, 'assets', 'indexes'),
    assetObjects: path.join(gameDir, 'assets', 'objects'),
    natives: path.join(gameDir, 'versions', versionId, 'natives')
  };
}

function currentRuleEnv() {
  return { name: minecraftOsName(), arch: process.arch === 'ia32' ? 'x86' : process.arch };
}

function nativeClassifier(library) {
  if (!library.natives) return null;
  const key = library.natives[minecraftOsName()];
  if (!key) return null;
  return key.replace('${arch}', process.arch === 'x64' ? '64' : '32');
}

function libraryArtifact(library) {
  if (library.downloads) return library.downloads.artifact || null;

  const relativePath = artifactPathFromName(library.name);
  if (!relativePath) return null;
  const normalizedPath = relativePath.replaceAll('\\', '/');
  const baseUrl = library.url || 'https://libraries.minecraft.net/';
  return {
    path: normalizedPath,
    url: new URL(normalizedPath, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString()
  };
}

function selectedLibraries(versionMeta) {
  return (versionMeta.libraries || []).filter((library) => isAllowedByRules(library.rules, currentRuleEnv()));
}

function getLibraryDownloads(versionMeta, paths) {
  const downloads = [];
  const natives = [];
  const seenDownloads = new Set();
  const seenNatives = new Set();

  function addDownload(download) {
    const key = download.destination;
    if (seenDownloads.has(key)) return false;
    seenDownloads.add(key);
    downloads.push(download);
    return true;
  }

  for (const library of selectedLibraries(versionMeta)) {
    const artifact = libraryArtifact(library);
    if (artifact?.url && artifact?.path) {
      addDownload({
        url: artifact.url,
        destination: path.join(paths.libraries, artifact.path),
        sha1: artifact.sha1,
        size: artifact.size,
        label: library.name
      });
    }

    const classifier = nativeClassifier(library);
    const nativeArtifact = classifier && library.downloads?.classifiers?.[classifier];
    if (nativeArtifact?.url && nativeArtifact?.path) {
      const destination = path.join(paths.libraries, nativeArtifact.path);
      addDownload({
        url: nativeArtifact.url,
        destination,
        sha1: nativeArtifact.sha1,
        size: nativeArtifact.size,
        label: `${library.name} (${classifier})`
      });
      if (!seenNatives.has(destination)) {
        seenNatives.add(destination);
        natives.push({ jar: destination, library, classifier });
      }
    }
  }

  return { downloads, natives };
}

/**
 * Extract a JAR/ZIP archive using pure Node.js built-ins (no external tools needed).
 * JAR files follow the ZIP specification; we parse the Central Directory to locate
 * each entry then inflate (or copy) it to the destination directory.
 */
async function extractNativeJar(nativeJar, destination) {
  await ensureDir(destination);

  const zlib = require('node:zlib');
  const buf = await fs.readFile(nativeJar);

  // --- Locate End-of-Central-Directory record (EOCD) ---
  // Signature: 0x06054b50.  Search from end of file backwards.
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error(`Not a valid ZIP/JAR file: ${path.basename(nativeJar)}`);

  const cdEntries = buf.readUInt16LE(eocdOffset + 8);
  const cdOffset  = buf.readUInt32LE(eocdOffset + 16);

  let pos = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break; // Central directory file header signature

    const compressionMethod = buf.readUInt16LE(pos + 10);
    const compressedSize    = buf.readUInt32LE(pos + 20);
    const uncompressedSize  = buf.readUInt32LE(pos + 24);
    const fileNameLength    = buf.readUInt16LE(pos + 28);
    const extraFieldLength  = buf.readUInt16LE(pos + 30);
    const commentLength     = buf.readUInt16LE(pos + 32);
    const localHeaderOffset = buf.readUInt32LE(pos + 42);
    const entryName         = buf.toString('utf8', pos + 46, pos + 46 + fileNameLength);

    pos += 46 + fileNameLength + extraFieldLength + commentLength;

    // Skip directories and META-INF entries
    if (entryName.endsWith('/') || entryName.startsWith('META-INF')) continue;

    // Read local file header to find actual data offset
    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const localFileNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const dataOffset = localHeaderOffset + 30 + localFileNameLen + localExtraLen;

    const compressed = buf.slice(dataOffset, dataOffset + compressedSize);

    let content;
    if (compressionMethod === 0) {
      // Stored (no compression)
      content = compressed;
    } else if (compressionMethod === 8) {
      // Deflated
      content = zlib.inflateRawSync(compressed);
    } else {
      throw new Error(`Unsupported ZIP compression method ${compressionMethod} in ${entryName}`);
    }

    if (content.length !== uncompressedSize) {
      throw new Error(`Size mismatch for ${entryName} in ${path.basename(nativeJar)}`);
    }

    const outPath = path.join(destination, entryName);
    await ensureDir(path.dirname(outPath));
    await fs.writeFile(outPath, content);
  }
}

async function downloadAssets(versionMeta, paths, concurrency) {
  if (!versionMeta.assetIndex?.url) return;
  const assetIndexId = versionMeta.assetIndex.id || versionMeta.assets || 'legacy';
  const assetIndexPath = path.join(paths.assetIndexes, `${assetIndexId}.json`);
  await downloadFile(versionMeta.assetIndex.url, assetIndexPath, {
    sha1: versionMeta.assetIndex.sha1,
    size: versionMeta.assetIndex.size,
    label: `asset index ${assetIndexId}`
  });

  const assetIndex = JSON.parse(await fs.readFile(assetIndexPath, 'utf8'));
  const objects = Object.entries(assetIndex.objects || {});
  progressBus.emitEvent('status', { message: `Checking ${objects.length} assets` });

  let completed = 0;
  await mapLimit(objects, concurrency, async ([name, object]) => {
    const hash = object.hash;
    const prefix = hash.slice(0, 2);
    await downloadFile(`${RESOURCES_BASE_URL}/${prefix}/${hash}`, path.join(paths.assetObjects, prefix, hash), {
      sha1: hash,
      size: object.size,
      label: `asset ${name}`
    });
    completed += 1;
    if (completed % 25 === 0 || completed === objects.length) {
      progressBus.emitEvent('assets-progress', {
        completed,
        total: objects.length,
        percent: objects.length ? Math.round((completed / objects.length) * 1000) / 10 : 100
      });
    }
  });
}

async function installVersion(versionId, options = {}) {
  const settings = await readSettings();
  const gameDir = options.gameDir || settings.gameDir;
  const concurrency = Number(options.concurrency || settings.maxConcurrentDownloads || 8);
  const paths = gamePaths(gameDir, versionId);

  progressBus.emitEvent('install-start', { versionId, gameDir });
  await ensureDir(paths.versionDir);
  await ensureDir(paths.libraries);
  await ensureDir(paths.assetObjects);
  await ensureDir(paths.natives);

  const versionMeta = await getVersionMeta(versionId);
  await writeJson(paths.versionJson, versionMeta);

  if (!versionMeta.downloads?.client?.url) throw new Error(`Minecraft ${versionId} does not expose a downloadable client jar.`);
  await downloadFile(versionMeta.downloads.client.url, paths.clientJar, {
    sha1: versionMeta.downloads.client.sha1,
    size: versionMeta.downloads.client.size,
    label: `Minecraft ${versionId} client`
  });

  const { downloads, natives } = getLibraryDownloads(versionMeta, paths);
  progressBus.emitEvent('status', { message: `Downloading ${downloads.length} libraries` });
  await mapLimit(downloads, concurrency, (download) => downloadFile(download.url, download.destination, download));

  if (natives.length) {
    progressBus.emitEvent('status', { message: `Extracting ${natives.length} native libraries` });
    await fs.rm(paths.natives, { recursive: true, force: true });
    await ensureDir(paths.natives);
    for (const item of natives) await extractNativeJar(item.jar, paths.natives);
  }

  await downloadAssets(versionMeta, paths, concurrency);
  progressBus.emitEvent('install-complete', { versionId, gameDir });
  return { versionMeta, paths };
}

function addArgument(output, value, replacements) {
  if (Array.isArray(value)) {
    for (const item of value) addArgument(output, item, replacements);
    return;
  }
  if (typeof value !== 'string') return;
  output.push(replacePlaceholders(value, replacements));
}

function resolveArgumentList(argumentDefinitions = [], replacements, features = {}) {
  const output = [];
  for (const definition of argumentDefinitions) {
    if (typeof definition === 'string') {
      addArgument(output, definition, replacements);
    } else if (definition && isAllowedByRules(definition.rules, currentRuleEnv(), features)) {
      addArgument(output, definition.value, replacements);
    }
  }
  return output;
}

function replacePlaceholders(input, replacements) {
  return String(input).replace(/\$\{([^}]+)\}/g, (match, name) => {
    if (Object.prototype.hasOwnProperty.call(replacements, name)) return replacements[name];
    return match;
  });
}

function legacySplitArguments(input) {
  // Mojang legacy arguments are simple space-separated templates for vanilla versions.
  // This keeps quoted tokens intact for safety without pulling in shell parsing dependencies.
  const result = [];
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = regex.exec(input))) result.push(match[1] ?? match[2] ?? match[3]);
  return result;
}

function buildLaunchCommand(versionMeta, paths, account, launchSettings, javaPath) {
  const libraries = selectedLibraries(versionMeta)
    .map((library) => libraryArtifact(library))
    .filter(Boolean)
    .map((artifact) => path.join(paths.libraries, artifact.path));
  const classpath = [...libraries, paths.clientJar].join(classpathSeparator());
  const assetIndexName = versionMeta.assetIndex?.id || versionMeta.assets || 'legacy';
  const memoryMb = Number(launchSettings.memoryMb) || 2048;
  const offlineToken = `offline-${account.uuid}`;
  const replacements = {
    natives_directory: paths.natives,
    launcher_name: APP_NAME,
    launcher_version: APP_VERSION,
    classpath,
    classpath_separator: classpathSeparator(),
    auth_player_name: account.username,
    version_name: versionMeta.id,
    game_directory: paths.root,
    assets_root: paths.assets,
    assets_index_name: assetIndexName,
    auth_uuid: String(account.uuid).replaceAll('-', ''),
    auth_access_token: offlineToken,
    clientid: '',
    auth_xuid: '',
    user_type: 'legacy',
    version_type: versionMeta.type || 'release'
  };

  let jvmArgs = [];
  if (versionMeta.arguments?.jvm) {
    jvmArgs = resolveArgumentList(versionMeta.arguments.jvm, replacements);
  } else {
    jvmArgs = [
      `-Djava.library.path=${paths.natives}`,
      '-cp',
      classpath
    ];
  }

  // Keep memory explicit and controlled by the UI slider.
  jvmArgs = jvmArgs.filter((arg) => !/^-Xm[xs]/i.test(arg));
  jvmArgs.unshift(`-Xms512M`, `-Xmx${memoryMb}M`);

  let gameArgs = [];
  if (versionMeta.arguments?.game) {
    gameArgs = resolveArgumentList(versionMeta.arguments.game, replacements, { is_demo_user: false, has_custom_resolution: false });
  } else if (versionMeta.minecraftArguments) {
    gameArgs = legacySplitArguments(versionMeta.minecraftArguments).map((arg) => replacePlaceholders(arg, replacements));
  }

  return {
    executable: javaPath,
    args: [...jvmArgs, versionMeta.mainClass, ...gameArgs],
    cwd: paths.root
  };
}

async function launchVersion(versionId, account, options = {}) {
  if (!account?.username || !account?.uuid) throw new Error('Choose or create an offline account before launching.');

  const install = await installVersion(versionId, options);
  const settings = await readSettings();
  const nextSettings = await saveSettings({ ...settings, ...options, lastVersion: versionId, lastAccountId: account.id || account.uuid });
  const requiredMajor = recommendedJavaMajor(install.versionMeta);
  const java = await pickJava(requiredMajor, nextSettings.javaPath);
  if (!java) {
    throw new Error(`No compatible Java installation found. Minecraft ${versionId} recommends Java ${requiredMajor}+; install Java or set a custom javaPath in settings.json.`);
  }

  await touchAccount(account.id || account.uuid);
  const command = buildLaunchCommand(install.versionMeta, install.paths, account, nextSettings, java.path);
  progressBus.emitEvent('launch-start', { versionId, java: java.path, requiredMajor, commandPreview: `${command.executable} ${command.args.slice(0, 6).join(' ')} ...` });

  await ensureDir(command.cwd);
  const child = spawn(command.executable, command.args, {
    cwd: command.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false
  });

  child.stdout.on('data', (chunk) => progressBus.emitEvent('game-log', { stream: 'stdout', message: chunk.toString() }));
  child.stderr.on('data', (chunk) => progressBus.emitEvent('game-log', { stream: 'stderr', message: chunk.toString() }));
  child.on('error', (error) => progressBus.emitEvent('launch-error', { versionId, message: error.message }));
  child.on('close', (code, signal) => progressBus.emitEvent('launch-exit', { versionId, code, signal }));

  return { pid: child.pid, java, versionId };
}

module.exports = {
  installVersion,
  launchVersion,
  buildLaunchCommand,
  gamePaths,
  selectedLibraries,
  getLibraryDownloads,
  replacePlaceholders,
  legacySplitArguments
};
