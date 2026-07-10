const assert = require('node:assert/strict');
const { isAllowedByRules, osMatches } = require('../src/launcher/rules');
const { offlineUuid, validateUsername } = require('../src/launcher/accounts');
const { replacePlaceholders, legacySplitArguments } = require('../src/launcher/minecraft');

assert.equal(osMatches({ name: 'linux' }, { name: 'linux', arch: 'x64', version: '6.0' }), true);
assert.equal(osMatches({ name: 'windows' }, { name: 'linux', arch: 'x64', version: '6.0' }), false);

assert.equal(isAllowedByRules(undefined, { name: 'linux' }), true);
assert.equal(isAllowedByRules([{ action: 'allow', os: { name: 'linux' } }], { name: 'linux' }), true);
assert.equal(isAllowedByRules([{ action: 'allow', os: { name: 'windows' } }], { name: 'linux' }), false);
assert.equal(isAllowedByRules([
  { action: 'allow' },
  { action: 'disallow', os: { name: 'linux' } }
], { name: 'linux' }), false);

assert.equal(validateUsername('Steve_123'), 'Steve_123');
assert.throws(() => validateUsername('bad name'));
assert.equal(offlineUuid('Steve'), '5627dd98-e6be-3c21-b8a8-e92344183641');

assert.equal(replacePlaceholders('Hello ${name}', { name: 'Amethyst' }), 'Hello Amethyst');
assert.deepEqual(legacySplitArguments('--username ${auth_player_name} --demo "two words"'), ['--username', '${auth_player_name}', '--demo', 'two words']);

console.log('All tests passed.');
