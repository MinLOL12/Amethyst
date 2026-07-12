/**
 * Crash analyzer tests.
 */
const { analyzeCrash, analyzeExitOnly, GITHUB_ISSUES_URL } = require('../src/launcher/crashAnalyzer');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  ❌ ${message}`);
  }
}

// Test 1: Out of memory detection
const oomResult = analyzeCrash({
  crashText: 'java.lang.OutOfMemoryError: Java heap space\n\tat net.minecraft.client.Minecraft.run(Minecraft.java:400)',
  exitCode: 1,
  signal: null,
  gameDir: '/test',
  versionId: '1.20.4'
});
assert(oomResult.crashed === true, 'OOM crash should be detected as crashed');
assert(oomResult.severity === 'error', 'OOM severity should be error');
assert(oomResult.matchedPatterns.length === 1, 'Should match exactly 1 pattern for OOM');
assert(oomResult.matchedPatterns[0].id === 'out-of-memory', 'Should match out-of-memory pattern');
assert(oomResult.matchedPatterns[0].title === 'Out of Memory', 'Title should be Out of Memory');
assert(oomResult.fixSuggestions.length >= 4, 'OOM should have at least 4 fix suggestions');
assert(oomResult.summary.includes('Out of Memory'), 'Summary should mention Out of Memory');
assert(oomResult.githubIssueUrl.includes('github.com'), 'Should include GitHub URL');
console.log('  ✅ Out of memory detection');

// Test 2: Java version mismatch
const javaResult = analyzeCrash({
  crashText: 'java.lang.UnsupportedClassVersionError: net/minecraft/client/Minecraft has been compiled by a more recent version of the Java Runtime',
  exitCode: 1,
  signal: null,
  gameDir: '/test',
  versionId: '1.20.4'
});
assert(javaResult.matchedPatterns[0].id === 'java-version-mismatch', 'Should detect Java version mismatch');
assert(javaResult.severity === 'critical', 'Java mismatch should be critical');
console.log('  ✅ Java version mismatch detection');

// Test 3: Mod conflict
const modResult = analyzeCrash({
  crashText: 'org.spongepowered.asm.mixin.transformer.MixinApplyError: Mixin modcompatibility failed',
  exitCode: -1,
  signal: null,
  gameDir: '/test',
  versionId: '1.20.4'
});
assert(modResult.matchedPatterns.some((p) => p.id === 'mod-conflict'), 'Should detect mod conflict');
console.log('  ✅ Mod conflict detection');

// Test 4: Multiple patterns at once
const multiResult = analyzeCrash({
  crashText: 'java.lang.OutOfMemoryError: Java heap space\nNo space left on device',
  exitCode: 137,
  signal: 'SIGKILL',
  gameDir: '/test',
  versionId: '1.20.4'
});
assert(multiResult.matchedPatterns.length >= 2, 'Should match multiple patterns');
assert(multiResult.matchedPatterns.some((p) => p.id === 'out-of-memory'), 'Should detect OOM');
assert(multiResult.matchedPatterns.some((p) => p.id === 'disk-space'), 'Should detect disk space');
assert(multiResult.severity === 'critical', 'Multiple with critical should be critical');
console.log('  ✅ Multiple pattern detection');

// Test 5: Exit-only analysis (no crash report)
const exitOnlyResult = analyzeExitOnly({
  exitCode: 1,
  signal: null,
  versionId: '1.20.4',
  gameDir: '/test'
});
assert(exitOnlyResult.crashed === true, 'Exit-only should be marked as crashed');
assert(exitOnlyResult.matchedPatterns.length === 0, 'Exit-only should have no matched patterns');
assert(exitOnlyResult.summary.includes('error code 1'), 'Summary should mention exit code');
assert(exitOnlyResult.fixSuggestions.length >= 3, 'Should have generic fix suggestions');
console.log('  ✅ Exit-only analysis');

// Test 6: Signal-based analysis
const signalResult = analyzeExitOnly({
  exitCode: null,
  signal: 'SIGKILL',
  versionId: '1.20.4',
  gameDir: '/test'
});
assert(signalResult.summary.includes('SIGKILL'), 'Should mention signal in summary');
assert(signalResult.fixSuggestions.some((f) => typeof f === 'string' && f.includes('killed')), 'Should suggest process was killed');
console.log('  ✅ Signal-based analysis');

// Test 7: Normal exit (code 0) with analyzeExitOnly
const normalResult = analyzeExitOnly({
  exitCode: 0,
  signal: null,
  versionId: '1.20.4',
  gameDir: '/test'
});
assert(normalResult.severity === 'unknown', 'Code 0 should be unknown severity');
console.log('  ✅ Normal exit handling');

// Test 8: Fabric API missing
const fabricResult = analyzeCrash({
  crashText: 'Fabric API is missing! net.fabricmc.fabric-api is required but not found.',
  exitCode: 1,
  signal: null,
  gameDir: '/test',
  versionId: '1.20.4'
});
assert(fabricResult.matchedPatterns.some((p) => p.id === 'fabric-api-missing'), 'Should detect missing Fabric API');
console.log('  ✅ Fabric API missing detection');

// Test 9: LWJGL native library error
const lwjglResult = analyzeCrash({
  crashText: 'java.lang.UnsatisfiedLinkError: no lwjgl in java.library.path\nLWJGL failed to load native library',
  exitCode: 1,
  signal: null,
  gameDir: '/test',
  versionId: '1.20.4'
});
assert(lwjglResult.matchedPatterns.some((p) => p.id === 'native-library-error'), 'Should detect LWJGL error');
console.log('  ✅ LWJGL native library error detection');

// Test 10: GitHub issue URL generation
assert(oomResult.githubIssueUrl.startsWith(GITHUB_ISSUES_URL), 'Should start with GitHub issues URL');
assert(oomResult.githubIssueUrl.includes('title='), 'Should include title param');
assert(oomResult.githubIssueUrl.includes('body='), 'Should include body param');
console.log('  ✅ GitHub issue URL generation');

// Test 11: Exception extraction
const exceptionResult = analyzeCrash({
  crashText: '---- Minecraft Crash Report ----\nDescription: Ticking entity\n\njava.lang.NullPointerException: Cannot invoke method\n\tat net.minecraft.entity.Entity.tick(Entity.java:120)\n\tat net.minecraft.server.MinecraftServer.tick(MinecraftServer.java:800)\nCaused by: java.lang.IllegalArgumentException: Invalid position',
  exitCode: -1,
  signal: null,
  gameDir: '/test',
  versionId: '1.20.4'
});
assert(exceptionResult.exceptionSection.length > 0, 'Should extract exception section');
assert(exceptionResult.stackSummary.length > 0, 'Should extract stack summary');
console.log('  ✅ Exception extraction');

// Test 12: No crash text, empty
const emptyResult = analyzeCrash({
  crashText: '',
  exitCode: 1,
  signal: null,
  gameDir: '/test',
  versionId: '1.20.4'
});
assert(emptyResult.matchedPatterns.length === 0, 'Empty text should match no patterns');
assert(emptyResult.fixSuggestions.length >= 3, 'Should have generic fix suggestions for empty text');
console.log('  ✅ Empty crash text handling');

// Summary
console.log(`\nCrash analyzer tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
