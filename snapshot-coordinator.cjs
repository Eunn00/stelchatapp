function createSnapshotCoordinator(fetchSnapshot) {
  if (typeof fetchSnapshot !== 'function') throw new TypeError('fetchSnapshot must be a function');

  let activeRequest = null;
  let queuedRefresh = null;

  function start() {
    const request = Promise.resolve().then(fetchSnapshot);
    activeRequest = request;
    request.then(
      () => { if (activeRequest === request) activeRequest = null; },
      () => { if (activeRequest === request) activeRequest = null; },
    );
    return request;
  }

  function snapshot() {
    return activeRequest || start();
  }

  function refresh() {
    if (queuedRefresh) return queuedRefresh;
    const precedingRequest = activeRequest;
    if (!precedingRequest) return start();
    let trackedRequest;
    const request = precedingRequest.catch(() => undefined).then(() => {
      // Once this forced fetch begins, a later refresh must be allowed to queue
      // one more fetch behind it instead of reusing a pre-gap result.
      if (queuedRefresh === trackedRequest) queuedRefresh = null;
      return activeRequest && activeRequest !== precedingRequest ? activeRequest : start();
    });
    trackedRequest = request.finally(() => {
      if (queuedRefresh === trackedRequest) queuedRefresh = null;
    });
    queuedRefresh = trackedRequest;
    return trackedRequest;
  }

  return { refresh, snapshot };
}

module.exports = { createSnapshotCoordinator };
