// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// Hierarchical lock key construction for oracle coordination.
// Higher rank == broader scope. Locks must be acquired in descending
// rank order (global -> project -> batch) to prevent inversion deadlocks.

export const LockScope = Object.freeze({
  GLOBAL: 'global',
  PROJECT: 'project',
  BATCH: 'batch',
});

const RANK = {
  [LockScope.GLOBAL]: 30,
  [LockScope.PROJECT]: 20,
  [LockScope.BATCH]: 10,
};

const KEY_PREFIX = 'oracle:lock';

export function buildKey(scope, id) {
  if (!RANK[scope]) {
    throw new Error(`Unknown lock scope: ${scope}`);
  }
  if (scope === LockScope.GLOBAL) {
    return `${KEY_PREFIX}:${scope}`;
  }
  if (id === undefined || id === null || `${id}`.length === 0) {
    throw new Error(`Lock scope "${scope}" requires an id`);
  }
  return `${KEY_PREFIX}:${scope}:${id}`;
}

export function parseKey(key) {
  if (!key.startsWith(`${KEY_PREFIX}:`)) return null;
  const rest = key.slice(KEY_PREFIX.length + 1);
  const [scope, ...idParts] = rest.split(':');
  if (!RANK[scope]) return null;
  return { scope, id: idParts.join(':') || null };
}

export function rankOf(scope) {
  return RANK[scope] ?? 0;
}

// Validate that a candidate scope can be acquired given the set of
// already-held scopes for the same owner. The rule: a more specific
// (lower-rank) lock cannot be acquired if a broader one is *not* held
// when strict mode is on; and vice versa, a broader lock cannot be
// acquired *after* a narrower one (would invert ordering).
export function validateAcquisitionOrder(
  candidateScope,
  heldScopes,
  { strictParent = false } = {}
) {
  const candidateRank = rankOf(candidateScope);
  for (const held of heldScopes) {
    const heldRank = rankOf(held);
    if (heldRank < candidateRank) {
      return {
        ok: false,
        reason: `Lock ordering violation: cannot acquire ${candidateScope} (rank ${candidateRank}) while holding ${held} (rank ${heldRank})`,
      };
    }
  }
  if (strictParent && candidateScope === LockScope.BATCH) {
    if (
      !heldScopes.includes(LockScope.PROJECT) &&
      !heldScopes.includes(LockScope.GLOBAL)
    ) {
      return {
        ok: false,
        reason:
          'BATCH lock requires holding PROJECT or GLOBAL first (strictParent=true)',
      };
    }
  }
  return { ok: true };
}
