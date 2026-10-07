function liveSessionKey(uid, openedAt) {
  return `${uid}:${openedAt || ''}`;
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
  if (!baselineReady) return null;
  if (eventName === 'chat') return 'chat';
  if (eventName !== 'session' || payload.status !== 'OPEN' || payload.previous_status === 'OPEN') return null;
  if (startupLiveSessions.has(liveSessionKey(payload.channel_id, payload.opened_at))) return null;
  return 'live';
}

module.exports = { chatRoomIsMuted, chatRoomKey, liveSessionKey, notificationEventType };
