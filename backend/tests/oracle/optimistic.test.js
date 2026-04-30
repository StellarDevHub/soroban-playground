import { OptimisticStore } from '../../src/services/oracle/optimistic.js';

describe('OptimisticStore', () => {
  it('CAS succeeds on matching version and increments', () => {
    const s = new OptimisticStore();
    const r1 = s.compareAndSet('k', 0, 'v1');
    expect(r1).toEqual({ ok: true, version: 1 });
    const r2 = s.compareAndSet('k', 1, 'v2');
    expect(r2).toEqual({ ok: true, version: 2 });
  });

  it('CAS fails on stale version', () => {
    const s = new OptimisticStore();
    s.compareAndSet('k', 0, 'v1');
    expect(s.compareAndSet('k', 0, 'v2')).toEqual({ ok: false, version: 1 });
  });

  it('withCas retries until success', async () => {
    const s = new OptimisticStore();
    s.compareAndSet('counter', 0, 0);

    // Run 10 concurrent increments. All must commit; final value must be 10.
    const N = 10;
    await Promise.all(
      Array.from({ length: N }, () =>
        s.withCas('counter', (cur) => (cur || 0) + 1, { maxAttempts: 50 })
      )
    );
    expect(s.read('counter').value).toBe(N);
    expect(s.read('counter').version).toBe(N + 1); // +1 because of the initial set
  });

  it('withCas throws when retries are exhausted', async () => {
    const s = new OptimisticStore();
    s.compareAndSet('k', 0, 'init');
    // mutator that intentionally invalidates its own read by writing first
    await expect(
      s.withCas(
        'k',
        async () => {
          s.compareAndSet('k', s.read('k').version, 'interloper');
          return 'me';
        },
        { maxAttempts: 3 }
      )
    ).rejects.toThrow(/CAS failed/);
  });
});
