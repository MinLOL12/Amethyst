const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { APP_NAME, APP_VERSION, RESOURCES_BASE_URL, getAssetUrls } = require('../config');
const { getVersionMeta, artifactPathFromName } = require('./mojangApi');
const { downloadFile, mapLimit, progressBus } = require('./downloader');
const { ensureDir, writeJson, readJson } = require('./store');
const { isAllowedByRules } = require('./rules');
const { minecraftOsName, classpathSeparator } = require('./os');
const { recommendedJavaMajor } = require('./javaLocator');
const { resolveJavaForLaunch, autoDownloadIfMissing } = require('./javaManager');
const { readSettings, saveSettings, touchAccount } = require('./accounts');
const { ensureValidAccount } = require('./microsoftAuth');
const { gamePaths } = require('./minecraftPaths');
const {
  installLoader,
  normalizeLoader,
  loaderVersionId,
  findInstalledLoaderProfile
} = require('./modLoaders');
const { getInstance, touchPlayed, updateInstance } = require('./instances');
const { appendLog } = require('./logs');
const { startRuntimeMonitor } = require('./runtime');

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
    label: `asset index ${assetIndexId}`,
    // asset indexes are small – give them a couple extra retries
    maxRetries: 6
  });

  const assetIndex = JSON.parse(await fs.readFile(assetIndexPath, 'utf8'));
  const objects = Object.entries(assetIndex.objects || {});
  progressBus.emitEvent('status', { message: `Checking ${objects.length} assets` });

  let completed = 0;
  let failed = 0;
  await mapLimit(objects, concurrency, async ([name, object]) => {
    const hash = object.hash;
    const prefix = hash.slice(0, 2);
    const destination = path.join(paths.assetObjects, prefix, hash);

    // Build mirror list explicitly so we can log which mirror succeeded
    const urls = getAssetUrls ? getAssetUrls(hash) : [`${RESOURCES_BASE_URL}/${prefix}/${hash}`];
    const [primaryUrl, ...alternativeUrls] = urls;

    try {
      await downloadFile(primaryUrl, destination, {
        sha1: hash,
        size: object.size,
        label: `asset ${name}`,
        alternativeUrls,
        // assets are numerous and sometimes flaky – be generous with retries
        maxRetries: 6,
        timeoutMs: 45000
      });
    } catch (error) {
      failed += 1;
      progressBus.emitEvent('status', {
        message: `Asset ${name} failed after all mirrors: ${error.message}`
      });
      // Re-throw so install fails visibly, but include helpful context
      error.message = `Download asset ${name} failed — ${error.message}`;
      throw error;
    }

    completed += 1;
    if (completed % 25 === 0 || completed === objects.length) {
      progressBus.emitEvent('assets-progress', {
        completed,
        total: objects.length,
        failed,
        percent: objects.length ? Math.round((completed / objects.length) * 1000) / 10 : 100
      });
    }
  });
}

/**
 * Merge an inherited loader profile over its vanilla parent. Loader libraries
 * are placed first on the classpath and override parent libraries with the same
 * Maven coordinate. Most importantly, the child's mainClass survives: that is
 * the entry point that scans the mods directory.
 */
function mergeVersionMeta(parent, child) {
  const childLibraryNames = new Set((child.libraries || []).map((library) => library?.name).filter(Boolean));
  const parentLibraries = (parent.libraries || []).filter((library) => !childLibraryNames.has(library?.name));
  const merged = {
    ...parent,
    ...child,
    libraries: [...(child.libraries || []), ...parentLibraries],
    downloads: { ...(parent.downloads || {}), ...(child.downloads || {}) },
    assetIndex: child.assetIndex || parent.assetIndex,
    assets: child.assets || parent.assets,
    mainClass: child.mainClass || parent.mainClass,
    minecraftArguments: child.minecraftArguments || parent.minecraftArguments,
    javaVersion: child.javaVersion || parent.javaVersion
  };

  if (parent.arguments || child.arguments) {
    merged.arguments = {
      game: [...(child.arguments?.game || []), ...(parent.arguments?.game || [])],
      jvm: [...(child.arguments?.jvm || []), ...(parent.arguments?.jvm || [])]
    };
  }
  return merged;
}

/** Resolve metadata plus the actual vanilla client JAR used by a loader. */
async function resolveVersionDetails(versionId, gameDir) {
  const visited = new Set();
  const chain = [];
  let currentId = versionId;

  while (currentId) {
    if (visited.has(currentId)) throw new Error(`Circular Minecraft version inheritance at ${currentId}`);
    visited.add(currentId);

    const localPath = path.join(gameDir, 'versions', currentId, `${currentId}.json`);
    let meta = await readJson(localPath, null);
    if (!meta) {
      meta = await getVersionMeta(currentId);
      await writeJson(localPath, meta);
    }
    chain.push({ id: currentId, meta });
    currentId = meta.inheritsFrom || null;
  }

  if (!chain.length) throw new Error(`Unable to resolve version metadata for ${versionId}`);
  let versionMeta = { ...chain.at(-1).meta };
  for (let index = chain.length - 2; index >= 0; index -= 1) {
    versionMeta = mergeVersionMeta(versionMeta, chain[index].meta);
  }
  versionMeta.id = versionId;

  const requestedJarId = chain[0].meta.jar;
  const clientEntry = (requestedJarId && chain.find((entry) => entry.id === requestedJarId))
    || chain.find((entry) => entry.meta.downloads?.client?.url);
  const clientVersionId = clientEntry?.id || requestedJarId || versionId;
  const clientDownload = clientEntry?.meta.downloads?.client || versionMeta.downloads?.client || null;

  return { versionMeta, chain, clientVersionId, clientDownload };
}

async function resolveVersionMeta(versionId, gameDir) {
  return (await resolveVersionDetails(versionId, gameDir)).versionMeta;
}

function loaderSelection(options, settings, instance = null) {
  if (instance) {
    return {
      loader: normalizeLoader(instance.loader || 'vanilla'),
      loaderVersion: String(instance.loaderVersion || '')
    };
  }
  const explicitLoader = options.loaderType !== undefined ? options.loaderType : options.loader;
  const selected = explicitLoader !== undefined ? explicitLoader : settings.loaderType;
  return {
    loader: normalizeLoader(selected || 'vanilla'),
    loaderVersion: String(options.loaderVersion !== undefined ? options.loaderVersion : settings.loaderVersion || '')
  };
}

async function installedLoaderTarget(loader, gameVersion, loaderVersion, gameDir) {
  if (loader === 'vanilla') return gameVersion;
  return findInstalledLoaderProfile(loader, gameVersion, loaderVersion, gameDir);
}

async function checkVersionInstalled(versionId, options = {}) {
  const settings = await readSettings();
  let gameDir = options.gameDir || settings.gameDir;
  let baseVersionId = versionId;
  let instance = null;

  if (options.instanceId) {
    instance = await getInstance(options.instanceId);
    gameDir = instance.gameDir;
    baseVersionId = instance.versionId || versionId;
  }

  const selection = loaderSelection(options, settings, instance);
  let resolvedVersionId = baseVersionId;
  if (selection.loader !== 'vanilla') {
    resolvedVersionId = await installedLoaderTarget(
      selection.loader,
      baseVersionId,
      selection.loaderVersion,
      gameDir
    );
    // A vanilla install is never an installed Fabric/Forge/Quilt runtime. This
    // prevents the download-skipping optimization from silently launching
    // vanilla and ignoring every jar in mods/.
    if (!resolvedVersionId) {
      return {
        installed: false,
        versionId: selection.loaderVersion
          ? loaderVersionId(selection.loader, baseVersionId, selection.loaderVersion)
          : baseVersionId,
        baseVersionId,
        gameDir,
        loader: selection.loader,
        loaderVersion: selection.loaderVersion,
        missing: [path.join(gameDir, 'versions', loaderVersionId(selection.loader, baseVersionId, selection.loaderVersion))],
        missingCount: 1,
        reason: 'mod-loader-profile-missing'
      };
    }
  }

  const paths = gamePaths(gameDir, resolvedVersionId);
  const missing = [];
  try {
    await fs.access(paths.versionJson);
    const details = await resolveVersionDetails(resolvedVersionId, gameDir);
    const effectivePaths = {
      ...paths,
      clientJar: gamePaths(gameDir, details.clientVersionId).clientJar
    };
    try { await fs.access(effectivePaths.clientJar); } catch (_) { missing.push(effectivePaths.clientJar); }

    const { downloads, natives } = getLibraryDownloads(details.versionMeta, effectivePaths);
    for (const download of downloads) {
      try { await fs.access(download.destination); } catch (_) { missing.push(download.destination); }
    }

    const assetIndexId = details.versionMeta.assetIndex?.id || details.versionMeta.assets || 'legacy';
    const assetIndexPath = path.join(effectivePaths.assetIndexes, `${assetIndexId}.json`);
    let assetIndexExists = false;
    try {
      const assetIndex = JSON.parse(await fs.readFile(assetIndexPath, 'utf8'));
      assetIndexExists = true;
      for (const object of Object.values(assetIndex.objects || {})) {
        if (!object?.hash) continue;
        const assetPath = path.join(effectivePaths.assetObjects, object.hash.slice(0, 2), object.hash);
        try { await fs.access(assetPath); } catch (_) { missing.push(assetPath); }
      }
    } catch (_) {
      missing.push(assetIndexPath);
    }

    if (natives.length) {
      try {
        if (!(await fs.readdir(effectivePaths.natives)).length) missing.push(effectivePaths.natives);
      } catch (_) {
        missing.push(effectivePaths.natives);
      }
    }

    return {
      installed: missing.length === 0,
      versionId: resolvedVersionId,
      baseVersionId,
      gameDir,
      paths: effectivePaths,
      versionMeta: details.versionMeta,
      loader: selection.loader,
      loaderVersion: selection.loaderVersion,
      missing: missing.slice(0, 25),
      missingCount: missing.length,
      missingLibraries: downloads.filter((download) => missing.includes(download.destination)).length,
      totalLibraries: downloads.length,
      assetIndexExists
    };
  } catch (error) {
    if (error.code === 'ENOENT') missing.push(paths.versionJson);
    return {
      installed: false,
      versionId: resolvedVersionId,
      baseVersionId,
      gameDir,
      paths,
      loader: selection.loader,
      loaderVersion: selection.loaderVersion,
      missing: missing.slice(0, 25),
      missingCount: Math.max(1, missing.length),
      reason: error.code === 'ENOENT' ? 'required-file-missing' : error.message
    };
  }
}

async function installVersion(versionId, options = {}) {
  const settings = await readSettings();
  let gameDir = options.gameDir || settings.gameDir;
  let instance = null;
  let baseVersionId = versionId;

  if (options.instanceId) {
    instance = await getInstance(options.instanceId);
    gameDir = instance.gameDir;
    baseVersionId = instance.versionId || versionId;
  }

  const selection = loaderSelection(options, settings, instance);
  const concurrency = Number(options.concurrency || settings.maxConcurrentDownloads || 8);
  progressBus.emitEvent('install-start', {
    versionId: baseVersionId,
    gameDir,
    loader: selection.loader,
    loaderVersion: selection.loaderVersion
  });

  async function installRuntime(targetVersionId) {
    const paths = gamePaths(gameDir, targetVersionId);
    await Promise.all([
      ensureDir(paths.versionDir),
      ensureDir(paths.libraries),
      ensureDir(paths.assetObjects),
      ensureDir(paths.natives),
      ensureDir(paths.mods),
      ensureDir(paths.saves),
      ensureDir(paths.screenshots),
      ensureDir(paths.resourcepacks),
      ensureDir(paths.logs),
      ensureDir(paths.crashReports)
    ]);

    const details = await resolveVersionDetails(targetVersionId, gameDir);
    if (!details.clientDownload?.url) {
      throw new Error(`Minecraft ${targetVersionId} does not expose a downloadable client jar.`);
    }
    const clientPaths = gamePaths(gameDir, details.clientVersionId);
    await downloadFile(details.clientDownload.url, clientPaths.clientJar, {
      sha1: details.clientDownload.sha1,
      size: details.clientDownload.size,
      label: `Minecraft ${details.clientVersionId} client`
    });

    const effectivePaths = { ...paths, clientJar: clientPaths.clientJar };
    const { downloads, natives } = getLibraryDownloads(details.versionMeta, effectivePaths);
    progressBus.emitEvent('status', { message: `Downloading ${downloads.length} libraries` });
    await mapLimit(downloads, concurrency, (download) => downloadFile(download.url, download.destination, download));

    if (natives.length) {
      progressBus.emitEvent('status', { message: `Extracting ${natives.length} native libraries` });
      await fs.rm(paths.natives, { recursive: true, force: true });
      await ensureDir(paths.natives);
      for (const item of natives) await extractNativeJar(item.jar, paths.natives);
    }

    await downloadAssets(details.versionMeta, effectivePaths, concurrency);
    return { versionMeta: details.versionMeta, paths: effectivePaths, versionId: targetVersionId };
  }

  let resolvedVersionId = baseVersionId;
  let resolvedLoaderVersion = selection.loaderVersion;

  if (selection.loader !== 'vanilla') {
    // Forge processors require a complete vanilla installation. Installing the
    // parent first is harmless for Fabric/Quilt and makes every loader follow
    // the same reliable path.
    await installRuntime(baseVersionId);
    const installed = await installLoader(
      selection.loader,
      baseVersionId,
      selection.loaderVersion,
      {
        ...options,
        gameDir,
        javaPath: options.javaPath || instance?.javaPath || settings.javaPath,
        concurrency
      }
    );
    resolvedVersionId = installed.versionId;
    resolvedLoaderVersion = installed.loaderVersion || resolvedLoaderVersion;
    if (instance && (
      installed.versionId !== instance.playVersionId ||
      resolvedLoaderVersion !== instance.loaderVersion
    )) {
      await updateInstance(instance.id, {
        playVersionId: installed.versionId,
        loaderVersion: resolvedLoaderVersion
      });
    }
  }

  const result = await installRuntime(resolvedVersionId);
  progressBus.emitEvent('install-complete', {
    versionId: resolvedVersionId,
    baseVersionId,
    gameDir,
    loader: selection.loader,
    loaderVersion: resolvedLoaderVersion
  });
  return {
    ...result,
    baseVersionId,
    loader: selection.loader,
    loaderVersion: resolvedLoaderVersion
  };
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

function buildLaunchCommand(versionMeta, paths, account, launchSettings, javaPath, javaMajor = 0) {
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
    user_properties: '{}',
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

  // Add module access flags for Java 16+ to support Forge and certain mods.
  if (javaMajor >= 16) {
    jvmArgs.push(
      '--add-opens', 'java.base/java.util=ALL-UNNAMED',
      '--add-opens', 'java.base/java.lang.reflect=ALL-UNNAMED',
      '--add-opens', 'java.base/java.util.concurrent=ALL-UNNAMED',
      '--add-opens', 'java.base/java.text=ALL-UNNAMED',
      '--add-opens', 'java.base/java.lang=ALL-UNNAMED',
      '--add-opens', 'java.base/java.nio=ALL-UNNAMED',
      '--add-opens', 'java.base/jdk.internal.loader=ALL-UNNAMED',
      '--add-opens', 'java.base/jdk.internal.module=ALL-UNNAMED',
      '--add-opens', 'java.base/java.lang.invoke=ALL-UNNAMED'
    );
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
  let gameDir = options.gameDir || settings.gameDir;
  let baseVersionId = versionId;

  if (options.instanceId) {
    instance = await getInstance(options.instanceId);
    gameDir = instance.gameDir;
    baseVersionId = instance.versionId || versionId;
  }
  const selection = loaderSelection(options, settings, instance);

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

  let install;
  if (options.skipInstall) {
    let launchVersionId = baseVersionId;
    if (selection.loader !== 'vanilla') {
      launchVersionId = await installedLoaderTarget(
        selection.loader,
        baseVersionId,
        selection.loaderVersion,
        gameDir
      );
    }

    if (launchVersionId) {
      const details = await resolveVersionDetails(launchVersionId, gameDir);
      const paths = {
        ...gamePaths(gameDir, launchVersionId),
        clientJar: gamePaths(gameDir, details.clientVersionId).clientJar
      };
      install = {
        versionMeta: details.versionMeta,
        paths,
        versionId: launchVersionId,
        baseVersionId,
        loader: selection.loader,
        loaderVersion: selection.loaderVersion
      };
      progressBus.emitEvent('status', {
        message: `${launchVersionId} already installed — launching directly`
      });
    }
  }

  // A caller may have requested skipInstall using a stale vanilla check. Never
  // honor that optimization when the selected loader profile is absent.
  if (!install) {
    install = await installVersion(baseVersionId, {
      ...options,
      gameDir,
      instanceId: options.instanceId,
      loaderType: selection.loader,
      loaderVersion: selection.loaderVersion
    });
  }

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
    // Keep the Mojang version in Quick Launch; a loader profile id is not an
    // option in the version picker.
    lastVersion: baseVersionId,
    lastAccountId: authAccount.id,
    lastInstanceId: instance?.id || settings.lastInstanceId,
    loaderType: !instance && options.persistLoader !== false ? selection.loader : settings.loaderType,
    loaderVersion: !instance && options.persistLoader !== false
      ? (install.loaderVersion || selection.loaderVersion)
      : settings.loaderVersion
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

  const command = buildLaunchCommand(install.versionMeta, install.paths, authAccount, launchSettings, java.path, java.major);
  const launchEvent = {
    versionId: install.versionId,
    baseVersionId,
    loader: selection.loader,
    loaderType: selection.loader,
    loaderVersion: install.loaderVersion || selection.loaderVersion,
    mainClass: install.versionMeta.mainClass,
    modsDir: install.paths.mods,
    java: java.path,
    requiredMajor,
    commandPreview: `${command.executable} ${command.args.slice(0, 6).join(' ')} ...`
  };
  progressBus.emitEvent('launch-start', launchEvent);
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

  // Do not report a successful launch merely because spawn() returned a ChildProcess.
  // Missing executables fail asynchronously, and bad classpaths commonly make Java
  // exit in the first few milliseconds. Keep a short stderr tail so the API can
  // return the useful Java error instead of claiming that everything is ready.
  let stderrTail = '';
  child.stdout.on('data', (chunk) => progressBus.emitEvent('game-log', { stream: 'stdout', message: chunk.toString() }));
  child.stderr.on('data', (chunk) => {
    const message = chunk.toString();
    stderrTail = `${stderrTail}${message}`.slice(-4000);
    progressBus.emitEvent('game-log', { stream: 'stderr', message });
  });

  let startupConfirmed = false;
  const startup = new Promise((resolve, reject) => {
    let timer = null;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(error);
    };

    child.once('error', (error) => fail(new Error(`Could not start Minecraft: ${error.message}`)));
    child.once('spawn', () => {
      progressBus.emitEvent('launch-start', launchEvent);
      startRuntimeMonitor(child, {
        ...launchEvent,
        username: authAccount.username
      });
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        startupConfirmed = true;
        resolve();
      }, Number(options.startupGraceMs) >= 0 ? Number(options.startupGraceMs) : 1500);
    });
    child.once('close', (code, signal) => {
      if (startupConfirmed || settled) return;
      const detail = stderrTail.trim().split('\n').slice(-8).join('\n');
      const reason = signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`;
      fail(new Error(`Minecraft stopped during startup (${reason}).${detail ? `\n${detail}` : ' Check the launcher log for details.'}`));
    });
  });

  child.on('close', (code, signal) => {
    if (startupConfirmed) progressBus.emitEvent('launch-exit', { versionId: install.versionId, code, signal });
  });

  try {
    await startup;
  } catch (error) {
    progressBus.emitEvent('launch-error', { versionId: install.versionId, message: error.message });
    throw error;
  }

  progressBus.emitEvent('launch-ready', {
    ...launchEvent,
    pid: child.pid,
    username: authAccount.username
  });

  return {
    pid: child.pid,
    java,
    versionId: install.versionId,
    baseVersionId,
    loader: selection.loader,
    loaderVersion: install.loaderVersion || selection.loaderVersion,
    instanceId: instance?.id || null
  };
}

/**
 * List all installed Minecraft versions in the given game directory.
 * Returns vanilla versions and loader profiles (Fabric, Forge, NeoForge, Quilt).
 */
async function listInstalledVersions(gameDir) {
  const versionsDir = path.join(gameDir, 'versions');
  let entries;
  try {
    entries = await fs.readdir(versionsDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const installed = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const versionId = entry.name;
    const versionJsonPath = path.join(versionsDir, versionId, `${versionId}.json`);
    let meta;
    try {
      meta = await readJson(versionJsonPath, null);
    } catch (_) {
      continue;
    }
    if (!meta) continue;

    // Check if client jar exists
    const clientJarPath = path.join(versionsDir, versionId, `${versionId}.jar`);
    let hasClientJar = false;
    try {
      await fs.access(clientJarPath);
      hasClientJar = true;
    } catch (_) {
      // Client jar might be inherited from parent
      if (meta.inheritsFrom) {
        const parentJarPath = path.join(versionsDir, meta.inheritsFrom, `${meta.inheritsFrom}.jar`);
        try {
          await fs.access(parentJarPath);
          hasClientJar = true;
        } catch (_) {}
      }
    }

    if (!hasClientJar) continue;

    installed.push({
      id: versionId,
      type: meta.type || 'release',
      releaseTime: meta.releaseTime,
      loader: meta.loader || 'vanilla',
      inheritsFrom: meta.inheritsFrom || null
    });
  }

  // Sort: releases first, then snapshots, then by release time descending
  installed.sort((a, b) => {
    const typeOrder = { release: 0, snapshot: 1, 'old_beta': 2, 'old_alpha': 3 };
    const aType = typeOrder[a.type] ?? 99;
    const bType = typeOrder[b.type] ?? 99;
    if (aType !== bType) return aType - bType;
    const aTime = new Date(a.releaseTime || 0).getTime();
    const bTime = new Date(b.releaseTime || 0).getTime();
    return bTime - aTime;
  });

  return installed;
}

async function uninstallVersion(versionId, gameDir) {
  const versionDir = path.join(gameDir, 'versions', versionId);
  const versionJsonPath = path.join(versionDir, `${versionId}.json`);

  let meta;
  try {
    meta = await readJson(versionJsonPath, null);
  } catch (_) {
    throw new Error(`Version not found: ${versionId}`);
  }

  if (!meta) throw new Error(`Version not found: ${versionId}`);

  // If this version inherits from another, check if any other version depends on it
  const versionsDir = path.join(gameDir, 'versions');
  let entries;
  try {
    entries = await fs.readdir(versionsDir, { withFileTypes: true });
  } catch (_) {
    entries = [];
  }

  const dependents = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === versionId) continue;
    const otherJsonPath = path.join(versionsDir, entry.name, `${entry.name}.json`);
    try {
      const otherMeta = await readJson(otherJsonPath, null);
      if (otherMeta?.inheritsFrom === versionId) {
        dependents.push(entry.name);
      }
    } catch (_) {}
  }

  if (dependents.length > 0) {
    throw new Error(
      `Cannot uninstall ${versionId}: the following versions depend on it: ${dependents.join(', ')}`
    );
  }

  // Delete the version directory
  await fs.rm(versionDir, { recursive: true, force: true });

  return { uninstalled: versionId, freedSpace: true };
}

module.exports = {
  installVersion,
  launchVersion,
  checkVersionInstalled,
  listInstalledVersions,
  uninstallVersion,
  buildLaunchCommand,
  gamePaths,
  selectedLibraries,
  getLibraryDownloads,
  replacePlaceholders,
  legacySplitArguments,
  mergeVersionMeta,
  resolveVersionMeta,
  resolveVersionDetails
};
