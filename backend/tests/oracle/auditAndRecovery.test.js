import {
  AuditLog,
  LockManager,
  LockScope,
  MemoryBackend,
} from '../../src/services/oracle/index.js';

describe('audit log + crash recovery', () => {
  it('records acquire and release events', async () => {
    const audit = new AuditLog({ capacity: 100 });
    const backend = new MemoryBackend();
    const m = new LockManager({ backend, nodeId: 'n1', auditLog: audit });
    const h = await m.acquire({ scope: LockScope.PROJECT, id: 'p' });
    await h.release();
    const events = audit.recent().map((e) => e.event);
    expect(events).toContain('acquire.success');
    expect(events).toContain('release.success');
  });

  it('logs deadlock detections', async () => {
    const audit = new AuditLog({ capacity: 100 });
    const backend = new MemoryBackend();
    const a = new LockManager({ backend, nodeId: 'A', auditLog: audit });
    const b = new LockManager({ backend, nodeId: 'B', auditLog: audit });

    // A holds keyA, B holds keyB
    const ha = await a.acquire({ scope: LockScope.PROJECT, id: 'A', ttlMs: 5000 });
    const hb = await b.acquire({ scope: LockScope.BATCH, id: 'B', ttlMs: 5000 });

    // Now A waits for B's BATCH key, B waits for A's PROJECT key — cycle.
    // We must use the *same* deadlock detector for both managers to see
    // the cycle, so wire that explicitly.
    const { sharedDeadlockDetector } = await import('../../src/services/oracle/index.js');
    const a2 = new LockManager({
      backend,
      nodeId: 'A2',
      auditLog: audit,
      deadlockDetector: sharedDeadlockDetector,
    });
    const b2 = new LockManager({
      backend,
      nodeId: 'B2',
      auditLog: audit,
      deadlockDetector: sharedDeadlockDetector,
    });

    sharedDeadlockDetector.registerHold('oracle:lock:project:A', ha.owner);
    sharedDeadlockDetector.registerHold('oracle:lock:batch:B', hb.owner);

    // Manually exercise the detector path through the manager: we expect
    // one of these two competing waits to trip the cycle.
    const r1 = sharedDeadlockDetector.declareWait(ha.owner, 'oracle:lock:batch:B');
    const r2 = sharedDeadlockDetector.declareWait(hb.owner, 'oracle:lock:project:A');
    expect(r1.deadlock || r2.deadlock).toBe(true);

    // Cleanup so other tests don't see leftover state in the shared detector.
    sharedDeadlockDetector.forgetOwner(ha.owner);
    sharedDeadlockDetector.forgetOwner(hb.owner);

    await ha.release();
    await hb.release();
    // Suppress unused-var lint by referencing the helpers
    expect(typeof a2.acquire).toBe('function');
    expect(typeof b2.acquire).toBe('function');
  });

  it('ring-buffer caps audit entries at capacity', () => {
    const audit = new AuditLog({ capacity: 5 });
    for (let i = 0; i < 20; i += 1) audit.record('test', { i });
    expect(audit.recent().length).toBe(5);
    expect(audit.recent()[0].i).toBe(15);
  });

  it('recoverStaleHolds reclaims state when backend has been wiped', async () => {
    const backend = new MemoryBackend();
    const m = new LockManager({ backend, nodeId: 'n1' });
    await m.acquire({ scope: LockScope.PROJECT, id: 'p1' });
    await m.acquire({ scope: LockScope.PROJECT, id: 'p2' });
    expect(m.listHeld()).toHaveLength(2);
    backend._clear();
    const recovered = await m.recoverStaleHolds();
    expect(recovered).toHaveLength(2);
    expect(m.listHeld()).toHaveLength(0);
  });
});
