// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * High-concurrency nonce (sequence number) manager for Stellar relayer
 * accounts.
 *
 * Design:
 * - Sequence counters live in Redis (`INCR`) so several backend processes can
 *   share one atomic counter pool, while every account keeps a local memory
 *   mirror of the last allocated value. When Redis is unreachable the manager
 *   keeps allocating from the mirror instead of failing, then resynchronizes
 *   in the background (well inside the 500ms recovery budget).
 * - A pool of relayer accounts is rotated round-robin, so signing pressure is
 *   spread over N independent sequence counters.
 * - Reservations hold a sequence number until the transaction is committed,
 *   released or times out. Released/timed-out sequences go back into a per
 *   account free list and are handed out again first, so bursts never leave
 *   permanent sequence gaps or deadlocks behind.
 * - `txBAD_SEQ` (or any submission failure) triggers a non-blocking resync of
 *   the affected account: reservations keep flowing while the on-chain
 *   sequence is refetched.
 * - Prometheus metrics (depth, active reservations, free sequences, error and
 *   resync rates) are exported from ./nonceMetrics.js.
 */

import {
  nonceActiveReservations,
  nonceErrorsTotal,
  nonceFreeSequences,
  nonceReservationsTotal,
  nonceReserveLatency,
  nonceResyncTotal,
  nonceSequenceDepth,
} from './nonceMetrics.js';

/**
 * Lua script that only ever advances a counter: the key is bumped to `wanted`
 * when `wanted` is greater than the current value and never lowered. Exposed
 * so Redis clients and tests can recognize the exact operation.
 */
export const ADVANCE_KEY_LUA = `
local current = redis.call('GET', KEYS[1])
local wanted = ARGV[1]
if current == false or tonumber(wanted) > tonumber(current) then
  redis.call('SET', KEYS[1], wanted)
  current = wanted
end
return tonumber(current)
`;

/** Minimum Redis surface required by the manager. */
export interface RedisLike {
  incr(key: string): Promise<number>;
  eval(
    script: string,
    numberOfKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown>;
}

/** Returns the on-chain sequence number of a relayer account. */
export type FetchSequenceFn = (
  accountId: string
) => Promise<string | number | bigint>;

export interface NonceManagerOptions {
  /** Relayer accounts rotated round-robin (the spec targets 10). */
  accounts: string[];
  /** Reads the current on-chain sequence for an account. */
  fetchSequence: FetchSequenceFn;
  /** Optional Redis client; omit for single-process (memory only) mode. */
  redis?: RedisLike | null;
  /** Redis key prefix, defaults to `stellar:nonce`. */
  keyPrefix?: string;
  /** Auto-release delay for uncommitted reservations, defaults to 30s. */
  reservationTtlMs?: number;
  /** Delay before retrying after a Redis failure, defaults to 100ms. */
  redisRetryIntervalMs?: number;
  /** Clock override, used by tests. */
  clock?: () => number;
}

export interface Reservation {
  token: string;
  accountId: string;
  sequence: bigint;
  expiresAt: number;
  /** The transaction was accepted: the sequence number stays consumed. */
  commit(): void;
  /** The sequence number was not used and returns to the free list. */
  release(): void;
  /** Submission failed; resyncs the account when the error is txBAD_SEQ. */
  fail(error: unknown): void;
}

export interface AccountStats {
  accountId: string;
  lastAllocated: string | null;
  onChainSequence: string | null;
  activeReservations: number;
  freeSequences: number;
  degraded: boolean;
  initialized: boolean;
}

interface ReservationRecord {
  token: string;
  accountId: string;
  sequence: bigint;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  settled: boolean;
}

interface AccountState {
  accountId: string;
  key: string;
  /** Last sequence handed out (local mirror of the Redis counter). */
  last: bigint;
  /** Last sequence observed on chain. */
  onChain: bigint;
  /** Last value we saw from Redis for `key`, null until first contact. */
  keyValue: bigint | null;
  initialized: boolean;
  /** Released sequences waiting to be reused (gap fillers), newest first. */
  free: bigint[];
  active: Map<string, ReservationRecord>;
  degradedUntil: number;
  resyncPromise: Promise<void> | null;
  recoveryTimer: ReturnType<typeof setTimeout> | null;
}

type ErrorKind = 'bad_seq' | 'network' | 'timeout' | 'redis' | 'unknown';

function isBadSeqError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as Record<string, unknown>;
  if (candidate.code === 'txBAD_SEQ') return true;
  if (typeof candidate.message === 'string') {
    if (candidate.message.includes('txBAD_SEQ')) return true;
    if (candidate.message.includes('txbadseq')) return true;
  }
  const result = (candidate.result ?? candidate.errorResult) as
    Record<string, unknown> | undefined;
  const inner = result?.result as Record<string, unknown> | undefined;
  return inner?.name === 'txBAD_SEQ';
}

function classifyError(error: unknown): ErrorKind {
  if (isBadSeqError(error)) return 'bad_seq';
  if (!error || typeof error !== 'object') return 'unknown';
  const candidate = error as Record<string, unknown>;
  const code = typeof candidate.code === 'string' ? candidate.code : '';
  const message =
    typeof candidate.message === 'string' ? candidate.message : '';
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') return 'timeout';
  if (candidate.name === 'TimeoutError' || message.includes('timeout')) {
    return 'timeout';
  }
  if (
    code.startsWith('ECONN') ||
    code.startsWith('ENOTFOUND') ||
    code.startsWith('EAI_') ||
    message.includes('network')
  ) {
    return 'network';
  }
  return 'unknown';
}

function toBigInt(value: string | number | bigint): bigint {
  if (typeof value === 'bigint') return value;
  return BigInt(value);
}

export class NonceManager {
  #accounts: AccountState[];
  #cursor = 0;
  #fetchSequence: FetchSequenceFn;
  #redis: RedisLike | null;
  #keyPrefix: string;
  #ttlMs: number;
  #retryMs: number;
  #clock: () => number;
  #closed = false;
  #tokenCounter = 0;
  #byToken = new Map<string, AccountState>();

  constructor(options: NonceManagerOptions) {
    if (!options || !Array.isArray(options.accounts)) {
      throw new Error('NonceManager requires an accounts array');
    }
    if (options.accounts.length === 0) {
      throw new Error('NonceManager requires at least one relayer account');
    }
    if (typeof options.fetchSequence !== 'function') {
      throw new Error('NonceManager requires a fetchSequence function');
    }

    this.#fetchSequence = options.fetchSequence;
    this.#redis = options.redis ?? null;
    this.#keyPrefix = options.keyPrefix ?? 'stellar:nonce';
    this.#ttlMs = options.reservationTtlMs ?? 30_000;
    this.#retryMs = options.redisRetryIntervalMs ?? 100;
    this.#clock = options.clock ?? Date.now;
    this.#accounts = options.accounts.map((accountId) => ({
      accountId,
      key: `${this.#keyPrefix}:${accountId}`,
      last: 0n,
      onChain: 0n,
      keyValue: null,
      initialized: false,
      free: [],
      active: new Map(),
      degradedUntil: 0,
      resyncPromise: null,
      recoveryTimer: null,
    }));
  }

  /** Account ids in pool order. */
  get accounts(): string[] {
    return this.#accounts.map((state) => state.accountId);
  }

  /** Seeds every account in the pool from chain (and Redis when present). */
  async init(): Promise<void> {
    await Promise.all(this.#accounts.map((state) => this.#resync(state)));
  }

  /**
   * Reserve the next sequence number for one relayer account.
   *
   * Never blocks on a background resynchronization: only the very first call
   * per account waits for the initial on-chain read.
   */
  async reserve(): Promise<Reservation> {
    const state = this.#pick();
    const started = this.#clock();
    try {
      if (!state.initialized) {
        await this.#resync(state);
      }
      let sequence = state.free.pop();
      if (sequence === undefined) {
        sequence = await this.#allocate(state);
      }
      const record = this.#track(state, sequence);
      nonceReservationsTotal.inc({
        account: state.accountId,
        outcome: 'reserved',
      });
      this.#observe(state);
      return this.#expose(record);
    } catch (error) {
      nonceErrorsTotal.inc({
        account: state.accountId,
        type: classifyError(error),
      });
      nonceReservationsTotal.inc({
        account: state.accountId,
        outcome: 'failed',
      });
      throw error;
    } finally {
      nonceReserveLatency.observe(
        { account: state.accountId },
        Math.max(0, this.#clock() - started) / 1000
      );
    }
  }

  /** Mark a reservation as submitted; its sequence stays consumed. */
  commit(token: string): void {
    this.#settle(token, 'committed');
  }

  /** Return an unused sequence number to the account free list. */
  release(token: string): void {
    this.#settle(token, 'released');
  }

  /**
   * Submission failed: the sequence returns to the free list and a
   * txBAD_SEQ-style error schedules a non-blocking account resync.
   */
  fail(token: string, error: unknown): void {
    const state = this.#byToken.get(token);
    this.#settle(token, 'failed');
    if (state && isBadSeqError(error)) {
      nonceErrorsTotal.inc({ account: state.accountId, type: 'bad_seq' });
      this.#scheduleResync(state);
    }
  }

  /** Force a resynchronization of one account; resolves when it lands. */
  resyncAccount(accountId: string): Promise<void> {
    const state = this.#accounts.find((a) => a.accountId === accountId);
    if (!state) {
      return Promise.reject(new Error(`Unknown relayer account: ${accountId}`));
    }
    return this.#resync(state);
  }

  /** Snapshot used by tests, health endpoints and dashboards. */
  stats(): AccountStats[] {
    return this.#accounts.map((state) => ({
      accountId: state.accountId,
      lastAllocated: state.initialized ? state.last.toString() : null,
      onChainSequence: state.initialized ? state.onChain.toString() : null,
      activeReservations: state.active.size,
      freeSequences: state.free.length,
      degraded: state.degradedUntil > this.#clock(),
      initialized: state.initialized,
    }));
  }

  /** Clears all pending timers; reservations become unusable. */
  close(): void {
    this.#closed = true;
    for (const state of this.#accounts) {
      if (state.recoveryTimer) {
        clearTimeout(state.recoveryTimer);
        state.recoveryTimer = null;
      }
      for (const record of state.active.values()) {
        if (record.timer) clearTimeout(record.timer);
      }
      state.active.clear();
    }
    this.#byToken.clear();
  }

  #pick(): AccountState {
    const state = this.#accounts[this.#cursor % this.#accounts.length];
    this.#cursor = (this.#cursor + 1) % this.#accounts.length;
    return state;
  }

  #find(
    token: string
  ): { state: AccountState; record: ReservationRecord } | null {
    const state = this.#byToken.get(token);
    if (!state) return null;
    const record = state.active.get(token);
    if (!record || record.settled) return null;
    return { state, record };
  }

  #track(state: AccountState, sequence: bigint): ReservationRecord {
    this.#tokenCounter += 1;
    const record: ReservationRecord = {
      token: `${state.accountId}-${this.#tokenCounter}-${sequence}`,
      accountId: state.accountId,
      sequence,
      expiresAt: this.#clock() + this.#ttlMs,
      timer: null,
      settled: false,
    };
    state.active.set(record.token, record);
    this.#byToken.set(record.token, state);
    record.timer = setTimeout(() => {
      this.#settle(record.token, 'timed_out');
    }, this.#ttlMs);
    if (typeof record.timer.unref === 'function') {
      record.timer.unref();
    }
    return record;
  }

  #expose(record: ReservationRecord): Reservation {
    return {
      token: record.token,
      accountId: record.accountId,
      sequence: record.sequence,
      expiresAt: record.expiresAt,
      commit: () => this.commit(record.token),
      release: () => this.release(record.token),
      fail: (error: unknown) => this.fail(record.token, error),
    };
  }

  #settle(
    token: string,
    outcome: 'committed' | 'released' | 'failed' | 'timed_out'
  ): void {
    const found = this.#find(token);
    if (!found) return;
    const { state, record } = found;
    record.settled = true;
    if (record.timer) clearTimeout(record.timer);
    state.active.delete(token);
    this.#byToken.delete(token);

    const spent = outcome === 'committed' || record.sequence <= state.onChain;
    if (!spent) {
      // Keep the sequence usable so bursts leave no permanent gaps.
      state.free.push(record.sequence);
    }

    nonceReservationsTotal.inc({ account: state.accountId, outcome });
    this.#observe(state);
  }

  async #allocate(state: AccountState): Promise<bigint> {
    if (this.#redis) {
      const needsCatchUp =
        state.keyValue === null || state.last > state.keyValue;
      if (needsCatchUp) {
        const advanced = await this.#advanceRedis(state, state.last);
        if (advanced === null) {
          return this.#allocateFromMirror(state);
        }
      }
      try {
        const value = await this.#redis.incr(state.key);
        const sequence = BigInt(value);
        state.keyValue = sequence;
        state.last = sequence;
        return sequence;
      } catch {
        this.#markDegraded(state);
      }
    }
    return this.#allocateFromMirror(state);
  }

  #allocateFromMirror(state: AccountState): bigint {
    state.last += 1n;
    return state.last;
  }

  /** Advance-only counter bump; returns null when Redis is unavailable. */
  async #advanceRedis(
    state: AccountState,
    target: bigint
  ): Promise<bigint | null> {
    if (!this.#redis) return null;
    try {
      const result = await this.#redis.eval(
        ADVANCE_KEY_LUA,
        1,
        state.key,
        target.toString()
      );
      const value = BigInt(
        typeof result === 'number' ? result : Number(result)
      );
      state.keyValue = value;
      state.degradedUntil = 0;
      if (value > state.last) state.last = value;
      return value;
    } catch {
      this.#markDegraded(state);
      return null;
    }
  }

  #markDegraded(state: AccountState): void {
    nonceErrorsTotal.inc({ account: state.accountId, type: 'redis' });
    state.degradedUntil = this.#clock() + this.#retryMs;
    if (this.#closed || state.recoveryTimer) return;
    state.recoveryTimer = setTimeout(() => {
      state.recoveryTimer = null;
      this.#scheduleResync(state);
    }, this.#retryMs);
    if (typeof state.recoveryTimer.unref === 'function') {
      state.recoveryTimer.unref();
    }
  }

  #scheduleResync(state: AccountState): void {
    if (this.#closed) return;
    this.#resync(state).catch(() => {
      // #resync already recorded the metrics; retry while still degraded.
      if (!this.#closed && state.degradedUntil > this.#clock()) {
        this.#markDegraded(state);
      }
    });
  }

  #resync(state: AccountState): Promise<void> {
    if (state.resyncPromise) return state.resyncPromise;
    const promise = this.#runResync(state);
    state.resyncPromise = promise;
    promise
      .catch(() => undefined)
      .then(() => {
        if (state.resyncPromise === promise) state.resyncPromise = null;
      });
    return promise;
  }

  async #runResync(state: AccountState): Promise<void> {
    try {
      const onChain = toBigInt(await this.#fetchSequence(state.accountId));
      const target = this.#target(state, onChain);

      state.onChain = onChain;
      state.last = target;
      // Anything at or below the on-chain sequence is already spent.
      state.free = state.free.filter((seq) => seq > onChain);

      if (this.#redis) {
        await this.#advanceRedis(state, target);
      }

      state.initialized = true;
      nonceResyncTotal.inc({ account: state.accountId, outcome: 'success' });
      this.#observe(state);
    } catch (error) {
      nonceResyncTotal.inc({ account: state.accountId, outcome: 'failure' });
      nonceErrorsTotal.inc({
        account: state.accountId,
        type: classifyError(error),
      });
      throw error;
    }
  }

  /** Highest sequence we may not reissue: chain, mirror or in-flight ones. */
  #target(state: AccountState, onChain: bigint): bigint {
    let target = onChain > state.last ? onChain : state.last;
    for (const record of state.active.values()) {
      if (record.sequence > target) target = record.sequence;
    }
    return target;
  }

  #observe(state: AccountState): void {
    nonceSequenceDepth.set({ account: state.accountId }, Number(state.last));
    nonceActiveReservations.set(
      { account: state.accountId },
      state.active.size
    );
    nonceFreeSequences.set({ account: state.accountId }, state.free.length);
  }
}

/**
 * Convenience factory matching the other stellar services.
 */
export function createNonceManager(options: NonceManagerOptions): NonceManager {
  return new NonceManager(options);
}
