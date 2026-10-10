const test = require('node:test');
const assert = require('node:assert/strict');
const {
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
