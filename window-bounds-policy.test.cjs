const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizedWindowBounds } = require('./window-bounds-policy.cjs');

const displays = [{ x: 0, y: 0, width: 1920, height: 1040 }];

test('keeps valid saved window bounds', () => {
  assert.deepEqual(
    normalizedWindowBounds({ x: 50, y: 60, width: 410, height: 690 }, displays),
    { x: 50, y: 60, width: 410, height: 690 },
  );
});

test('discards malformed or fully off-screen saved bounds', () => {
  assert.deepEqual(normalizedWindowBounds({ x: 10, y: 10, width: '410', height: 690 }, displays), {});
  assert.deepEqual(normalizedWindowBounds({ x: 3000, y: 2000, width: 410, height: 690 }, displays), {});
});

test('clamps corrupt window sizes to usable display limits', () => {
  assert.deepEqual(
    normalizedWindowBounds({ x: 0, y: 0, width: 100000, height: 1 }, displays),
    { x: 0, y: 0, width: 1920, height: 520 },
  );
});

test('accepts a window visible on a secondary display', () => {
  assert.deepEqual(
    normalizedWindowBounds(
      { x: -1200, y: 100, width: 410, height: 690 },
      [...displays, { x: -1280, y: 0, width: 1280, height: 1024 }],
    ),
    { x: -1200, y: 100, width: 410, height: 690 },
  );
});

test('moves a partially visible window down so its title bar remains draggable', () => {
  assert.deepEqual(
    normalizedWindowBounds({ x: -330, y: -610, width: 410, height: 690 }, displays),
    { x: -330, y: 0, width: 410, height: 690 },
  );
});
