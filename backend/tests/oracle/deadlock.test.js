import { DeadlockDetector } from '../../src/services/oracle/deadlock.js';

describe('DeadlockDetector', () => {
  it('detects a simple two-owner cycle', () => {
    const d = new DeadlockDetector();
    d.registerHold('keyA', 'ownerA');
    d.registerHold('keyB', 'ownerB');

    // ownerA waits for keyB (held by B) — fine, no cycle yet
    expect(d.declareWait('ownerA', 'keyB').deadlock).toBe(false);
    // ownerB waits for keyA (held by A) — closes cycle B -> A -> B
    const result = d.declareWait('ownerB', 'keyA');
    expect(result.deadlock).toBe(true);
    expect(result.cycle).toContain('ownerA');
    expect(result.cycle).toContain('ownerB');
  });

  it('does not flag non-cyclic waits', () => {
    const d = new DeadlockDetector();
    d.registerHold('k1', 'o1');
    d.registerHold('k2', 'o2');
    d.registerHold('k3', 'o3');
    expect(d.declareWait('o4', 'k1').deadlock).toBe(false);
    expect(d.declareWait('o4', 'k2').deadlock).toBe(false);
    expect(d.declareWait('o4', 'k3').deadlock).toBe(false);
  });

  it('forgetting an owner removes their edges', () => {
    const d = new DeadlockDetector();
    d.registerHold('k1', 'o1');
    d.declareWait('o2', 'k1');
    d.forgetOwner('o2');
    const snap = d.snapshot();
    expect(snap.waits.find((w) => w.owner === 'o2')).toBeUndefined();
  });

  it('clearWait removes a single wait edge', () => {
    const d = new DeadlockDetector();
    d.registerHold('k1', 'o1');
    d.registerHold('k2', 'o2');
    d.declareWait('o3', 'k1');
    d.declareWait('o3', 'k2');
    d.clearWait('o3', 'k1');
    const snap = d.snapshot();
    const w = snap.waits.find((x) => x.owner === 'o3');
    expect(w.waitingFor).toEqual(['o2']);
  });
});
