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

function javaExecutableFromHome(javaHome) {
  if (!javaHome) return null;
  return path.join(javaHome, 'bin', javaExecutableName());
}

async function addChildJavaExecutables(candidates, root, relativeParts = ['bin', javaExecutableName()]) {
  if (!root) return;
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) candidates.push(path.join(root, entry.name, ...relativeParts));
    }
  } catch (_) {
    // Directory does not exist or is not readable; ignore during best-effort auto-detection.
  }
}

async function pathCandidates() {
  const exe = javaExecutableName();
  const candidates = [];

  candidates.push(javaExecutableFromHome(process.env.JAVA_HOME));
  candidates.push(javaExecutableFromHome(process.env.JRE_HOME));

  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (dir) candidates.push(path.join(dir, exe));
  }

  if (process.platform === 'win32') {
    const programRoots = unique([
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')
    ]);

    for (const root of programRoots) {
      await addChildJavaExecutables(candidates, path.join(root, 'Java'));
      await addChildJavaExecutables(candidates, path.join(root, 'Eclipse Adoptium'));
      await addChildJavaExecutables(candidates, path.join(root, 'Microsoft'));
      await addChildJavaExecutables(candidates, path.join(root, 'BellSoft'));
      await addChildJavaExecutables(candidates, path.join(root, 'Azul'));
      await addChildJavaExecutables(candidates, path.join(root, 'Zulu'));
      await addChildJavaExecutables(candidates, path.join(root, 'Semeru'));
    }

    candidates.push(
      'C:\\Program Files\\Java\\jdk-21\\bin\\java.exe',
      'C:\\Program Files\\Java\\jdk-17\\bin\\java.exe',
      'C:\\Program Files\\Java\\jdk-8\\bin\\java.exe',
      'C:\\Program Files\\Java\\jre-8\\bin\\java.exe',
      'C:\\Program Files\\Eclipse Adoptium\\jdk-21\\bin\\java.exe',
      'C:\\Program Files\\Eclipse Adoptium\\jdk-17\\bin\\java.exe',
      'C:\\Program Files\\Eclipse Adoptium\\jdk-8\\bin\\java.exe',
      'C:\\Program Files\\Eclipse Adoptium\\jre-8\\bin\\java.exe'
    );
  } else if (process.platform === 'darwin') {
    await addChildJavaExecutables(candidates, '/Library/Java/JavaVirtualMachines', ['Contents', 'Home', 'bin', exe]);
    await addChildJavaExecutables(candidates, path.join(os.homedir(), 'Library', 'Java', 'JavaVirtualMachines'), ['Contents', 'Home', 'bin', exe]);
    candidates.push(
      '/usr/bin/java',
      '/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home/bin/java',
      '/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home/bin/java',
      '/Library/Java/JavaVirtualMachines/temurin-8.jdk/Contents/Home/bin/java',
      '/Library/Internet Plug-Ins/JavaAppletPlugin.plugin/Contents/Home/bin/java'
    );
  } else {
    await addChildJavaExecutables(candidates, '/usr/lib/jvm');
    await addChildJavaExecutables(candidates, '/usr/java');
    await addChildJavaExecutables(candidates, '/opt/java');
    await addChildJavaExecutables(candidates, '/opt/jdks');
    candidates.push(
      '/usr/bin/java',
      '/usr/local/bin/java',
      '/opt/java/bin/java',
      '/usr/lib/jvm/default-java/bin/java',
      '/usr/lib/jvm/java-21-openjdk/bin/java',
      '/usr/lib/jvm/java-17-openjdk/bin/java',
      '/usr/lib/jvm/java-8-openjdk/bin/java'
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
  for (const candidate of await pathCandidates()) {
    if (!(await executableExists(candidate))) continue;
    const info = await getJavaVersion(candidate);
    if (info) found.push(info);
  }

  const seen = new Set();
  const deduped = [];
  for (const item of found) {
    if (seen.has(item.path)) continue;
    seen.add(item.path);
    deduped.push(item);
  }

  deduped.sort((a, b) => (b.major || 0) - (a.major || 0));
  return deduped;
}

function javaRequirementLabel(minMajor = 0, maxMajor = 0) {
  if (minMajor && maxMajor && minMajor === maxMajor) return `Java ${minMajor}`;
  if (minMajor && maxMajor) return `Java ${minMajor}-${maxMajor}`;
  if (maxMajor) return `Java ${maxMajor} or older`;
  if (minMajor) return `Java ${minMajor}+`;
  return 'any Java version';
}

function normalizeJavaRequirement(requirement = 17) {
  if (typeof requirement === 'number' || typeof requirement === 'string') {
    const minMajor = Number(requirement) || 0;
    return {
      minMajor,
      maxMajor: 0,
      preferredMajor: minMajor,
      reason: '',
      description: javaRequirementLabel(minMajor, 0)
    };
  }

  const minMajor = Number(requirement?.minMajor ?? requirement?.requiredMajor ?? requirement?.major ?? 0) || 0;
  const maxMajor = Number(requirement?.maxMajor ?? 0) || 0;
  const preferredMajor = Number(requirement?.preferredMajor ?? minMajor) || 0;
  return {
    minMajor,
    maxMajor,
    preferredMajor,
    reason: requirement?.reason || '',
    description: requirement?.description || javaRequirementLabel(minMajor, maxMajor)
  };
}

function isJavaCompatible(java, requirement = 17) {
  const normalized = normalizeJavaRequirement(requirement);
  const major = Number(java?.major) || 0;

  // Unknown versions were historically allowed for minimum-only requirements, but
  // they are unsafe when a maximum is required (for example LaunchWrapper on Java 9+).
  if (!major) return !normalized.maxMajor;
  if (normalized.minMajor && major < normalized.minMajor) return false;
  if (normalized.maxMajor && major > normalized.maxMajor) return false;
  return true;
}

function javaSelectionScore(java, requirement = 17) {
  const normalized = normalizeJavaRequirement(requirement);
  const major = Number(java?.major) || 0;
  if (!major) return Number.MAX_SAFE_INTEGER;

  const preferred = normalized.preferredMajor || normalized.minMajor || major;
  if (major === preferred) return 0;

  if (normalized.maxMajor) {
    // For capped requirements prefer the newest compatible runtime, but keep the
    // preferred major (usually Java 8) first when it is present.
    return Math.abs(preferred - major) * 100 - major;
  }

  // For minimum-only requirements prefer the runtime Mojang recommends, then the
  // closest newer runtime. This avoids auto-selecting Java 21 for Java 8/17-era
  // versions when a matching runtime is installed.
  if (major > preferred) return (major - preferred) * 100 + major;
  return (preferred - major) * 1000 + major;
}

function selectCompatibleJava(installations, requirement = 17) {
  return [...(installations || [])]
    .filter((java) => isJavaCompatible(java, requirement))
    .sort((a, b) => javaSelectionScore(a, requirement) - javaSelectionScore(b, requirement))[0] || null;
}

async function pickJava(requirement = 17, preferredPath = '') {
  const normalized = normalizeJavaRequirement(requirement);

  if (preferredPath && await executableExists(preferredPath)) {
    const info = await getJavaVersion(preferredPath);
    if (info && isJavaCompatible(info, normalized)) {
      return { ...info, selected: true, reason: 'saved setting' };
    }
  }

  const installations = await scanJavaInstallations();
  const compatible = selectCompatibleJava(installations, normalized);
  if (compatible) return { ...compatible, selected: true, reason: `auto-detected Java ${compatible.major || compatible.version}` };
  return null;
}

function usesLaunchWrapper(versionMeta) {
  if (versionMeta?.mainClass === 'net.minecraft.launchwrapper.Launch') return true;
  return (versionMeta?.libraries || []).some((library) => /^net\.minecraft:launchwrapper:/i.test(library?.name || ''));
}

function recommendedJavaRequirement(versionMeta) {
  if (usesLaunchWrapper(versionMeta)) {
    return {
      minMajor: 8,
      maxMajor: 8,
      preferredMajor: 8,
      reason: 'Legacy Minecraft LaunchWrapper is incompatible with Java 9+ because the system class loader is no longer a URLClassLoader.',
      description: 'Java 8'
    };
  }

  const major = Number(versionMeta?.javaVersion?.majorVersion) || 8;
  return {
    minMajor: major,
    maxMajor: 0,
    preferredMajor: major,
    reason: versionMeta?.javaVersion?.component ? `Mojang runtime component: ${versionMeta.javaVersion.component}` : '',
    description: `Java ${major}+`
  };
}

function recommendedJavaMajor(versionMeta) {
  return recommendedJavaRequirement(versionMeta).minMajor;
}

function formatJavaRequirement(requirement = 17) {
  const normalized = normalizeJavaRequirement(requirement);
  return javaRequirementLabel(normalized.minMajor, normalized.maxMajor);
}

module.exports = {
  scanJavaInstallations,
  pickJava,
  getJavaVersion,
  recommendedJavaMajor,
  recommendedJavaRequirement,
  formatJavaRequirement,
  isJavaCompatible,
  selectCompatibleJava,
  normalizeJavaRequirement,
  usesLaunchWrapper,
  javaExecutableName
};
