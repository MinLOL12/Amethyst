const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.equal(pkg.main, 'src/electron.js', 'the packaged application must start Electron');
assert.match(pkg.scripts['build:win'], /electron-builder --win/);
assert.deepEqual(pkg.build.win.target.map(t => t.target), ['nsis', 'portable']);
assert.ok(pkg.build.win.target.every(t => t.arch.includes('x64') && t.arch.includes('arm64')),
  'Windows builds must target both x64 and arm64 for Windows 11 compatibility');
assert.equal(pkg.build.nsis.include, null, 'the default build/installer.nsh include must stay disabled for CI packaging');
assert.equal(pkg.build.nsis.license, 'license.txt', 'the NSIS license file must use a plain .txt resource for workflow builds');
assert.ok(pkg.build.files.includes('public/**/*'), 'renderer assets must be packaged');
assert.ok(pkg.build.files.includes('build/**/*'), 'application icons must be packaged');

for (const file of ['src/electron.js', 'src/preload.js', 'public/index.html', 'build/icon.ico', 'build/license.txt']) {
  assert.ok(fs.existsSync(path.join(root, file)), `packaged entry is missing: ${file}`);
}

console.log('electron packaging tests passed');
