const test = require('node:test');
const assert = require('node:assert/strict');
const { isNewerVersion, normalizedVersion } = require('./update-policy.cjs');

test('detects a newer semantic version', () => {
  assert.equal(isNewerVersion('v0.1.11', '0.1.10'), true);
  assert.equal(isNewerVersion('0.2.0', '0.1.10'), true);
  assert.equal(isNewerVersion('1.0.0', '0.9.99'), true);
});

test('does not flag the installed or an older version', () => {
  assert.equal(isNewerVersion('v0.1.10', '0.1.10'), false);
  assert.equal(isNewerVersion('0.1.9', '0.1.10'), false);
  assert.equal(isNewerVersion('not-a-version', '0.1.10'), false);
});

test('normalizes release tags for display', () => {
  assert.equal(normalizedVersion('v0.1.11'), '0.1.11');
  assert.equal(normalizedVersion('invalid'), null);
});
