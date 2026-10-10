(function exposeRendererStatePolicy(root, factory) {
  const policy = factory();
  if (typeof module === 'object' && module.exports) module.exports = policy;
  else root.stelchatRendererState = policy;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const DEFAULT_MAX_KNOWN_ROOMS = 500;

  const recentKey = (item) => `${item.session_id}:${item.target_uid}`;
  const memberPreviewKey = (sessionId, targetUid) => `${sessionId}:${targetUid}`;

  const numericSessionId = (value) => {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  };

  function applySessionEventToStreamer(payload, currentStreamer) {
    if (!payload || !currentStreamer || payload.superseded
        || (payload.status !== 'OPEN' && payload.status !== 'CLOSE')) {
      return { accepted: false, changed: false, notify: false, streamer: currentStreamer };
    }
    if (payload.channel_id && payload.channel_id !== currentStreamer.uid) {
      return { accepted: false, changed: false, notify: false, streamer: currentStreamer };
    }
    const eventSessionId = numericSessionId(payload.session_id);
    if (!eventSessionId || (payload.status === 'OPEN' && !payload.opened_at)) {
      return { accepted: false, changed: false, notify: false, streamer: currentStreamer };
    }
    const currentSessionId = numericSessionId(currentStreamer.latest_session_id);
    if (currentSessionId && eventSessionId < currentSessionId) {
      return { accepted: false, changed: false, notify: false, streamer: currentStreamer };
    }
    const previousStatus = currentSessionId === eventSessionId
      ? currentStreamer.latest_session_status
      : null;
    const isLive = payload.status === 'OPEN';
    const streamer = {
      ...currentStreamer,
      is_live: isLive,
      live_opened_at: isLive ? payload.opened_at : null,
      live_title: isLive ? (payload.title || '') : '',
      live_category: isLive ? (payload.live_category || '') : '',
      latest_session_id: eventSessionId,
      latest_session_status: payload.status,
      latest_session_opened_at: payload.opened_at
        || currentStreamer.latest_session_opened_at || null,
    };
    const changed = currentSessionId !== eventSessionId
      || previousStatus !== payload.status
      || currentStreamer.live_opened_at !== streamer.live_opened_at
      || currentStreamer.live_title !== streamer.live_title
      || currentStreamer.live_category !== streamer.live_category;
    return {
      accepted: true,
      changed,
      notify: isLive && (currentSessionId !== eventSessionId || previousStatus !== 'OPEN'),
      streamer: changed ? streamer : currentStreamer,
    };
  }

  function retainSessionWatermark(freshStreamer, currentStreamer) {
    if (!freshStreamer || !currentStreamer) return freshStreamer;
    const freshId = numericSessionId(freshStreamer.latest_session_id);
    const currentId = numericSessionId(currentStreamer.latest_session_id);
    if (!currentId || (freshId && freshId >= currentId)) return freshStreamer;
    const result = {
      ...freshStreamer,
      latest_session_id: currentId,
      latest_session_status: currentStreamer.latest_session_status,
      latest_session_opened_at: currentStreamer.latest_session_opened_at,
    };
    // An explicit older id means the whole snapshot is stale. When the older
    // server version does not expose ids at all, trust its visible LIVE state
    // but retain the local id watermark until a newer event arrives.
    if (freshId && freshId < currentId) {
      result.is_live = currentStreamer.is_live;
      result.live_opened_at = currentStreamer.live_opened_at;
      result.live_title = currentStreamer.live_title;
      result.live_category = currentStreamer.live_category;
    }
    return result;
  }

  function sessionEventUpdatesStreamer(payload, currentStreamer) {
    return applySessionEventToStreamer(payload, currentStreamer).changed;
  }

  function trimKnownRooms(knownIds, unreadKeys, maxKnownRooms = DEFAULT_MAX_KNOWN_ROOMS) {
    while (knownIds.size > maxKnownRooms) {
      const oldestKey = knownIds.keys().next().value;
      knownIds.delete(oldestKey);
      unreadKeys.delete(oldestKey);
    }
  }

  function reconcileRecentReadState(items, knownIds, unreadKeys, {
    baselineReady = false,
    establishBaseline = true,
    markBeforeBaseline = false,
    isBeingRead = () => false,
    maxKnownRooms = DEFAULT_MAX_KNOWN_ROOMS,
  } = {}) {
    const nextKnownIds = new Map(knownIds || []);
    const nextUnreadKeys = new Set(unreadKeys || []);

    for (const item of items || []) {
      const key = recentKey(item);
      const messageId = String(item?.id ?? '');
      if (!messageId) continue;
      const knownId = nextKnownIds.get(key);
      if ((baselineReady || markBeforeBaseline) && knownId !== messageId && !isBeingRead(key)) {
        nextUnreadKeys.add(key);
      }
      // Refresh insertion order so active rooms survive the bounded history.
      nextKnownIds.delete(key);
      nextKnownIds.set(key, messageId);
    }

    trimKnownRooms(nextKnownIds, nextUnreadKeys, maxKnownRooms);
    return {
      knownIds: nextKnownIds,
      unreadKeys: nextUnreadKeys,
      baselineReady: baselineReady || establishBaseline,
    };
  }

  return {
    DEFAULT_MAX_KNOWN_ROOMS,
    applySessionEventToStreamer,
    memberPreviewKey,
    recentKey,
    reconcileRecentReadState,
    retainSessionWatermark,
    sessionEventUpdatesStreamer,
  };
}));
