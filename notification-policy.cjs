function liveSessionKey(uid, openedAt, sessionId = null) {
  return `${uid}:${sessionId || 'unknown'}:${openedAt || ''}`;
}

function chatRoomKey(sessionId, targetUid) {
  const numericSessionId = Number(sessionId);
  if (!Number.isInteger(numericSessionId) || numericSessionId < 1
      || typeof targetUid !== 'string' || !targetUid) return '';
  return `${numericSessionId}:${targetUid}`;
}

function chatRoomIsMuted(payload, mutedChatRooms) {
  const key = chatRoomKey(payload?.session_id, payload?.target_uid);
  return Boolean(key && mutedChatRooms?.[key]);
}

function notificationEventType(eventName, payload, baselineReady, startupLiveSessions) {
  if (eventName === 'chat') return 'chat';
  if (!baselineReady) return null;
  if (eventName !== 'session' || payload.superseded
      || payload.status !== 'OPEN' || payload.previous_status === 'OPEN'
      || !Number.isSafeInteger(Number(payload.session_id)) || Number(payload.session_id) < 1
      || typeof payload.channel_id !== 'string' || !payload.channel_id
      || typeof payload.opened_at !== 'string' || !payload.opened_at) return null;
  if (startupLiveSessions.has(liveSessionKey(
    payload.channel_id, payload.opened_at, payload.session_id,
  )) || startupLiveSessions.has(liveSessionKey(payload.channel_id, payload.opened_at))) return null;
  return 'live';
}

module.exports = { chatRoomIsMuted, chatRoomKey, liveSessionKey, notificationEventType };
