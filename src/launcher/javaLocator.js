const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

function javaExecutableName() {
  return process.platform === 'win32' ? 'java.exe' : 'java';
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function pathCandidates() {
  const exe = javaExecutableName();
  const candidates = [];

  if (process.env.JAVA_HOME) candidates.push(path.join(process.env.JAVA_HOME, 'bin', exe));
  if (process.env.JRE_HOME) candidates.push(path.join(process.env.JRE_HOME, 'bin', exe));

  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (dir) candidates.push(path.join(dir, exe));
  }

  if (process.platform === 'win32') {
    candidates.push(
      'C:\\Program Files\\Java\\jdk-21\\bin\\java.exe',
      'C:\\Program Files\\Java\\jdk-17\\bin\\java.exe',
      'C:\\Program Files\\Eclipse Adoptium\\jdk-21\\bin\\java.exe',
      'C:\\Program Files\\Eclipse Adoptium\\jdk-17\\bin\\java.exe'
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/usr/bin/java',
      '/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home/bin/java',
      '/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home/bin/java',
      '/Library/Internet Plug-Ins/JavaAppletPlugin.plugin/Contents/Home/bin/java'
    );
  } else {
    candidates.push(
      '/usr/bin/java',
      '/usr/local/bin/java',
      '/opt/java/bin/java',
      '/usr/lib/jvm/default-java/bin/java',
      '/usr/lib/jvm/java-21-openjdk/bin/java',
      '/usr/lib/jvm/java-17-openjdk/bin/java'
    );
  }

  return unique(candidates);
}

async function executableExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch (_) {
    return false;
  }
}

function getJavaVersion(javaPath) {
  return new Promise((resolve) => {
    const child = spawn(javaPath, ['-version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(null);
    }, 4000);
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', () => {
      clearTimeout(timer);
      const match = output.match(/version\s+"([^"]+)"/) || output.match(/openjdk\s+([0-9][^\s]+)/i);
      if (!match) return resolve({ path: javaPath, version: 'unknown', major: 0, raw: output.trim() });
      const version = match[1];
      const majorMatch = version.startsWith('1.') ? version.match(/^1\.(\d+)/) : version.match(/^(\d+)/);
      resolve({ path: javaPath, version, major: majorMatch ? Number(majorMatch[1]) : 0, raw: output.trim() });
    });
  });
}

async function scanJavaInstallations() {
  const found = [];
  for (const candidate of pathCandidates()) {
    if (!(await executableExists(candidate))) continue;
    const info = await getJavaVersion(candidate);
    if (info) found.push(info);
  }
  found.sort((a, b) => (b.major || 0) - (a.major || 0));
  return unique(found.map((item) => item.path)).map((javaPath) => found.find((item) => item.path === javaPath));
}

async function pickJava(requiredMajor = 17, preferredPath = '') {
  if (preferredPath && await executableExists(preferredPath)) {
    const info = await getJavaVersion(preferredPath);
    if (info && (!requiredMajor || !info.major || info.major >= requiredMajor)) {
      return { ...info, selected: true, reason: 'saved setting' };
    }
  }

  const installations = await scanJavaInstallations();
  const compatible = installations.find((java) => !requiredMajor || !java.major || java.major >= requiredMajor);
  if (compatible) return { ...compatible, selected: true, reason: `auto-detected Java ${compatible.major || compatible.version}` };
  return null;
}

function recommendedJavaMajor(versionMeta) {
  return Number(versionMeta?.javaVersion?.majorVersion) || 8;
}

module.exports = {
  scanJavaInstallations,
  pickJava,
  getJavaVersion,
  recommendedJavaMajor,
  javaExecutableName
};
