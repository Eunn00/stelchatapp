const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createEventDeduper, eventDeliveryKey, reconnectDelay,
} = require('./event-delivery-policy.cjs');

test('deduplicates a repeated chat event by database id', () => {
  const duplicate = createEventDeduper();
  assert.equal(duplicate('chat', { id: 10 }), false);
  assert.equal(duplicate('chat', { id: 10, content: 'same record' }), true);
  assert.equal(duplicate('chat', { id: 11 }), false);
});

test('keeps distinct lifecycle updates for the same session', () => {
  const duplicate = createEventDeduper();
  const opened = { session_id: 5, status: 'OPEN', opened_at: '2026-10-10T10:00:00+09:00' };
  const closed = { ...opened, status: 'CLOSE', closed_at: '2026-10-10T11:00:00+09:00' };
  assert.equal(duplicate('session', opened), false);
  assert.equal(duplicate('session', opened), true);
  assert.equal(duplicate('session', closed), false);
});

test('allows a session to return to an earlier fingerprint after an intervening state', () => {
  const duplicate = createEventDeduper();
  const open = { session_id: 4, status: 'OPEN', opened_at: '2026-10-10T10:00:00+09:00' };
  const close = { ...open, status: 'CLOSE', closed_at: '2026-10-10T11:00:00+09:00' };
  assert.equal(duplicate('session', open), false);
  assert.equal(duplicate('session', open), true);
  assert.equal(duplicate('session', close), false);
  assert.equal(duplicate('session', open), false);
});

test('event dedupe memory is bounded', () => {
  const duplicate = createEventDeduper(2);
  duplicate('chat', { id: 1 });
  duplicate('chat', { id: 2 });
  duplicate('chat', { id: 3 });
  assert.equal(duplicate('chat', { id: 1 }), false);
});

test('unsupported events do not acquire a misleading key', () => {
  assert.equal(eventDeliveryKey('ready', {}), '');
});

test('reconnect delay backs off with bounded jitter and honors Retry-After', () => {
  assert.equal(reconnectDelay(0, 0, () => 0), 3000);
  assert.equal(reconnectDelay(2, 0, () => 0), 12000);
  assert.equal(reconnectDelay(20, 0, () => 1), 72000);
  assert.equal(reconnectDelay(0, 45000, () => 0), 45000);
});
