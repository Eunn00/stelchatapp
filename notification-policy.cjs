function liveSessionKey(uid, openedAt) {
  return `${uid}:${openedAt || ''}`;
}

function notificationEventType(eventName, payload, baselineReady, startupLiveSessions) {
  if (!baselineReady) return null;
  if (eventName === 'chat') return 'chat';
  if (eventName !== 'session' || payload.status !== 'OPEN' || payload.previous_status === 'OPEN') return null;
  if (startupLiveSessions.has(liveSessionKey(payload.channel_id, payload.opened_at))) return null;
  return 'live';
}

module.exports = { liveSessionKey, notificationEventType };
