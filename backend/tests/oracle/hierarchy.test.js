import {
  buildKey,
  parseKey,
  validateAcquisitionOrder,
  LockScope,
  rankOf,
} from '../../src/services/oracle/hierarchy.js';

describe('hierarchy', () => {
  it('builds and parses keys', () => {
    expect(buildKey(LockScope.GLOBAL)).toBe('oracle:lock:global');
    expect(buildKey(LockScope.PROJECT, 'p1')).toBe('oracle:lock:project:p1');
    expect(buildKey(LockScope.BATCH, 'b1')).toBe('oracle:lock:batch:b1');

    expect(parseKey('oracle:lock:project:p1')).toEqual({ scope: 'project', id: 'p1' });
    expect(parseKey('oracle:lock:global')).toEqual({ scope: 'global', id: null });
    expect(parseKey('not-a-lock')).toBeNull();
  });

  it('requires an id for non-global scopes', () => {
    expect(() => buildKey(LockScope.PROJECT)).toThrow(/requires an id/);
    expect(() => buildKey(LockScope.BATCH, '')).toThrow(/requires an id/);
  });

  it('orders ranks global > project > batch', () => {
    expect(rankOf(LockScope.GLOBAL)).toBeGreaterThan(rankOf(LockScope.PROJECT));
    expect(rankOf(LockScope.PROJECT)).toBeGreaterThan(rankOf(LockScope.BATCH));
  });

  it('rejects acquiring a broader lock when narrower is held', () => {
    const result = validateAcquisitionOrder(LockScope.GLOBAL, [LockScope.BATCH]);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/ordering violation/i);
  });

  it('allows acquiring narrower locks while broader are held', () => {
    expect(validateAcquisitionOrder(LockScope.BATCH, [LockScope.GLOBAL]).ok).toBe(true);
    expect(validateAcquisitionOrder(LockScope.PROJECT, [LockScope.GLOBAL]).ok).toBe(true);
  });

  it('strictParent requires a parent for batch locks', () => {
    const without = validateAcquisitionOrder(LockScope.BATCH, [], { strictParent: true });
    expect(without.ok).toBe(false);
    const withParent = validateAcquisitionOrder(LockScope.BATCH, [LockScope.PROJECT], {
      strictParent: true,
    });
    expect(withParent.ok).toBe(true);
  });
});
