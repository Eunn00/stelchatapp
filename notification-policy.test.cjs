const assert = require('node:assert/strict');
const test = require('node:test');
const {
  chatRoomIsMuted, chatRoomKey, liveSessionKey, notificationEventType,
} = require('./notification-policy.cjs');

const existingLive = new Set([liveSessionKey('member-a', '2026-10-07T10:00:00+09:00', 1)]);

test('notifications remain silent until the initial snapshot is ready', () => {
  assert.equal(notificationEventType('chat', {}, false, existingLive), 'chat');
  assert.equal(notificationEventType('session', { status: 'OPEN' }, false, existingLive), null);
});

test('metadata updates for an already open session do not notify', () => {
  assert.equal(notificationEventType('session', {
    channel_id: 'member-a', session_id: 1, status: 'OPEN', previous_status: 'OPEN',
    opened_at: '2026-10-07T10:00:00+09:00',
  }, true, existingLive), null);
});

test('a session already live at app startup does not notify', () => {
  assert.equal(notificationEventType('session', {
    channel_id: 'member-a', session_id: 1, status: 'OPEN', previous_status: null,
    opened_at: '2026-10-07T10:00:00+09:00',
  }, true, existingLive), null);
});

test('a real transition to a new live session notifies', () => {
  assert.equal(notificationEventType('session', {
    channel_id: 'member-a', session_id: 2, status: 'OPEN', previous_status: 'CLOSE',
    opened_at: '2026-10-07T15:00:00+09:00',
  }, true, existingLive), 'live');
});

test('same-second replacement session is not mistaken for the startup session', () => {
  assert.equal(notificationEventType('session', {
    channel_id: 'member-a', session_id: 2, status: 'OPEN', previous_status: 'CLOSE',
    opened_at: '2026-10-07T10:00:00+09:00',
  }, true, existingLive), 'live');
});

test('a superseded session never creates a live notification', () => {
  assert.equal(notificationEventType('session', {
    channel_id: 'member-a', session_id: 2, status: 'OPEN', previous_status: 'CLOSE', superseded: true,
    opened_at: '2026-10-07T15:00:00+09:00',
  }, true, existingLive), null);
});

test('new chat events notify after the baseline is ready', () => {
  assert.equal(notificationEventType('chat', {}, true, existingLive), 'chat');
});

test('chat room keys separate sessions and members', () => {
  assert.equal(chatRoomKey(42, 'member-a'), '42:member-a');
  assert.notEqual(chatRoomKey(42, 'member-a'), chatRoomKey(43, 'member-a'));
  assert.notEqual(chatRoomKey(42, 'member-a'), chatRoomKey(42, 'member-b'));
  assert.equal(chatRoomKey('invalid', 'member-a'), '');
});

test('only the selected chat room is muted', () => {
  const muted = { [chatRoomKey(42, 'member-a')]: 1 };
  assert.equal(chatRoomIsMuted({ session_id: 42, target_uid: 'member-a' }, muted), true);
  assert.equal(chatRoomIsMuted({ session_id: 43, target_uid: 'member-a' }, muted), false);
  assert.equal(chatRoomIsMuted({ session_id: 42, target_uid: 'member-b' }, muted), false);
});
