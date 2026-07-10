function minecraftOsName(platform = process.platform) {
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'osx';
  return 'linux';
}

function minecraftArch(arch = process.arch) {
  if (arch === 'x64') return 'x64';
  if (arch === 'arm64') return 'arm64';
  if (arch === 'ia32') return 'x86';
  return arch;
}

function classpathSeparator(platform = process.platform) {
  return platform === 'win32' ? ';' : ':';
}

module.exports = {
  minecraftOsName,
  minecraftArch,
  classpathSeparator
};
