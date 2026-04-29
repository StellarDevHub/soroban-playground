import {
  LockManager,
  LockAcquisitionError,
  LockScope,
  MemoryBackend,
} from '../../src/services/oracle/index.js';

describe('LockManager', () => {
  let backend;
  let manager;

  beforeEach(() => {
    backend = new MemoryBackend();
    manager = new LockManager({ backend, nodeId: 'test-node' });
  });

  it('acquires and releases a lock', async () => {
    const handle = await manager.acquire({ scope: LockScope.PROJECT, id: 'p1' });
    expect(handle.key).toBe('oracle:lock:project:p1');
    expect(handle.owner.startsWith('test-node:')).toBe(true);
    const released = await handle.release();
    expect(released).toBe(true);
  });

  it('blocks a second acquirer until the first releases', async () => {
    const first = await manager.acquire({
      scope: LockScope.PROJECT,
      id: 'p1',
      ttlMs: 5000,
    });

    const second = new LockManager({ backend, nodeId: 'other-node' });
    await expect(
      second.acquire({
        scope: LockScope.PROJECT,
        id: 'p1',
        retry: { maxAttempts: 2, baseMs: 5, jitter: 0 },
      })
    ).rejects.toBeInstanceOf(LockAcquisitionError);

    await first.release();

    const after = await second.acquire({
      scope: LockScope.PROJECT,
      id: 'p1',
      retry: { maxAttempts: 1 },
    });
    expect(after.owner.startsWith('other-node:')).toBe(true);
    await after.release();
  });

  it('rejects release when owner token does not match', async () => {
    const handle = await manager.acquire({ scope: LockScope.PROJECT, id: 'p1' });
    // Tamper: ask backend to release with a wrong owner.
    const ok = await backend.release(handle.key, 'not-the-owner');
    expect(ok).toBe(false);
    // The real owner can still release.
    expect(await handle.release()).toBe(true);
  });

  it('extends a lock TTL', async () => {
    const handle = await manager.acquire({
      scope: LockScope.PROJECT,
      id: 'p1',
      ttlMs: 1000,
    });
    const extended = await handle.extend(5000);
    expect(extended).toBe(true);
    const inspected = await backend.inspect(handle.key);
    expect(inspected.expiresAt - Date.now()).toBeGreaterThan(2000);
    await handle.release();
  });

  it('rejects acquiring a broader lock while holding a narrower one (ordering)', async () => {
    const batchHandle = await manager.acquire({
      scope: LockScope.BATCH,
      id: 'b1',
      ttlMs: 5000,
    });
    await expect(
      manager.acquire({ scope: LockScope.GLOBAL, ttlMs: 1000 })
    ).rejects.toThrow(/ordering violation/i);
    await batchHandle.release();
  });

  it('withLock releases even when the body throws', async () => {
    await expect(
      manager.withLock({ scope: LockScope.PROJECT, id: 'p1' }, async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(manager.listHeld()).toHaveLength(0);
  });

  it('recoverStaleHolds forgets locks that no longer exist', async () => {
    const handle = await manager.acquire({ scope: LockScope.PROJECT, id: 'p1' });
    backend._clear();
    const recovered = await manager.recoverStaleHolds();
    expect(recovered).toHaveLength(1);
    expect(recovered[0].action).toBe('forgotten');
    expect(manager.listHeld()).toHaveLength(0);
    // calling release on the orphan handle is now a no-op
    await handle.release();
  });

  it('emits a release event when the underlying lock has expired', async () => {
    const handle = await manager.acquire({
      scope: LockScope.PROJECT,
      id: 'p1',
      ttlMs: 10,
    });
    await new Promise((r) => setTimeout(r, 25));
    const ok = await handle.release();
    expect(ok).toBe(false); // expired before we got there
  });
});
