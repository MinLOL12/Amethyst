const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { APP_NAME, APP_VERSION, RESOURCES_BASE_URL } = require('../config');
const { getVersionMeta, artifactPathFromName } = require('./mojangApi');
const { downloadFile, fetchJson, mapLimit, progressBus } = require('./downloader');
const { ensureDir, writeJson, readJson } = require('./store');
const { isAllowedByRules } = require('./rules');
const { minecraftOsName, classpathSeparator } = require('./os');
const { recommendedJavaMajor } = require('./javaLocator');
const { resolveJavaForLaunch, autoDownloadIfMissing } = require('./javaManager');
const { readSettings, saveSettings, touchAccount } = require('./accounts');
const { ensureValidAccount } = require('./microsoftAuth');
const { gamePaths } = require('./minecraftPaths');
const { installLoader } = require('./modLoaders');
const { getInstance, touchPlayed, updateInstance } = require('./instances');
const { appendLog } = require('./logs');

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
 */
async function extractNativeJar(nativeJar, destination) {
  await ensureDir(destination);

  const zlib = require('node:zlib');
  const buf = await fs.readFile(nativeJar);

  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error(`Not a valid ZIP/JAR file: ${path.basename(nativeJar)}`);

  const cdEntries = buf.readUInt16LE(eocdOffset + 8);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);

  let pos = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;

    const compressionMethod = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const uncompressedSize = buf.readUInt32LE(pos + 24);
    const fileNameLength = buf.readUInt16LE(pos + 28);
    const extraFieldLength = buf.readUInt16LE(pos + 30);
    const commentLength = buf.readUInt16LE(pos + 32);
    const localHeaderOffset = buf.readUInt32LE(pos + 42);
    const entryName = buf.toString('utf8', pos + 46, pos + 46 + fileNameLength);

    pos += 46 + fileNameLength + extraFieldLength + commentLength;

    if (entryName.endsWith('/') || entryName.startsWith('META-INF')) continue;

    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const localFileNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const dataOffset = localHeaderOffset + 30 + localFileNameLen + localExtraLen;

    const compressed = buf.subarray(dataOffset, dataOffset + compressedSize);

    let content;
    if (compressionMethod === 0) {
      content = compressed;
    } else if (compressionMethod === 8) {
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

/**
 * Resolve version metadata with inheritsFrom chain (used by Fabric/Forge/Quilt profiles).
 */
async function resolveVersionMeta(versionId, gameDir) {
  const visited = new Set();
  let currentId = versionId;
  let merged = null;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    let meta;
    const localPath = path.join(gameDir, 'versions', currentId, `${currentId}.json`);
    try {
      meta = await readJson(localPath, null);
    } catch (_) {
      meta = null;
    }
    if (!meta) {
      meta = await getVersionMeta(currentId);
      await ensureDir(path.dirname(localPath));
      await writeJson(localPath, meta);
    }

    if (!merged) {
      merged = { ...meta };
    } else {
      merged = mergeVersionMeta(meta, merged);
    }
    currentId = meta.inheritsFrom;
  }

  if (!merged) throw new Error(`Unable to resolve version metadata for ${versionId}`);
  merged.id = versionId;
  return merged;
}

function mergeVersionMeta(parent, child) {
  // Child overrides parent; libraries concatenate; arguments merge.
  const merged = {
    ...parent,
    ...child,
    libraries: [...(parent.libraries || []), ...(child.libraries || [])],
    downloads: { ...(parent.downloads || {}), ...(child.downloads || {}) },
    assetIndex: child.assetIndex || parent.assetIndex,
    assets: child.assets || parent.assets,
    mainClass: child.mainClass || parent.mainClass,
    minecraftArguments: child.minecraftArguments || parent.minecraftArguments,
    javaVersion: child.javaVersion || parent.javaVersion
  };

  if (parent.arguments || child.arguments) {
    merged.arguments = {
      game: [...(parent.arguments?.game || []), ...(child.arguments?.game || [])],
      jvm: [...(parent.arguments?.jvm || []), ...(child.arguments?.jvm || [])]
    };
  }
  return merged;
}

async function installVersion(versionId, options = {}) {
  const settings = await readSettings();
  let gameDir = options.gameDir || settings.gameDir;
  let resolvedVersionId = versionId;

  if (options.instanceId) {
    const instance = await getInstance(options.instanceId);
    gameDir = instance.gameDir;
    resolvedVersionId = instance.versionId || versionId;

    // Install mod loader profile if needed.
    if (instance.loader && instance.loader !== 'vanilla') {
      const installed = await installLoader(instance.loader, instance.versionId, instance.loaderVersion, {
        gameDir,
        concurrency: options.concurrency || settings.maxConcurrentDownloads
      });
      resolvedVersionId = installed.versionId;
      if (installed.versionId !== instance.playVersionId) {
        await updateInstance(instance.id, { playVersionId: installed.versionId });
      }
    }
  } else if (options.loader && options.loader !== 'vanilla') {
    const installed = await installLoader(options.loader, versionId, options.loaderVersion, {
      gameDir,
      concurrency: options.concurrency || settings.maxConcurrentDownloads
    });
    resolvedVersionId = installed.versionId;
  }

  const concurrency = Number(options.concurrency || settings.maxConcurrentDownloads || 8);
  const paths = gamePaths(gameDir, resolvedVersionId);

  progressBus.emitEvent('install-start', { versionId: resolvedVersionId, gameDir });
  await ensureDir(paths.versionDir);
  await ensureDir(paths.libraries);
  await ensureDir(paths.assetObjects);
  await ensureDir(paths.natives);
  await ensureDir(paths.mods);
  await ensureDir(paths.saves);
  await ensureDir(paths.screenshots);
  await ensureDir(paths.resourcepacks);
  await ensureDir(paths.logs);
  await ensureDir(paths.crashReports);

  const versionMeta = await resolveVersionMeta(resolvedVersionId, gameDir);
  await writeJson(paths.versionJson, versionMeta);

  // Client jar: use this version's download, or fall back to inheritsFrom vanilla jar.
  let clientJarPath = paths.clientJar;
  if (versionMeta.downloads?.client?.url) {
    await downloadFile(versionMeta.downloads.client.url, paths.clientJar, {
      sha1: versionMeta.downloads.client.sha1,
      size: versionMeta.downloads.client.size,
      label: `Minecraft ${resolvedVersionId} client`
    });
  } else if (versionMeta.inheritsFrom) {
    const parentPaths = gamePaths(gameDir, versionMeta.inheritsFrom);
    const parentMeta = await resolveVersionMeta(versionMeta.inheritsFrom, gameDir);
    if (parentMeta.downloads?.client?.url) {
      await downloadFile(parentMeta.downloads.client.url, parentPaths.clientJar, {
        sha1: parentMeta.downloads.client.sha1,
        size: parentMeta.downloads.client.size,
        label: `Minecraft ${versionMeta.inheritsFrom} client`
      });
      clientJarPath = parentPaths.clientJar;
    }
  } else {
    throw new Error(`Minecraft ${resolvedVersionId} does not expose a downloadable client jar.`);
  }

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
  progressBus.emitEvent('install-complete', { versionId: resolvedVersionId, gameDir });
  return { versionMeta, paths: { ...paths, clientJar: clientJarPath }, versionId: resolvedVersionId };
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
  const result = [];
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = regex.exec(input))) result.push(match[1] ?? match[2] ?? match[3]);
  return result;
}

function splitUserArgs(input) {
  if (!input || !String(input).trim()) return [];
  return legacySplitArguments(String(input).trim());
}

function buildLaunchCommand(versionMeta, paths, account, launchSettings, javaPath) {
  const libraries = selectedLibraries(versionMeta)
    .map((library) => libraryArtifact(library))
    .filter(Boolean)
    .map((artifact) => path.join(paths.libraries, artifact.path));

  // Prefer version jar; fall back to paths.clientJar which may point at parent.
  const classpath = [...libraries, paths.clientJar].join(classpathSeparator());
  const assetIndexName = versionMeta.assetIndex?.id || versionMeta.assets || 'legacy';
  const memoryMb = Number(launchSettings.memoryMb) || 2048;
  const accessToken = account.accessToken || `offline-${account.uuid}`;
  const userType = account.userType || (account.type === 'microsoft' ? 'msa' : 'legacy');
  const width = Number(launchSettings.resolutionWidth) || 854;
  const height = Number(launchSettings.resolutionHeight) || 480;
  const fullscreen = Boolean(launchSettings.fullscreen);

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
    auth_access_token: accessToken,
    clientid: '',
    auth_xuid: account.xuid || '',
    user_type: userType,
    version_type: versionMeta.type || 'release',
    resolution_width: String(width),
    resolution_height: String(height)
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

  jvmArgs = jvmArgs.filter((arg) => !/^-Xm[xs]/i.test(arg));
  jvmArgs.unshift(`-Xms512M`, `-Xmx${memoryMb}M`);

  // Custom JVM arguments from settings / instance.
  jvmArgs.push(...splitUserArgs(launchSettings.jvmArgs));

  const features = {
    is_demo_user: false,
    has_custom_resolution: !fullscreen,
    is_quick_play_singleplayer: false,
    is_quick_play_multiplayer: false,
    is_quick_play_realms: false
  };

  let gameArgs = [];
  if (versionMeta.arguments?.game) {
    gameArgs = resolveArgumentList(versionMeta.arguments.game, replacements, features);
  } else if (versionMeta.minecraftArguments) {
    gameArgs = legacySplitArguments(versionMeta.minecraftArguments).map((arg) => replacePlaceholders(arg, replacements));
  }

  // Resolution / fullscreen extras when not already present.
  if (!fullscreen && !gameArgs.includes('--width')) {
    gameArgs.push('--width', String(width), '--height', String(height));
  }
  if (fullscreen && !gameArgs.includes('--fullscreen')) {
    gameArgs.push('--fullscreen');
  }

  gameArgs.push(...splitUserArgs(launchSettings.launchArgs));

  return {
    executable: javaPath,
    args: [...jvmArgs, versionMeta.mainClass, ...gameArgs],
    cwd: paths.root
  };
}

async function launchVersion(versionId, accountOrId, options = {}) {
  const settings = await readSettings();
  let instance = null;
  let launchVersionId = versionId;
  let gameDir = options.gameDir || settings.gameDir;

  if (options.instanceId) {
    instance = await getInstance(options.instanceId);
    gameDir = instance.gameDir;
    launchVersionId = instance.playVersionId || instance.versionId || versionId;
  }

  // Resolve account — accept raw offline object or id string.
  let authAccount;
  if (typeof accountOrId === 'string') {
    authAccount = await ensureValidAccount(accountOrId);
  } else if (accountOrId?.type === 'microsoft' || accountOrId?.mcToken) {
    authAccount = await ensureValidAccount(accountOrId.id);
  } else if (accountOrId?.username && accountOrId?.uuid) {
    authAccount = {
      id: accountOrId.id || accountOrId.uuid,
      username: accountOrId.username,
      uuid: accountOrId.uuid,
      type: accountOrId.type || 'offline',
      accessToken: accountOrId.accessToken || `offline-${accountOrId.uuid}`,
      userType: accountOrId.type === 'microsoft' ? 'msa' : 'legacy',
      xuid: accountOrId.xuid || ''
    };
  } else {
    throw new Error('Choose an account before launching.');
  }

  const install = await installVersion(launchVersionId, {
    ...options,
    gameDir,
    instanceId: options.instanceId,
    loader: options.loader || instance?.loader,
    loaderVersion: options.loaderVersion || instance?.loaderVersion
  });

  const launchSettings = {
    memoryMb: options.memoryMb || instance?.memoryMb || settings.memoryMb,
    javaPath: options.javaPath || instance?.javaPath || settings.javaPath,
    jvmArgs: options.jvmArgs ?? instance?.jvmArgs ?? settings.jvmArgs,
    launchArgs: options.launchArgs ?? instance?.launchArgs ?? settings.launchArgs,
    resolutionWidth: options.resolutionWidth || instance?.resolutionWidth || settings.resolutionWidth,
    resolutionHeight: options.resolutionHeight || instance?.resolutionHeight || settings.resolutionHeight,
    fullscreen: options.fullscreen ?? instance?.fullscreen ?? settings.fullscreen
  };

  await saveSettings({
    ...settings,
    memoryMb: launchSettings.memoryMb,
    lastVersion: install.versionId,
    lastAccountId: authAccount.id,
    lastInstanceId: instance?.id || settings.lastInstanceId
  });

  const requiredMajor = recommendedJavaMajor(install.versionMeta);
  let java = await resolveJavaForLaunch(requiredMajor, launchSettings.javaPath);
  if (!java && options.autoDownloadJava !== false) {
    java = await autoDownloadIfMissing(requiredMajor);
  }
  if (!java) {
    throw new Error(
      `No compatible Java installation found. Minecraft ${install.versionId} recommends Java ${requiredMajor}+; install Java, download it from the Java Manager, or set a custom path.`
    );
  }

  await touchAccount(authAccount.id);
  if (instance) await touchPlayed(instance.id);

  const command = buildLaunchCommand(install.versionMeta, install.paths, authAccount, launchSettings, java.path);
  progressBus.emitEvent('launch-start', {
    versionId: install.versionId,
    java: java.path,
    requiredMajor,
    commandPreview: `${command.executable} ${command.args.slice(0, 6).join(' ')} ...`
  });
  appendLog({
    stream: 'info',
    message: `Spawn: ${command.executable} (cwd=${command.cwd})`,
    source: 'launcher'
  });

  await ensureDir(command.cwd);
  const child = spawn(command.executable, command.args, {
    cwd: command.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false
  });

  child.stdout.on('data', (chunk) => progressBus.emitEvent('game-log', { stream: 'stdout', message: chunk.toString() }));
  child.stderr.on('data', (chunk) => progressBus.emitEvent('game-log', { stream: 'stderr', message: chunk.toString() }));
  child.on('error', (error) => progressBus.emitEvent('launch-error', { versionId: install.versionId, message: error.message }));
  child.on('close', (code, signal) => progressBus.emitEvent('launch-exit', { versionId: install.versionId, code, signal }));

  return { pid: child.pid, java, versionId: install.versionId, instanceId: instance?.id || null };
}

module.exports = {
  installVersion,
  launchVersion,
  buildLaunchCommand,
  gamePaths,
  selectedLibraries,
  getLibraryDownloads,
  replacePlaceholders,
  legacySplitArguments,
  resolveVersionMeta
};
