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

  return { mergeRecentSnapshot, mergeStreamerSnapshot, recentKey };
}));
