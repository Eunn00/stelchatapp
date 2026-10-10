const test = require('node:test');
const assert = require('node:assert/strict');
const {
  compareMessageOrder, mergeMemberSessionItem, mergeMemberSessionSnapshot, mergePreviewMessages,
  mergeRecentSnapshot, mergeStreamerSnapshot,
} = require('./realtime-merge-policy.js');

const chat = (id, sessionId, targetUid, sentAt, content) => ({
  id, session_id: sessionId, target_uid: targetUid, sent_at: sentAt, content,
});

test('an in-flight snapshot cannot remove a newer SSE chat', () => {
  const snapshot = [chat(10, 1, 'a', '2026-10-10T10:00:00+09:00', 'old')];
  const current = [chat(11, 1, 'a', '2026-10-10T10:01:00+09:00', 'live')];
  const merged = mergeRecentSnapshot(snapshot, current, new Set(['1:a']));
  assert.deepEqual(merged.map((item) => item.id), [11]);
});

test('only realtime-mutated rooms override the snapshot', () => {
  const snapshot = [
    chat(21, 2, 'b', '2026-10-10T10:02:00+09:00', 'new snapshot'),
    chat(10, 1, 'a', '2026-10-10T10:00:00+09:00', 'old'),
  ];
  const current = [
    chat(11, 1, 'a', '2026-10-10T10:01:00+09:00', 'live'),
    chat(20, 2, 'b', '2026-10-10T09:59:00+09:00', 'stale current'),
  ];
  const merged = mergeRecentSnapshot(snapshot, current, new Set(['1:a']));
  assert.deepEqual(merged.map((item) => item.id), [21, 11]);
});

test('a realtime live-state transition survives an older streamer snapshot', () => {
  const snapshot = [{ uid: 'a', is_live: false }, { uid: 'b', is_live: false }];
  const current = [{ uid: 'a', is_live: true }, { uid: 'b', is_live: false }];
  assert.deepEqual(
    mergeStreamerSnapshot(snapshot, current, new Set(['a'])),
    [{ uid: 'a', is_live: true }, { uid: 'b', is_live: false }],
  );
});

test('a member-session refresh preserves a chat received while it was in flight', () => {
  const snapshot = [{ id: 1, last_chat_at: '2026-10-10T10:00:00+09:00', latest: 'old' }];
  const current = [
    { id: 2, last_chat_at: '2026-10-10T10:02:00+09:00', latest: 'new room' },
    { id: 1, last_chat_at: '2026-10-10T10:01:00+09:00', latest: 'realtime' },
  ];
  const merged = mergeMemberSessionSnapshot(snapshot, current, new Set([1, 2]));
  assert.deepEqual(merged.map((item) => [item.id, item.latest]), [[2, 'new room'], [1, 'realtime']]);
});

test('member-session merge keeps snapshot history and realtime latest fields', () => {
  const merged = mergeMemberSessionItem(
    {
      id: 1, message_count: 50, latest_id: 100, latest_message_id: 100,
      last_chat_at: '2026-10-10T10:00:00+09:00', latest: 'snapshot', status: 'CLOSE',
    },
    {
      id: 1, message_count: 1, latest_id: 101, latest_message_id: 101,
      last_chat_at: '2026-10-10T10:01:00+09:00', latest: 'realtime', status: 'OPEN',
    },
  );
  assert.equal(merged.message_count, 50);
  assert.equal(merged.latest_id, 101);
  assert.equal(merged.latest, 'realtime');
  assert.equal(merged.status, 'OPEN');
});

test('preview fetch results merge with realtime messages without duplicates', () => {
  const snapshot = [
    chat(1, 1, 'a', '2026-10-10T10:00:00+09:00', 'one'),
    chat(2, 1, 'a', '2026-10-10T10:01:00+09:00', 'old two'),
  ];
  const realtime = [
    chat(2, 1, 'a', '2026-10-10T10:01:00+09:00', 'new two'),
    chat(3, 1, 'a', '2026-10-10T10:02:00+09:00', 'three'),
  ];
  const merged = mergePreviewMessages(snapshot, realtime);
  assert.deepEqual(merged.map((item) => [item.id, item.content]), [
    [1, 'one'], [2, 'new two'], [3, 'three'],
  ]);
});

test('message order uses timestamp and then numeric id', () => {
  assert.ok(compareMessageOrder(
    chat(11, 1, 'a', '2026-10-10T10:01:00+09:00', 'new'),
    chat(99, 1, 'a', '2026-10-10T10:00:00+09:00', 'old'),
  ) > 0);
  assert.ok(compareMessageOrder(
    chat(10, 1, 'a', '2026-10-10T10:00:00+09:00', 'ten'),
    chat(2, 1, 'a', '2026-10-10T10:00:00+09:00', 'two'),
  ) > 0);
});
