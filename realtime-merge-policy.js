(function exposeRealtimeMergePolicy(root, factory) {
  const policy = factory();
  if (typeof module === 'object' && module.exports) module.exports = policy;
  else root.stelchatRealtimeMerge = policy;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const recentKey = (item) => `${item.session_id}:${item.target_uid}`;

  function compareRecent(left, right) {
    const byTime = String(right.sent_at || '').localeCompare(String(left.sent_at || ''));
    if (byTime) return byTime;
    return Number(right.id || 0) - Number(left.id || 0);
  }

  function compareMessageOrder(left, right) {
    const byTime = String(left?.sent_at || '').localeCompare(String(right?.sent_at || ''));
    if (byTime) return byTime;
    return Number(left?.id || 0) - Number(right?.id || 0);
  }

  function mergeRecentSnapshot(snapshot, current, preserveKeys, limit = 20) {
    const merged = new Map((snapshot || []).map((item) => [recentKey(item), item]));
    for (const item of current || []) {
      const key = recentKey(item);
      if (preserveKeys.has(key)) merged.set(key, item);
    }
    return [...merged.values()].sort(compareRecent).slice(0, limit);
  }

  function mergeStreamerSnapshot(snapshot, current, preserveUids) {
    const currentByUid = new Map((current || []).map((item) => [item.uid, item]));
    return (snapshot || []).map((item) => (
      preserveUids.has(item.uid) ? (currentByUid.get(item.uid) || item) : item
    ));
  }

  function compareMemberSessions(left, right) {
    const byTime = String(right.last_chat_at || '').localeCompare(String(left.last_chat_at || ''));
    if (byTime) return byTime;
    return Number(right.id || 0) - Number(left.id || 0);
  }

  function mergeMemberSessionItem(snapshotItem, realtimeItem) {
    if (!snapshotItem) return realtimeItem;
    if (!realtimeItem) return snapshotItem;
    const snapshotLatest = {
      sent_at: snapshotItem.last_chat_at,
      id: snapshotItem.latest_message_id,
    };
    const realtimeLatest = {
      sent_at: realtimeItem.last_chat_at,
      id: realtimeItem.latest_message_id,
    };
    const latest = compareMessageOrder(realtimeLatest, snapshotLatest) >= 0
      ? realtimeItem : snapshotItem;
    return {
      ...snapshotItem,
      ...realtimeItem,
      latest: latest.latest,
      latest_source: latest.latest_source,
      last_chat_at: latest.last_chat_at,
      latest_message_id: latest.latest_message_id,
      latest_id: Math.max(Number(snapshotItem.latest_id || 0), Number(realtimeItem.latest_id || 0)),
      message_count: Math.max(
        Number(snapshotItem.message_count || 0), Number(realtimeItem.message_count || 0),
      ),
    };
  }

  function mergeMemberSessionSnapshot(snapshot, current, preserveSessionIds, limit = 50) {
    const merged = new Map((snapshot || []).map((item) => [Number(item.id), item]));
    for (const item of current || []) {
      const sessionId = Number(item.id);
      if (preserveSessionIds.has(sessionId)) {
        merged.set(sessionId, mergeMemberSessionItem(merged.get(sessionId), item));
      } else if (!merged.has(sessionId)) {
        merged.set(sessionId, item);
      }
    }
    return [...merged.values()].sort(compareMemberSessions).slice(0, limit);
  }

  function compareMessages(left, right) {
    return compareMessageOrder(left, right);
  }

  function mergePreviewMessages(snapshotMessages, realtimeMessages, limit = 20) {
    const merged = new Map((snapshotMessages || []).map((item) => [String(item.id), item]));
    for (const item of realtimeMessages || []) merged.set(String(item.id), item);
    return [...merged.values()].sort(compareMessages).slice(-limit);
  }

  return {
    mergeMemberSessionSnapshot,
    mergeMemberSessionItem,
    mergePreviewMessages,
    mergeRecentSnapshot,
    mergeStreamerSnapshot,
    compareMessageOrder,
    recentKey,
  };
}));
