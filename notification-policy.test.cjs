const assert = require('node:assert/strict');
const test = require('node:test');
const { liveSessionKey, notificationEventType } = require('./notification-policy.cjs');

const existingLive = new Set([liveSessionKey('member-a', '2026-10-07T10:00:00+09:00')]);

test('notifications remain silent until the initial snapshot is ready', () => {
  assert.equal(notificationEventType('chat', {}, false, existingLive), null);
  assert.equal(notificationEventType('session', { status: 'OPEN' }, false, existingLive), null);
});

test('metadata updates for an already open session do not notify', () => {
  assert.equal(notificationEventType('session', {
    channel_id: 'member-a', status: 'OPEN', previous_status: 'OPEN',
    opened_at: '2026-10-07T10:00:00+09:00',
  }, true, existingLive), null);
});

test('a session already live at app startup does not notify', () => {
  assert.equal(notificationEventType('session', {
    channel_id: 'member-a', status: 'OPEN', previous_status: null,
    opened_at: '2026-10-07T10:00:00+09:00',
  }, true, existingLive), null);
});

test('a real transition to a new live session notifies', () => {
  assert.equal(notificationEventType('session', {
    channel_id: 'member-a', status: 'OPEN', previous_status: 'CLOSE',
    opened_at: '2026-10-07T15:00:00+09:00',
  }, true, existingLive), 'live');
});

test('new chat events notify after the baseline is ready', () => {
  assert.equal(notificationEventType('chat', {}, true, existingLive), 'chat');
});
