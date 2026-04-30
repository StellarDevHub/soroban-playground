import {
  LockManager,
  LockScope,
  MemoryBackend,
} from '../../src/services/oracle/index.js';

// Acceptance criterion from issue: "Load test: 100 concurrent lock
// acquisitions with zero deadlocks". We exercise both the contended and
// uncontended paths and assert mutual exclusion at all times.

const N = 100;

describe('lock manager load test (100 concurrent)', () => {
  let backend;

  beforeEach(() => {
    backend = new MemoryBackend();
  });

  it('preserves mutual exclusion under 100 contenders for one resource', async () => {
    let inCritical = 0;
    let maxConcurrent = 0;
    let completions = 0;

    const workers = Array.from({ length: N }, (_, i) => {
      const m = new LockManager({ backend, nodeId: `worker-${i}` });
      return async () => {
        const handle = await m.acquire({
          scope: LockScope.PROJECT,
          id: 'shared',
          ttlMs: 5000,
          retry: { maxAttempts: 200, baseMs: 1, maxMs: 10, jitter: 0.5 },
        });
        inCritical += 1;
        if (inCritical > maxConcurrent) maxConcurrent = inCritical;
        // Simulated work — keep tiny so the whole suite stays fast.
        await new Promise((r) => setImmediate(r));
        inCritical -= 1;
        await handle.release();
        completions += 1;
      };
    });

    await Promise.all(workers.map((w) => w()));
    expect(completions).toBe(N);
    expect(maxConcurrent).toBe(1);
    expect(backend.store.size).toBe(0);
  }, 30_000);

  it('100 acquisitions on distinct resources all succeed without retry', async () => {
    const m = new LockManager({ backend, nodeId: 'single' });
    const handles = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        m.acquire({
          scope: LockScope.PROJECT,
          id: `r-${i}`,
          ttlMs: 5000,
          retry: { maxAttempts: 1 },
        })
      )
    );
    expect(handles).toHaveLength(N);
    expect(m.listHeld()).toHaveLength(N);
    await Promise.all(handles.map((h) => h.release()));
    expect(m.listHeld()).toHaveLength(0);
  }, 15_000);

  it('zero deadlocks: no AB-BA cycle when ordering is respected', async () => {
    // Each worker must acquire keys in canonical (alphabetic) order. With
    // that discipline, even N workers competing for two resources produce
    // no cycles.
    const ordered = ['alpha', 'beta'];
    const errors = [];

    await Promise.all(
      Array.from({ length: N }, (_, i) => {
        const m = new LockManager({ backend, nodeId: `w-${i}` });
        return (async () => {
          try {
            const a = await m.acquire({
              scope: LockScope.PROJECT,
              id: ordered[0],
              ttlMs: 5000,
              retry: { maxAttempts: 500, baseMs: 1, maxMs: 5, jitter: 0.5 },
            });
            const b = await m.acquire({
              scope: LockScope.BATCH,
              id: ordered[1],
              ttlMs: 5000,
              retry: { maxAttempts: 500, baseMs: 1, maxMs: 5, jitter: 0.5 },
            });
            await new Promise((r) => setImmediate(r));
            await b.release();
            await a.release();
          } catch (err) {
            errors.push(err);
          }
        })();
      })
    );

    const deadlocks = errors.filter((e) => e.code === 'DEADLOCK');
    expect(deadlocks).toHaveLength(0);
    expect(errors).toHaveLength(0);
  }, 30_000);
});
