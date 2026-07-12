const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.equal(pkg.main, 'src/electron.js', 'the packaged application must start Electron');
assert.match(pkg.scripts['build:win'], /electron-builder --win/);
assert.deepEqual(pkg.build.win.target.map(target => target.target), ['nsis', 'portable']);
assert.equal(pkg.build.nsis.include, null, 'the default build/installer.nsh include must stay disabled for CI packaging');
assert.ok(pkg.build.files.includes('public/**/*'), 'renderer assets must be packaged');
assert.ok(pkg.build.files.includes('build/**/*'), 'application icons must be packaged');

for (const file of ['src/electron.js', 'src/preload.js', 'public/index.html', 'build/icon.ico']) {
  assert.ok(fs.existsSync(path.join(root, file)), `packaged entry is missing: ${file}`);
}

console.log('electron packaging tests passed');
