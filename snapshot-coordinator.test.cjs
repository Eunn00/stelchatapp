const assert = require('node:assert/strict');
const test = require('node:test');
const { createSnapshotCoordinator } = require('./snapshot-coordinator.cjs');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

test('ordinary concurrent snapshots share one request', async () => {
  const pending = deferred();
  let calls = 0;
  const coordinator = createSnapshotCoordinator(() => {
    calls += 1;
    return pending.promise;
  });
  const first = coordinator.snapshot();
  const second = coordinator.snapshot();
  assert.equal(first, second);
  assert.equal(calls, 0);
  await Promise.resolve();
  assert.equal(calls, 1);
  pending.resolve('snapshot-a');
  assert.equal(await first, 'snapshot-a');
});

test('a refresh requested during an old snapshot always performs a fresh request', async () => {
  const requests = [deferred(), deferred()];
  let calls = 0;
  const coordinator = createSnapshotCoordinator(() => requests[calls++].promise);
  const oldSnapshot = coordinator.snapshot();
  await Promise.resolve();
  const refresh = coordinator.refresh();
  const sameRefresh = coordinator.refresh();
  assert.equal(refresh, sameRefresh);
  assert.equal(calls, 1);
  requests[0].resolve('stale');
  assert.equal(await oldSnapshot, 'stale');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  requests[1].resolve('fresh');
  assert.equal(await refresh, 'fresh');
});

test('a refresh still runs after the preceding snapshot fails', async () => {
  let calls = 0;
  const coordinator = createSnapshotCoordinator(async () => {
    calls += 1;
    if (calls === 1) throw new Error('temporary failure');
    return 'recovered';
  });
  const oldSnapshot = coordinator.snapshot();
  const refresh = coordinator.refresh();
  await assert.rejects(oldSnapshot, /temporary failure/);
  assert.equal(await refresh, 'recovered');
  assert.equal(calls, 2);
});

test('a refresh arriving during an active refresh queues one trailing fresh request', async () => {
  const requests = [deferred(), deferred()];
  let calls = 0;
  const coordinator = createSnapshotCoordinator(() => requests[calls++].promise);
  const firstRefresh = coordinator.refresh();
  await Promise.resolve();
  assert.equal(calls, 1);
  const trailingRefresh = coordinator.refresh();
  const coalescedTrailingRefresh = coordinator.refresh();
  assert.notEqual(firstRefresh, trailingRefresh);
  assert.equal(trailingRefresh, coalescedTrailingRefresh);
  requests[0].resolve('before-second-gap');
  assert.equal(await firstRefresh, 'before-second-gap');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  requests[1].resolve('after-second-gap');
  assert.equal(await trailingRefresh, 'after-second-gap');
});
