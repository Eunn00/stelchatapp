const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applySessionEventToStreamer, memberPreviewKey, reconcileRecentReadState,
  retainSessionWatermark, sessionEventUpdatesStreamer,
} = require('./renderer-state-policy.js');

const chat = (id, sessionId, targetUid) => ({ id, session_id: sessionId, target_uid: targetUid });

test('the first snapshot establishes a baseline without marking old chats unread', () => {
  const result = reconcileRecentReadState(
    [chat(1, 10, 'member-a'), chat(2, 20, 'member-b')], new Map(), new Set(),
  );
  assert.equal(result.baselineReady, true);
  assert.deepEqual([...result.unreadKeys], []);
});

test('a realtime event before the first snapshot does not establish a partial baseline', () => {
  const realtime = reconcileRecentReadState(
    [chat(20, 20, 'member-b')], new Map(), new Set(), { establishBaseline: false },
  );
  assert.equal(realtime.baselineReady, false);
  const snapshot = reconcileRecentReadState(
    [chat(20, 20, 'member-b'), chat(10, 10, 'member-a')],
    realtime.knownIds,
    realtime.unreadKeys,
    { baselineReady: realtime.baselineReady },
  );
  assert.equal(snapshot.baselineReady, true);
  assert.deepEqual([...snapshot.unreadKeys], []);
});

test('a realtime chat before the first snapshot stays unread without baselining old rooms', () => {
  const realtime = reconcileRecentReadState(
    [chat(20, 20, 'member-b')], new Map(), new Set(), {
      establishBaseline: false, markBeforeBaseline: true,
    },
  );
  assert.equal(realtime.baselineReady, false);
  assert.deepEqual([...realtime.unreadKeys], ['20:member-b']);
  const snapshot = reconcileRecentReadState(
    [chat(20, 20, 'member-b'), chat(10, 10, 'member-a')],
    realtime.knownIds,
    realtime.unreadKeys,
    { baselineReady: realtime.baselineReady },
  );
  assert.equal(snapshot.baselineReady, true);
  assert.deepEqual([...snapshot.unreadKeys], ['20:member-b']);
});

test('a new room discovered after the baseline is marked unread', () => {
  const result = reconcileRecentReadState(
    [chat(2, 20, 'member-b')],
    new Map([['10:member-a', '1']]),
    new Set(),
    { baselineReady: true },
  );
  assert.deepEqual([...result.unreadKeys], ['20:member-b']);
});

test('a changed room is unread unless the user is actively reading it', () => {
  const known = new Map([['10:member-a', '1']]);
  const unread = reconcileRecentReadState(
    [chat(2, 10, 'member-a')], known, new Set(), { baselineReady: true },
  );
  const reading = reconcileRecentReadState(
    [chat(2, 10, 'member-a')], known, new Set(), {
      baselineReady: true, isBeingRead: (key) => key === '10:member-a',
    },
  );
  assert.deepEqual([...unread.unreadKeys], ['10:member-a']);
  assert.deepEqual([...reading.unreadKeys], []);
});

test('known-room storage stays bounded and removes matching stale unread state', () => {
  const result = reconcileRecentReadState(
    [chat(3, 30, 'member-c')],
    new Map([['10:member-a', '1'], ['20:member-b', '2']]),
    new Set(['10:member-a']),
    { baselineReady: true, maxKnownRooms: 2 },
  );
  assert.deepEqual([...result.knownIds.keys()], ['20:member-b', '30:member-c']);
  assert.deepEqual([...result.unreadKeys], ['30:member-c']);
});

test('member preview cache keys isolate members sharing one broadcast session', () => {
  assert.notEqual(memberPreviewKey(42, 'member-a'), memberPreviewKey(42, 'member-b'));
  assert.equal(memberPreviewKey(42, 'member-a'), '42:member-a');
});

test('a superseded or older close cannot turn off the current live session', () => {
  const current = {
    uid: 'streamer', is_live: true, live_opened_at: '2026-10-10T12:00:00+09:00',
    latest_session_id: 12, latest_session_status: 'OPEN',
  };
  assert.equal(sessionEventUpdatesStreamer({
    channel_id: 'streamer', session_id: 11, status: 'CLOSE', superseded: true,
    opened_at: '2026-10-10T11:00:00+09:00',
  }, current), false);
  assert.equal(sessionEventUpdatesStreamer({
    channel_id: 'streamer', session_id: 11, status: 'CLOSE',
    opened_at: '2026-10-10T11:00:00+09:00',
  }, current), false);
  assert.equal(sessionEventUpdatesStreamer({
    channel_id: 'streamer', session_id: 12, status: 'CLOSE',
    opened_at: '2026-10-10T12:00:00+09:00',
  }, current), true);
  assert.equal(sessionEventUpdatesStreamer({
    channel_id: 'streamer', session_id: 13, status: 'OPEN',
    opened_at: '2026-10-10T13:00:00+09:00',
  }, current), true);
  assert.equal(sessionEventUpdatesStreamer({
    channel_id: 'streamer', session_id: 11, status: 'OPEN',
    opened_at: '2026-10-10T11:00:00+09:00',
  }, current), false);
  assert.equal(sessionEventUpdatesStreamer({ channel_id: 'streamer', session_id: 13, status: 'OPEN' }, current), false);
  assert.equal(sessionEventUpdatesStreamer({ channel_id: 'streamer', status: 'CLOSE' }, current), false);
});

test('A close, B close, then delayed A open cannot resurrect a stream', () => {
  let streamer = { uid: 'streamer', is_live: false };
  for (const event of [
    { channel_id: 'streamer', session_id: 20, status: 'OPEN', opened_at: '2026-10-10T10:00:00+09:00' },
    { channel_id: 'streamer', session_id: 20, status: 'CLOSE', opened_at: '2026-10-10T10:00:00+09:00' },
    { channel_id: 'streamer', session_id: 21, status: 'OPEN', opened_at: '2026-10-10T10:00:01+09:00' },
    { channel_id: 'streamer', session_id: 21, status: 'CLOSE', opened_at: '2026-10-10T10:00:01+09:00' },
  ]) streamer = applySessionEventToStreamer(event, streamer).streamer;

  const delayed = applySessionEventToStreamer({
    channel_id: 'streamer', session_id: 20, status: 'OPEN',
    opened_at: '2026-10-10T10:00:00+09:00',
  }, streamer);
  assert.equal(delayed.accepted, false);
  assert.equal(delayed.notify, false);
  assert.equal(delayed.streamer.is_live, false);
  assert.equal(delayed.streamer.latest_session_id, 21);
});

test('same-second sessions are ordered by session id and malformed states are rejected', () => {
  const first = applySessionEventToStreamer({
    channel_id: 'streamer', session_id: 30, status: 'OPEN',
    opened_at: '2026-10-10T11:00:00+09:00',
  }, { uid: 'streamer', is_live: false }).streamer;
  const second = applySessionEventToStreamer({
    channel_id: 'streamer', session_id: 31, status: 'OPEN',
    opened_at: '2026-10-10T11:00:00+09:00',
  }, first);
  assert.equal(second.accepted, true);
  assert.equal(second.notify, true);
  assert.equal(second.streamer.latest_session_id, 31);
  assert.equal(applySessionEventToStreamer({
    channel_id: 'streamer', session_id: 32, status: 'UNKNOWN',
  }, second.streamer).accepted, false);
});

test('an older API snapshot cannot erase a closed-session watermark', () => {
  const merged = retainSessionWatermark(
    { uid: 'streamer', is_live: false, latest_session_id: null },
    {
      uid: 'streamer', is_live: false, latest_session_id: 41,
      latest_session_status: 'CLOSE', latest_session_opened_at: '2026-10-10T12:00:00+09:00',
    },
  );
  assert.equal(merged.latest_session_id, 41);
  assert.equal(merged.latest_session_status, 'CLOSE');
  const stale = applySessionEventToStreamer({
    channel_id: 'streamer', session_id: 40, status: 'OPEN',
    opened_at: '2026-10-10T11:00:00+09:00',
  }, merged);
  assert.equal(stale.accepted, false);
});
