// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import crypto from 'crypto';

import { MemoryBackend, RedisBackend, selectBackend } from './backends.js';
import {
  buildKey,
  LockScope,
  parseKey,
  validateAcquisitionOrder,
} from './hierarchy.js';
import { nextDelay, normalizeRetry, sleep } from './retry.js';
import {
  lockAcquireLatency,
  lockAcquireTotal,
  lockActiveGauge,
  lockBackendGauge,
  lockContention,
  lockHoldDuration,
  lockReleaseTotal,
} from './lockMetrics.js';
import { sharedAuditLog } from './auditLog.js';
import { sharedDeadlockDetector } from './deadlock.js';

const DEFAULT_TTL_MS = 30_000;

export class LockAcquisitionError extends Error {
  constructor(message, { code, key, attempts } = {}) {
    super(message);
    this.name = 'LockAcquisitionError';
    this.code = code || 'LOCK_ACQUIRE_FAILED';
    this.key = key;
    this.attempts = attempts;
  }
}

export class LockManager {
  constructor({
    backend,
    nodeId,
    auditLog = sharedAuditLog,
    deadlockDetector = sharedDeadlockDetector,
    defaultTtlMs = DEFAULT_TTL_MS,
    strictParent = false,
  } = {}) {
    if (!backend) throw new Error('LockManager requires a backend');
    this.backend = backend;
    this.nodeId =
      nodeId || `node-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    this.audit = auditLog;
    this.deadlock = deadlockDetector;
    this.defaultTtlMs = defaultTtlMs;
    this.strictParent = strictParent;
    // owner-token -> { key, scope, acquiredAt, ttlMs }
    this.heldByOwner = new Map();
    // tracks scopes currently held by this manager (per-process view)
    this.heldScopes = new Set();
    lockBackendGauge.set(backend.name === 'redis' ? 1 : 0);
  }

  _newOwner() {
    return `${this.nodeId}:${crypto.randomBytes(8).toString('hex')}`;
  }

  // Acquire a lock. Returns a handle: { key, owner, release(), extend(ms), heldFor() }.
  // Throws LockAcquisitionError if all retries are exhausted.
  async acquire({ scope, id, ttlMs, retry, metadata } = {}) {
    if (!scope) throw new Error('acquire: scope is required');
    const key = buildKey(scope, id);
    const ordering = validateAcquisitionOrder(scope, [...this.heldScopes], {
      strictParent: this.strictParent,
    });
    if (!ordering.ok) {
      this.audit.record('acquire.rejected', {
        key,
        scope,
        nodeId: this.nodeId,
        reason: ordering.reason,
      });
      throw new LockAcquisitionError(ordering.reason, {
        code: 'LOCK_ORDER_VIOLATION',
        key,
      });
    }

    const owner = this._newOwner();
    const effectiveTtl = ttlMs || this.defaultTtlMs;
    const retryOpts = normalizeRetry(retry);
    const startedAt = Date.now();
    const endTimer = lockAcquireLatency.startTimer({ scope });
    let attempts = 0;
    let acquired = false;

    while (attempts < retryOpts.maxAttempts && !acquired) {
      attempts += 1;
      try {
        acquired = await this.backend.tryAcquire(key, owner, effectiveTtl);
      } catch (err) {
        this.audit.record('acquire.error', {
          key,
          scope,
          owner,
          nodeId: this.nodeId,
          attempt: attempts,
          error: err.message,
        });
        endTimer({ outcome: 'error' });
        lockAcquireTotal.inc({ scope, outcome: 'error' });
        throw err;
      }

      if (acquired) break;

      // Contention path. Declare wait → check for deadlock → backoff.
      if (attempts === 1) lockContention.inc({ scope });
      const waitCheck = this.deadlock.declareWait(owner, key);
      if (waitCheck.deadlock) {
        this.audit.record('acquire.deadlock', {
          key,
          scope,
          owner,
          nodeId: this.nodeId,
          cycle: waitCheck.cycle,
        });
        endTimer({ outcome: 'deadlock' });
        lockAcquireTotal.inc({ scope, outcome: 'deadlock' });
        throw new LockAcquisitionError(`Deadlock detected acquiring ${key}`, {
          code: 'DEADLOCK',
          key,
          attempts,
        });
      }

      if (attempts >= retryOpts.maxAttempts) break;
      await sleep(nextDelay(retryOpts, attempts));
    }

    // Always clear the wait edge once we stop trying.
    this.deadlock.clearWait(owner, key);

    if (!acquired) {
      this.audit.record('acquire.timeout', {
        key,
        scope,
        owner,
        nodeId: this.nodeId,
        attempts,
      });
      endTimer({ outcome: 'timeout' });
      lockAcquireTotal.inc({ scope, outcome: 'timeout' });
      throw new LockAcquisitionError(
        `Could not acquire ${key} after ${attempts} attempts`,
        {
          code: 'LOCK_TIMEOUT',
          key,
          attempts,
        }
      );
    }

    // Success bookkeeping.
    const acquiredAt = Date.now();
    const handle = {
      key,
      scope,
      id: id ?? null,
      owner,
      acquiredAt,
      ttlMs: effectiveTtl,
      release: () => this.release(owner),
      extend: (newTtl) => this.extend(owner, newTtl),
      heldFor: () => Date.now() - acquiredAt,
    };
    this.heldByOwner.set(owner, {
      key,
      scope,
      acquiredAt,
      ttlMs: effectiveTtl,
    });
    this.heldScopes.add(scope);
    this.deadlock.registerHold(key, owner);
    lockActiveGauge.inc({ scope });
    endTimer({ outcome: 'acquired' });
    lockAcquireTotal.inc({ scope, outcome: 'acquired' });
    this.audit.record('acquire.success', {
      key,
      scope,
      owner,
      nodeId: this.nodeId,
      attempts,
      latencyMs: Date.now() - startedAt,
      metadata,
    });
    return handle;
  }

  async release(owner) {
    const held = this.heldByOwner.get(owner);
    if (!held) {
      this.audit.record('release.unknown_owner', {
        owner,
        nodeId: this.nodeId,
      });
      lockReleaseTotal.inc({ scope: 'unknown', outcome: 'no_owner' });
      return false;
    }
    const { key, scope, acquiredAt } = held;
    let ok = false;
    try {
      ok = await this.backend.release(key, owner);
    } catch (err) {
      this.audit.record('release.error', {
        key,
        scope,
        owner,
        nodeId: this.nodeId,
        error: err.message,
      });
      lockReleaseTotal.inc({ scope, outcome: 'error' });
      this._forgetLocal(owner, key, scope);
      throw err;
    }
    this._forgetLocal(owner, key, scope);
    const heldMs = Date.now() - acquiredAt;
    lockHoldDuration.observe({ scope }, heldMs / 1000);
    lockActiveGauge.dec({ scope });
    lockReleaseTotal.inc({ scope, outcome: ok ? 'released' : 'expired' });
    this.audit.record(ok ? 'release.success' : 'release.expired', {
      key,
      scope,
      owner,
      nodeId: this.nodeId,
      heldMs,
    });
    return ok;
  }

  async extend(owner, ttlMs) {
    const held = this.heldByOwner.get(owner);
    if (!held) return false;
    const ok = await this.backend.extend(held.key, owner, ttlMs);
    this.audit.record(ok ? 'extend.success' : 'extend.failed', {
      key: held.key,
      scope: held.scope,
      owner,
      nodeId: this.nodeId,
      ttlMs,
    });
    if (ok) held.ttlMs = ttlMs;
    return ok;
  }

  _forgetLocal(owner, key, scope) {
    this.heldByOwner.delete(owner);
    // Recompute heldScopes from remaining locks (not just delete by name —
    // we may hold multiple locks of the same scope).
    const stillHas = new Set();
    for (const meta of this.heldByOwner.values()) stillHas.add(meta.scope);
    this.heldScopes = stillHas;
    this.deadlock.releaseHold(key, owner);
    this.deadlock.forgetOwner(owner);
  }

  // Crash recovery: drop in-memory tracking for owners no longer present
  // in the backend (e.g. TTL expired while node was paused). Backend
  // entries that *do* exist but were owned by this node get released.
  async recoverStaleHolds() {
    const recovered = [];
    for (const [owner, meta] of [...this.heldByOwner]) {
      const inspected = await this.backend.inspect(meta.key);
      if (!inspected) {
        this._forgetLocal(owner, meta.key, meta.scope);
        recovered.push({ key: meta.key, owner, action: 'forgotten' });
        this.audit.record('recovery.forgotten', {
          key: meta.key,
          owner,
          nodeId: this.nodeId,
        });
      } else if (inspected.owner !== owner) {
        // Someone else owns this now — drop our local record, do not delete theirs.
        this._forgetLocal(owner, meta.key, meta.scope);
        recovered.push({ key: meta.key, owner, action: 'reassigned' });
        this.audit.record('recovery.reassigned', {
          key: meta.key,
          owner,
          newOwner: inspected.owner,
          nodeId: this.nodeId,
        });
      }
    }
    return recovered;
  }

  // Diagnostic: list locks this node currently holds.
  listHeld() {
    return [...this.heldByOwner.entries()].map(([owner, meta]) => ({
      owner,
      key: meta.key,
      scope: meta.scope,
      acquiredAt: meta.acquiredAt,
      ttlMs: meta.ttlMs,
      ageMs: Date.now() - meta.acquiredAt,
    }));
  }

  // Convenience wrapper for the common pattern.
  async withLock(opts, fn) {
    const handle = await this.acquire(opts);
    try {
      return await fn(handle);
    } finally {
      try {
        await handle.release();
      } catch {
        /* swallow; release errors are already audited */
      }
    }
  }
}

export {
  LockScope,
  buildKey,
  parseKey,
  MemoryBackend,
  RedisBackend,
  selectBackend,
};
