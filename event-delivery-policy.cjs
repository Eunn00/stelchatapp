function eventDeliveryKey(eventName, payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (eventName === 'chat' && payload.id != null) return `chat:${payload.id}`;
  if (eventName !== 'session' || payload.session_id == null) return '';
  return `session:${JSON.stringify([
    payload.session_id,
    payload.status || '',
    payload.previous_status || '',
    payload.opened_at || '',
    payload.closed_at || '',
    payload.finalized_at || '',
    Boolean(payload.superseded),
    payload.title || '',
    payload.live_category || '',
  ])}`;
}

function createEventDeduper(limit = 1000) {
  const deliveredChats = new Set();
  const latestSessionEvents = new Map();
  return (eventName, payload) => {
    const key = eventDeliveryKey(eventName, payload);
    if (!key) return false;
    if (eventName === 'chat') {
      if (deliveredChats.has(key)) return true;
      deliveredChats.add(key);
      while (deliveredChats.size > limit) deliveredChats.delete(deliveredChats.values().next().value);
      return false;
    }
    const sessionKey = `session:${payload.session_id}`;
    const duplicate = latestSessionEvents.get(sessionKey) === key;
    latestSessionEvents.delete(sessionKey);
    latestSessionEvents.set(sessionKey, key);
    while (latestSessionEvents.size > limit) {
      latestSessionEvents.delete(latestSessionEvents.keys().next().value);
    }
    return duplicate;
  };
}

function reconnectDelay(attempt, retryAfterMs = 0, random = Math.random) {
  const exponent = Math.max(0, Math.min(5, Number(attempt) || 0));
  const base = Math.min(60000, 3000 * (2 ** exponent));
  const jitter = Math.floor(base * 0.2 * Math.max(0, Math.min(1, Number(random()) || 0)));
  return Math.max(Number(retryAfterMs) || 0, base + jitter);
}

module.exports = { createEventDeduper, eventDeliveryKey, reconnectDelay };
