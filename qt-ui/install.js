#!/usr/bin/env node
'use strict';

/**
 * Python-free setup/build helper for the Amethyst Qt UI.
 *
 * Node.js is already required by the launcher's backend, so this helper does
 * not add another runtime dependency. It validates the local toolchain,
 * configures CMake, builds the UI, and can optionally start it.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const qtUiDir = __dirname;
const buildDir = path.join(qtUiDir, 'build');
const minimumNodeMajor = 18;
const minimumCMake = [3, 16, 0];

function log(message) {
  console.log(`[amethyst-qt] ${message}`);
}

function fail(message) {
  console.error(`[amethyst-qt] ERROR: ${message}`);
  process.exit(1);
}

function usage() {
  console.log(`Amethyst Qt UI setup (no Python required)

Usage:
  node qt-ui/install.js [options]

Options:
  --build-type <type>  Release, Debug, RelWithDebInfo, or MinSizeRel
                       (default: Release)
  --qt-dir <path>      Qt installation prefix to pass to CMake
  --clean              Remove the existing build directory first
  --configure-only     Configure without compiling
  --run                Start Amethyst after a successful build
  -j, --jobs <count>   Number of parallel build jobs (default: CPU count)
  -h, --help           Show this help

Qt and CMake must be installed on the machine. The helper prints platform-
specific installation guidance when either one is missing.`);
}

function parseArguments(argv) {
  const options = {
    buildType: 'Release',
    clean: false,
    configureOnly: false,
    run: false,
    jobs: Math.max(1, os.availableParallelism?.() || os.cpus().length || 2),
    qtDir: process.env.QT_ROOT || ''
  };
  const allowedBuildTypes = new Set(['Release', 'Debug', 'RelWithDebInfo', 'MinSizeRel']);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const nextValue = () => {
      index += 1;
      if (index >= argv.length) fail(`${argument} requires a value.`);
      return argv[index];
    };

    if (argument === '--build-type') options.buildType = nextValue();
    else if (argument === '--qt-dir') options.qtDir = nextValue();
    else if (argument === '--clean') options.clean = true;
    else if (argument === '--configure-only') options.configureOnly = true;
    else if (argument === '--run') options.run = true;
    else if (argument === '-j' || argument === '--jobs') options.jobs = Number(nextValue());
    else if (argument === '-h' || argument === '--help') {
      usage();
      process.exit(0);
    } else fail(`Unknown option: ${argument}. Use --help for usage.`);
  }

  if (!allowedBuildTypes.has(options.buildType)) {
    fail(`Unsupported build type "${options.buildType}".`);
  }
  if (!Number.isInteger(options.jobs) || options.jobs < 1) {
    fail('--jobs must be a positive integer.');
  }
  if (options.configureOnly && options.run) {
    fail('--run cannot be combined with --configure-only.');
  }
  return options;
}

function run(command, args, options = {}) {
  log(`Running: ${[command, ...args].map(quoteArgument).join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd || qtUiDir,
    env: options.env || process.env,
    stdio: options.capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
    shell: false
  });
  if (result.error) {
    if (result.error.code === 'ENOENT') return null;
    fail(result.error.message);
  }
  if (!options.allowFailure && result.status !== 0) {
    process.exit(result.status || 1);
  }
  return result;
}

function quoteArgument(value) {
  const text = String(value);
  return /[\s"]/u.test(text) ? JSON.stringify(text) : text;
}

function versionTuple(text) {
  const match = String(text).match(/(\d+)\.(\d+)(?:\.(\d+))?/u);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3] || 0)] : [0, 0, 0];
}

function versionAtLeast(actual, required) {
  for (let index = 0; index < required.length; index += 1) {
    if (actual[index] > required[index]) return true;
    if (actual[index] < required[index]) return false;
  }
  return true;
}

function installationHelp(tool) {
  const platform = process.platform;
  if (tool === 'CMake') {
    if (platform === 'darwin') return 'Install it with "brew install cmake" or from https://cmake.org/download/.';
    if (platform === 'win32') return 'Install it with "winget install Kitware.CMake" or from https://cmake.org/download/.';
    return 'On Ubuntu/Debian run "sudo apt install cmake build-essential"; otherwise use your distribution package manager.';
  }
  if (platform === 'darwin') return 'Install Qt with "brew install qt@6".';
  if (platform === 'win32') return 'Install Qt 6.5+ from https://www.qt.io/download, then pass --qt-dir C:\\Qt\\6.x.x\\msvc... .';
  return 'On Ubuntu/Debian run "sudo apt install qt6-base-dev qt6-declarative-dev qml6-module-qtquick-controls"; otherwise use your distribution package manager.';
}

function checkCMake() {
  const result = run('cmake', ['--version'], { capture: true, allowFailure: true });
  if (!result || result.status !== 0) fail(`CMake was not found. ${installationHelp('CMake')}`);
  const version = versionTuple(result.stdout);
  if (!versionAtLeast(version, minimumCMake)) {
    fail(`CMake ${version.join('.')} was found, but 3.16+ is required. ${installationHelp('CMake')}`);
  }
  log(`Found ${result.stdout.split(/\r?\n/u)[0]}.`);
}

function findQtPrefix() {
  for (const qmake of ['qmake6', 'qmake']) {
    const result = run(qmake, ['-query', 'QT_INSTALL_PREFIX'], { capture: true, allowFailure: true });
    if (result?.status === 0 && result.stdout.trim()) return result.stdout.trim();
  }
  return '';
}

function checkQtPrefix(qtDir) {
  if (!qtDir) return;
  const resolved = path.resolve(qtDir);
  const configCandidates = [
    path.join(resolved, 'lib', 'cmake', 'Qt6', 'Qt6Config.cmake'),
    path.join(resolved, 'lib64', 'cmake', 'Qt6', 'Qt6Config.cmake')
  ];

  // Debian-style multiarch installs place it in lib/<architecture>/cmake/Qt6.
  const libDir = path.join(resolved, 'lib');
  if (fs.existsSync(libDir)) {
    for (const entry of fs.readdirSync(libDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        configCandidates.push(path.join(libDir, entry.name, 'cmake', 'Qt6', 'Qt6Config.cmake'));
      }
    }
  }

  if (!configCandidates.some((candidate) => fs.existsSync(candidate))) {
    fail(`No Qt6 CMake package was found below ${resolved}. ${installationHelp('Qt')}`);
  }
}

function executableCandidates(buildType) {
  const executable = process.platform === 'win32' ? 'Amethyst.exe' : 'Amethyst';
  return [
    path.join(buildDir, executable),
    path.join(buildDir, buildType, executable)
  ];
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor < minimumNodeMajor) fail(`Node.js ${minimumNodeMajor}+ is required.`);

  checkCMake();
  if (!options.qtDir) options.qtDir = findQtPrefix();
  checkQtPrefix(options.qtDir);
  if (options.qtDir) log(`Using Qt from ${path.resolve(options.qtDir)}.`);
  else log('No qmake6 was found; CMake will search its normal Qt package paths.');

  if (options.clean && fs.existsSync(buildDir)) {
    log(`Removing ${buildDir}.`);
    fs.rmSync(buildDir, { recursive: true, force: true });
  }

  const configureArgs = [
    '-S', qtUiDir,
    '-B', buildDir,
    `-DCMAKE_BUILD_TYPE=${options.buildType}`
  ];
  if (options.qtDir) configureArgs.push(`-DCMAKE_PREFIX_PATH=${path.resolve(options.qtDir)}`);
  const configured = run('cmake', configureArgs, { allowFailure: true });
  if (configured.status !== 0) {
    console.error(`\n[amethyst-qt] CMake could not configure the Qt UI. ${installationHelp('Qt')}`);
    process.exit(configured.status || 1);
  }

  if (options.configureOnly) {
    log('Configuration complete.');
    return;
  }

  run('cmake', [
    '--build', buildDir,
    '--config', options.buildType,
    '--parallel', String(options.jobs)
  ]);
  log('Build complete.');

  const executable = executableCandidates(options.buildType).find((candidate) => fs.existsSync(candidate));
  if (!executable) fail(`The build completed but the Amethyst executable was not found in ${buildDir}.`);
  log(`Launcher: ${executable}`);

  if (options.run) {
    log('Starting Amethyst...');
    const result = spawnSync(executable, [], { cwd: path.dirname(executable), stdio: 'inherit' });
    if (result.error) fail(result.error.message);
    if (result.status) process.exit(result.status);
  }
}

main();
