const test = require('node:test');
const assert = require('node:assert/strict');
const { createExternalOpenGuard } = require('./external-link-policy.cjs');

test('blocks repeated requests for the same URL inside the cooldown', () => {
  let current = 1000;
  const shouldOpen = createExternalOpenGuard({ now: () => current });
  assert.equal(shouldOpen('https://chzzk.naver.com/live/a'), true);
  assert.equal(shouldOpen('https://chzzk.naver.com/live/a'), false);
  current += 999;
  assert.equal(shouldOpen('https://chzzk.naver.com/live/a'), false);
  current += 1;
  assert.equal(shouldOpen('https://chzzk.naver.com/live/a'), true);
});

test('does not block a different URL', () => {
  const shouldOpen = createExternalOpenGuard({ now: () => 1000 });
  assert.equal(shouldOpen('https://chzzk.naver.com/live/a'), true);
  assert.equal(shouldOpen('https://chzzk.naver.com/live/b'), true);
});
