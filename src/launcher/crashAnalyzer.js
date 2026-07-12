/**
 * Crash analyzer for Minecraft crash reports.
 *
 * Parses raw crash report text, identifies common failure patterns,
 * and produces a human-friendly summary with actionable fix suggestions
 * and a link to open a GitHub issue.
 */

const GITHUB_ISSUES_URL = 'https://github.com/MinLOL12/Amethyst/issues/new';

// ── Pattern definitions ──────────────────────────────────────────────
// Each pattern has:
//   id           – unique identifier
//   match        – function(crashText, exitCode, signal) → truthy if this pattern applies
//   title        – short human-readable title
//   description  – longer explanation of what went wrong
//   fixes        – array of suggested fix steps (strings or { text, url })
//   severity     – 'critical' | 'error' | 'warning'

const patterns = [
  {
    id: 'out-of-memory',
    match: (text) =>
      text.includes('OutOfMemoryError') ||
      text.includes('out of memory') ||
      text.includes('Could not reserve enough space') ||
      text.includes('Failed to allocate') ||
      /java\.lang\.OutOfMemoryError/.test(text),
    title: 'Out of Memory',
    description:
      'Minecraft ran out of allocated RAM. The game needs more memory than the current allocation allows. This is one of the most common crashes, especially with large modpacks or high render distances.',
    fixes: [
      'Increase the RAM allocation in the launcher (try adding 1–2 GB).',
      'Close other applications (browsers, Discord, etc.) to free system RAM.',
      'Reduce in-game render distance and graphics settings.',
      'For heavily modded packs, 4–6 GB is recommended; 2 GB is often too little.'
    ],
    severity: 'error'
  },
  {
    id: 'java-version-mismatch',
    match: (text) =>
      text.includes('UnsupportedClassVersionError') ||
      text.includes('unsupported class version') ||
      text.includes('has been compiled by a more recent version') ||
      text.includes('Unsupported major.minor version') ||
      text.includes('class file version') ||
      (text.includes('Could not find or load main class') && /java\.(lang|util)/.test(text)),
    title: 'Java Version Mismatch',
    description:
      'The Java version you are using is either too old or too new for this version of Minecraft or one of its mods. Minecraft 1.17+ requires Java 16 or newer; Minecraft 1.20.5+ requires Java 21. Using the wrong Java version causes the game to fail at startup.',
    fixes: [
      'Minecraft 1.16.5 and older → use Java 8 or 11.',
      'Minecraft 1.17–1.20.4 → use Java 17.',
      'Minecraft 1.20.5+ → use Java 21.',
      'Use the Java Manager in Settings to download the correct version automatically.',
      'Make sure the Java path in Settings points to the correct installation.'
    ],
    severity: 'critical'
  },
  {
    id: 'mod-conflict',
    match: (text) =>
      text.includes('MixinApplyError') ||
      (text.includes('Mixin') && text.includes('failed')) ||
      text.includes('mixin apply failed') ||
      (text.includes('Unable to load') && /mods?/i.test(text)) ||
      text.includes('Duplicate mod') ||
      text.includes('mod resolution failed') ||
      text.includes('Incompatible mod') ||
      text.includes('ModResolutionException') ||
      text.includes('Found a duplicate mod') ||
      text.includes('Potential mod incompatibility') ||
      (text.includes('mixing') && text.includes('conflict')),
    title: 'Mod Conflict Detected',
    description:
      "Two or more mods are conflicting with each other. This usually happens when mods modify the same game code, when duplicate mods are installed, or when mods are incompatible with each other's versions.",
    fixes: [
      'Check the crash log below for the specific mod names involved.',
      'Remove duplicate mods from the mods/ folder.',
      'Update all mods to their latest compatible versions.',
      'Try removing the most recently added mod and launch again.',
      'Check mod compatibility charts and documentation on CurseForge or Modrinth.'
    ],
    severity: 'error'
  },
  {
    id: 'missing-mod-dependency',
    match: (text) =>
      (text.includes('requires') && /mod/i.test(text) && (text.includes('which is missing') || text.includes('not found') || text.includes('not present'))) ||
      text.includes('Missing or unsupported mandatory dependencies') ||
      (text.includes('Failed to load mod') && text.includes('dependency')) ||
      text.includes('ModDependencyException') ||
      text.includes('UnsatisfiedDependencyException') ||
      (text.includes('requires any version of') && text.includes('which is missing')),
    title: 'Missing Mod Dependency',
    description:
      'A mod you have installed requires another mod (a library or API) that is not present in your mods folder. This is a very common issue when manually installing mods without their required libraries.',
    fixes: [
      'Read the crash log below to find which mod is missing.',
      'Download the missing dependency from CurseForge or Modrinth.',
      'Common dependencies include Fabric API, Forge, Cloth Config, Architectury, etc.',
      'Some mods list their required dependencies on their download page.'
    ],
    severity: 'error'
  },
  {
    id: 'fabric-api-missing',
    match: (text) =>
      text.includes('fabric-api') ||
      (text.includes('Fabric API') && (text.includes('missing') || text.includes('not found') || text.includes('required'))) ||
      (text.includes('net.fabricmc.fabric-api') && text.includes('missing')),
    title: 'Fabric API Missing',
    description:
      'You are using Fabric loader but the Fabric API mod is not installed. Most Fabric mods depend on the Fabric API library to function. Without it, they will crash at startup.',
    fixes: [
      'Download Fabric API from Modrinth or CurseForge.',
      "Place the Fabric API .jar in your instance's mods/ folder.",
      'Make sure the Fabric API version matches your Minecraft version.'
    ],
    severity: 'error'
  },
  {
    id: 'shader-crash',
    match: (text) =>
      (text.includes('Shader') && (text.includes('error') || text.includes('failed') || text.includes('crash'))) ||
      (text.includes('ShaderProgram') && text.includes('invalid')) ||
      (text.includes('Iris') && text.includes('failed')) ||
      (text.includes('Oculus') && text.includes('failed')) ||
      (text.includes('glsl') && text.includes('error')),
    title: 'Shader Pack Error',
    description:
      'A shader pack (via Iris, Oculus, or similar) caused a rendering error. This often happens when a shader is incompatible with your Minecraft version, graphics driver, or another rendering mod.',
    fixes: [
      'Try disabling the shader pack and launching again.',
      'Update your graphics drivers to the latest version.',
      'Use a shader pack compatible with your Minecraft version.',
      'If using Iris, make sure it matches the Fabric version you have installed.',
      'Some shaders are not compatible with macOS or integrated GPUs.'
    ],
    severity: 'error'
  },
  {
    id: 'corrupted-world',
    match: (text) =>
      (text.includes('Corrupted') && text.includes('chunk')) ||
      text.includes('Exception reading chunk') ||
      text.includes('Corrupt region file') ||
      (text.includes('NBT') && text.includes('crash')) ||
      (text.includes('region file') && text.includes('corrupt')),
    title: 'Corrupted World Data',
    description:
      'Minecraft encountered corrupted data in one of your world saves. This can be caused by disk errors, crashes while saving, or force-closing the game.',
    fixes: [
      'Back up your saves folder before making changes.',
      'Try loading a different world to see if the crash is world-specific.',
      'Use a tool like MCA Selector or NBTExplorer to repair corrupted chunks.',
      'If the crash only happens in one world, restore from a backup if available.',
      'Run a disk check on your drive to rule out hardware issues.'
    ],
    severity: 'warning'
  },
  {
    id: 'native-library-error',
    match: (text) =>
      text.includes('UnsatisfiedLinkError') ||
      text.includes('no native library') ||
      text.includes('Cannot load native library') ||
      (text.includes('LWJGL') && text.includes('failed')),
    title: 'Native Library Error (LWJGL)',
    description:
      'The LWJGL native libraries that Minecraft uses for rendering, audio, and input could not be loaded. This typically happens on non-standard platforms or when native files are missing/corrupted.',
    fixes: [
      'Try a clean reinstall of the Minecraft version (delete the version folder and re-install).',
      'On Linux, ensure you have the required system libraries (libglfw, libopenal, etc.).',
      'On macOS, make sure you are using Java 17+ and the correct architecture (ARM vs x64).',
      'Check that antivirus software is not blocking native library extraction.'
    ],
    severity: 'error'
  },
  {
    id: 'forge-loading-error',
    match: (text) =>
      (text.includes('ForgeModLoader') && text.includes('failed')) ||
      (text.includes('fml') && text.includes('error')) ||
      (text.includes('Forge') && text.includes('failed to load')) ||
      (text.includes('net.minecraftforge') && text.includes('Exception')),
    title: 'Forge Loading Error',
    description:
      'Forge encountered an error while loading. This can be caused by incompatible mods, a broken Forge installation, or a mod targeting a different Forge version.',
    fixes: [
      'Verify that all your mods are compatible with the Forge version you installed.',
      'Try removing mods one at a time to isolate the problem.',
      'Re-install the correct Forge version for your Minecraft version.',
      'Check the crash log for the specific mod causing the issue.'
    ],
    severity: 'error'
  },
  {
    id: 'neoforge-loading-error',
    match: (text) =>
      (text.includes('NeoForge') && (text.includes('failed') || text.includes('error') || text.includes('Exception'))) ||
      (text.includes('net.neoforged') && text.includes('Exception')),
    title: 'NeoForge Loading Error',
    description:
      'NeoForge encountered an error while loading. Similar to Forge, this is usually caused by incompatible or outdated mods.',
    fixes: [
      'Verify that all your mods are compatible with the NeoForge version you installed.',
      'Try removing mods one at a time to isolate the problem.',
      'Re-install the correct NeoForge version for your Minecraft version.',
      'Check the crash log for the specific mod causing the issue.'
    ],
    severity: 'error'
  },
  {
    id: 'security-manager',
    match: (text) =>
      (text.includes('SecurityManager') && text.includes('deprecated')) ||
      (text.includes('java.security') && text.includes('not allowed')) ||
      (text.includes('Cannot create file') && text.includes('security')),
    title: 'Java Security Manager Error',
    description:
      'A Java security restriction is blocking Minecraft from running. This is common with Java 18+ which deprecated the Security Manager, or with restrictive system policies.',
    fixes: [
      "Use Java 17 for Minecraft versions that don't require Java 21.",
      'Check if your JVM arguments include security-related flags and remove them.',
      'If using a corporate or school computer, security policies may block the game.'
    ],
    severity: 'error'
  },
  {
    id: 'driver-graphics',
    match: (text) =>
      text.includes('GL_INVALID') ||
      (text.includes('OpenGL') && text.includes('error')) ||
      text.includes('graphics driver') ||
      (text.includes('GLFW') && text.includes('error')) ||
      text.includes('failed to create window'),
    title: 'Graphics Driver Error',
    description:
      'Minecraft encountered an error with your graphics driver or OpenGL. This can be caused by outdated drivers, incompatible hardware, or driver bugs.',
    fixes: [
      "Update your graphics drivers to the latest version from the manufacturer's website.",
      'Try launching with the "Software Renderer" or reducing graphics settings.',
      "On Windows, make sure you are using the manufacturer's driver (NVIDIA/AMD) not the generic Microsoft driver.",
      'On Linux, try switching between Mesa and proprietary drivers.',
      'If you have an integrated GPU, ensure enough RAM is allocated in BIOS/UEFI settings.'
    ],
    severity: 'error'
  },
  {
    id: 'disk-space',
    match: (text) =>
      text.includes('No space left on device') ||
      text.includes('ENOSPC') ||
      text.includes('not enough space') ||
      text.includes('disk full'),
    title: 'Disk Space Exhausted',
    description:
      'Your storage device is full or nearly full. Minecraft cannot write save data, logs, or temporary files without available disk space.',
    fixes: [
      'Free up space on the drive where Minecraft is installed.',
      'Move large files (videos, other games) to another drive.',
      "Use Amethyst's \"Free up space\" feature in the download error dialog.",
      'Consider moving the game directory to a drive with more space (Settings → Data directory).'
    ],
    severity: 'critical'
  },
  {
    id: 'access-denied',
    match: (text) =>
      text.includes('AccessDeniedException') ||
      text.includes('Permission denied') ||
      (text.includes('access denied') && text.includes('file')),
    title: 'File Access Denied',
    description:
      'Minecraft does not have permission to read or write a file. This can happen when files are owned by a different user, are marked read-only, or are locked by another program.',
    fixes: [
      'Make sure no other program (including another Minecraft instance) is using the same game directory.',
      'On Windows, try running Amethyst as administrator once to fix permissions.',
      'On macOS/Linux, check file ownership: the user running Amethyst must own the game directory.',
      'Antivirus software may be blocking file access — add an exception for the game directory.'
    ],
    severity: 'error'
  }
];

// ── Core analysis logic ──────────────────────────────────────────────

/**
 * Analyze a crash report and return a structured, human-friendly result.
 *
 * @param {object} options
 * @param {string} options.crashText   – raw crash report content
 * @param {number|null} options.exitCode – process exit code
 * @param {string|null} options.signal  – termination signal
 * @param {string} options.gameDir     – game directory path
 * @param {string} options.versionId   – Minecraft version ID
 * @returns {object} analysis result
 */
function analyzeCrash({ crashText = '', exitCode = null, signal = null, gameDir = '', versionId = '' }) {
  const text = String(crashText || '');
  const matched = [];

  // Run all pattern matchers
  for (const pattern of patterns) {
    try {
      if (pattern.match(text, exitCode, signal)) {
        matched.push({
          id: pattern.id,
          title: pattern.title,
          description: pattern.description,
          fixes: pattern.fixes,
          severity: pattern.severity
        });
      }
    } catch (_) {
      // Pattern matcher errors should never break analysis
    }
  }

  // Extract the exception/error section from the crash report
  const exceptionSection = extractException(text);
  const stackSummary = extractStackSummary(text);
  const modList = extractModList(text);

  // Determine overall severity
  const severity = matched.length
    ? (matched.some((m) => m.severity === 'critical') ? 'critical'
      : matched.some((m) => m.severity === 'error') ? 'error'
        : 'warning')
    : 'unknown';

  // Build the human-friendly summary
  const summary = buildSummary(matched, exitCode, signal, exceptionSection);

  return {
    crashed: true,
    exitCode,
    signal,
    versionId,
    gameDir,
    severity,
    matchedPatterns: matched,
    summary,
    exceptionSection,
    stackSummary,
    modList,
    githubIssueUrl: buildGitHubIssueUrl(matched, exitCode, signal, versionId, exceptionSection),
    fixSuggestions: matched.length
      ? matched.flatMap((m) => m.fixes)
      : genericFixes(exitCode, signal)
  };
}

/**
 * Analyze a crash when we only have the exit code / signal (no crash report file).
 */
function analyzeExitOnly({ exitCode = null, signal = null, versionId = '', gameDir = '' }) {
  const severity = (exitCode !== 0 && exitCode !== null) || signal ? 'error' : 'unknown';
  const summary = signal
    ? `Minecraft was terminated by signal ${signal}. This usually means the process was killed externally (out-of-memory killer, user, or task manager) or crashed due to a severe system-level error.`
    : exitCode === 1
      ? 'Minecraft exited with error code 1. This is a general Java error — the game may have hit an uncaught exception during startup or runtime. Check the crash report below for details.'
      : exitCode !== null && exitCode !== 0
        ? `Minecraft exited with error code ${exitCode}. This indicates an unexpected failure. A crash report may have been generated in the crash-reports folder.`
        : 'Minecraft exited unexpectedly. No specific error code was reported.';

  return {
    crashed: true,
    exitCode,
    signal,
    versionId,
    gameDir,
    severity,
    matchedPatterns: [],
    summary,
    exceptionSection: '',
    stackSummary: '',
    modList: [],
    githubIssueUrl: buildGitHubIssueUrl([], exitCode, signal, versionId, ''),
    fixSuggestions: genericFixes(exitCode, signal)
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function extractException(text) {
  if (!text) return '';
  const sections = [];

  // Try to find the main exception block
  const exceptionMatch = text.match(/(?:Exception|Error|Description)[\s\S]*?(?=\n\n[A-Z]|\n--- END|$)/i);
  if (exceptionMatch) {
    sections.push(exceptionMatch[0].trim());
  }

  // Also look for "Caused by" lines
  const causedByLines = text.match(/Caused by:.*$/gm);
  if (causedByLines) {
    sections.push(causedByLines.slice(0, 5).join('\n'));
  }

  // Look for "java.lang.*Error" or "java.lang.*Exception" lines
  if (!sections.length) {
    const javaException = text.match(/java\.(?:lang|util|io|net)\.\w+(?:Error|Exception)[^\n]*/g);
    if (javaException) {
      sections.push(javaException.slice(0, 5).join('\n'));
    }
  }

  return sections.join('\n\n').slice(0, 4000);
}

function extractStackSummary(text) {
  if (!text) return '';
  const stackLines = text.match(/^\s+at [\w.$]+\([^)]*\)$/gm);
  if (!stackLines) return '';
  return stackLines.slice(0, 10).join('\n');
}

function extractModList(text) {
  if (!text) return [];
  const mods = [];

  const modMatches = text.matchAll(/\b([\w-]+)\s*\(([\w.-]+\.jar)\)/g);
  for (const match of modMatches) {
    mods.push({ name: match[1], file: match[2] });
  }

  const fabricMods = text.matchAll(/^\s+-\s+([\w-]+)\s+([\d.]+)/gm);
  for (const match of fabricMods) {
    if (!mods.some((m) => m.name === match[1])) {
      mods.push({ name: match[1], version: match[2] });
    }
  }

  return mods.slice(0, 50);
}

function buildSummary(matched, exitCode, signal, exceptionSection) {
  if (matched.length) {
    const titles = matched.map((m) => m.title);
    const primary = titles[0];
    const additional = titles.length > 1
      ? ` Additional issues detected: ${titles.slice(1).join(', ')}.`
      : '';
    return `The game crashed due to: ${primary}.${additional} See the fix suggestions below to resolve this issue.`;
  }

  if (signal) {
    return `Minecraft was terminated by signal ${signal}. This usually means the process was killed externally or crashed due to a system-level error like running out of memory.`;
  }

  if (exitCode === 1) {
    return 'Minecraft exited with error code 1. This is a general Java error. A crash report may have been generated with more details.';
  }

  if (exitCode !== null && exitCode !== 0) {
    return `Minecraft exited unexpectedly with code ${exitCode}. A crash report may have been generated in the crash-reports folder.`;
  }

  return 'Minecraft exited unexpectedly. No specific error code was reported. Check the crash report below for details.';
}

function genericFixes(exitCode, signal) {
  const fixes = [
    'Check the crash report section below for the specific error message.',
    'Try allocating more RAM in the launcher settings.',
    'Make sure you are using the correct Java version for your Minecraft version.',
    'If you have mods installed, try removing them and launching vanilla first.'
  ];

  if (signal === 'SIGKILL' || signal === 'SIGTERM') {
    fixes.unshift('The process was killed — this often happens when the system runs out of memory. Close other applications and try again.');
  }

  if (exitCode === 1) {
    fixes.unshift('Error code 1 often means Java could not start. Verify your Java installation and path.');
  }

  fixes.push({
    text: 'Open a GitHub issue for help',
    url: GITHUB_ISSUES_URL
  });

  return fixes;
}

function buildGitHubIssueUrl(matched, exitCode, signal, versionId, exceptionSection) {
  const title = matched.length
    ? `[Crash] ${matched.map((m) => m.title).join(' + ')} — Minecraft ${versionId}`
    : `[Crash] Unexpected exit (code ${exitCode ?? 'unknown'}) — Minecraft ${versionId}`;

  let body = '## Crash Report\n\n';
  body += `- **Minecraft version:** ${versionId || 'unknown'}\n`;
  body += `- **Exit code:** ${exitCode ?? 'unknown'}\n`;
  body += `- **Signal:** ${signal || 'none'}\n`;

  if (matched.length) {
    body += '\n### Detected Issues\n\n';
    for (const m of matched) {
      body += `- **${m.title}** (${m.severity}): ${m.description}\n`;
    }
  }

  if (exceptionSection) {
    body += '\n### Exception\n\n```\n' + exceptionSection.slice(0, 2000) + '\n```\n';
  }

  body += '\n### Steps to Reproduce\n\n1. \n2. \n3. \n';
  body += '\n---\n*This issue was auto-generated by the Amethyst crash reporter.*';

  const params = new URLSearchParams({
    title: title.slice(0, 256),
    body: body.slice(0, 6000)
  });

  return `${GITHUB_ISSUES_URL}?${params.toString()}`;
}

/**
 * Find the most recent crash report file in the crash-reports directory.
 * Returns the file path or null.
 */
async function findLatestCrashReport(gameDir) {
  const fs = require('node:fs/promises');
  const path = require('node:path');

  const crashDir = path.join(gameDir, 'crash-reports');
  try {
    const files = await fs.readdir(crashDir);
    const txtFiles = files
      .filter((f) => f.endsWith('.txt'))
      .sort()
      .reverse();

    if (!txtFiles.length) return null;

    const latest = path.join(crashDir, txtFiles[0]);

    // Verify the file was modified very recently (within the last 60 seconds)
    // to avoid picking up old crash reports
    const stat = await fs.stat(latest);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs > 60000) return null;

    return latest;
  } catch (_) {
    return null;
  }
}

/**
 * Read a crash report file and return its contents.
 */
async function readLatestCrashReport(filePath) {
  const fs = require('node:fs/promises');
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return content.slice(0, 50000); // Limit to 50KB
  } catch (_) {
    return '';
  }
}

module.exports = {
  analyzeCrash,
  analyzeExitOnly,
  findLatestCrashReport,
  readLatestCrashReport,
  GITHUB_ISSUES_URL
};
