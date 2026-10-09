function createExternalOpenGuard({ cooldownMs = 1000, now = Date.now } = {}) {
  const openedAt = new Map();
  return (url) => {
    const current = now();
    const previous = openedAt.get(url);
    if (previous !== undefined && current - previous < cooldownMs) return false;
    openedAt.set(url, current);
    if (openedAt.size > 100) {
      for (const [key, timestamp] of openedAt) {
        if (current - timestamp >= cooldownMs) openedAt.delete(key);
      }
    }
    return true;
  };
}

module.exports = { createExternalOpenGuard };
