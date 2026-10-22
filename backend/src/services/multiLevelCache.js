// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { Counter } from 'prom-client';
import redisService from './redisService.js';

const L1_TTL_MS = 30_000;
const L1_MAX_ENTRIES = 1000;
const L1_MAX_BYTES = 100 * 1024 * 1024;
const L2_TTL_S = 300;
const INVALIDATION_CHANNEL = 'cache:invalidate';
const SCAN_COUNT = 100;

export const tieredCacheMetrics = {
  hits: new Counter({
    name: 'soroban_cache_tier_hits_total',
    help: 'Cache hits by tier',
    labelNames: ['tier'],
  }),
  misses: new Counter({
    name: 'soroban_cache_tier_misses_total',
    help: 'Cache misses by tier',
    labelNames: ['tier'],
  }),
  evictions: new Counter({
    name: 'soroban_cache_l1_evictions_total',
    help: 'L1 entries evicted to enforce cache limits',
  }),
};

class LruKStore {
  constructor({ maxEntries, maxBytes, ttlMs, sizeCalculation, onEvict }) {
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.ttlMs = ttlMs;
    this.sizeCalculation = sizeCalculation;
    this.onEvict = onEvict;
    this.entries = new Map();
    this.calculatedSize = 0;
    this.clock = 0;
  }

  get size() {
    return this.entries.size;
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.delete(key);
      return undefined;
    }
    this.#recordAccess(entry);
    return entry.value;
  }

  has(key) {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (entry.expiresAt <= Date.now()) {
      this.delete(key);
      return false;
    }
    return true;
  }

  set(key, value, { ttl = this.ttlMs } = {}) {
    const size = this.sizeCalculation(key, value);
    const previous = this.entries.get(key);
    const previousAccesses =
      previous && previous.expiresAt > Date.now() ? previous.accesses : [];
    if (previous) this.#remove(key);

    if (size > this.maxBytes) return false;

    const entry = {
      value,
      size,
      expiresAt: Date.now() + ttl,
      accesses: previousAccesses,
    };
    this.#recordAccess(entry);
    this.entries.set(key, entry);
    this.calculatedSize += size;

    this.#purgeExpired();
    while (
      this.entries.size > this.maxEntries ||
      this.calculatedSize > this.maxBytes
    ) {
      const evictedKey = this.#evictLruK();
      if (evictedKey === undefined) break;
      this.onEvict();
    }
    return this.entries.has(key);
  }

  delete(key) {
    return this.#remove(key);
  }

  *keys() {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= Date.now()) {
        this.#remove(key);
      } else {
        yield key;
      }
    }
  }

  clear() {
    this.entries.clear();
    this.calculatedSize = 0;
  }

  #recordAccess(entry) {
    entry.accesses.push(++this.clock);
    if (entry.accesses.length > 2) entry.accesses.shift();
  }

  #remove(key) {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    this.calculatedSize -= entry.size;
    return true;
  }

  #purgeExpired() {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.#remove(key);
    }
  }

  #evictLruK() {
    let candidateKey;
    let candidatePriority = Infinity;
    let candidateFirstAccess = Infinity;

    for (const [key, entry] of this.entries) {
      const firstAccess = entry.accesses[0] ?? 0;
      const priority =
        entry.accesses.length < 2 ? -Infinity : entry.accesses[0];
      if (
        priority < candidatePriority ||
        (priority === candidatePriority &&
          firstAccess < candidateFirstAccess)
      ) {
        candidateKey = key;
        candidatePriority = priority;
        candidateFirstAccess = firstAccess;
      }
    }

    if (candidateKey !== undefined) this.#remove(candidateKey);
    return candidateKey;
  }
}

export class TieredCache {
  /**
   * @param {object} opts
   * @param {number} [opts.l1TtlMs] L1 TTL in milliseconds
   * @param {number} [opts.maxL1] Maximum number of L1 entries
   * @param {number} [opts.maxL1Bytes] Maximum estimated L1 payload size
   * @param {number} [opts.l2TtlS] L2 TTL in seconds
   * @param {object} [opts.redis] Redis service compatible with redisService
   * @param {(key: string, value: *) => number} [opts.sizeCalculation]
   * @param {string} [opts.invalidationChannel]
   */
  constructor(opts = {}) {
    this.redis = opts.redis ?? redisService;
    this.l1TtlMs = opts.l1TtlMs ?? L1_TTL_MS;
    this.l2TtlS = opts.l2TtlS ?? L2_TTL_S;
    this.invalidationChannel =
      opts.invalidationChannel ?? INVALIDATION_CHANNEL;
    this.inflight = new Map();
    this.generations = new Map();
    this.l1 = new LruKStore({
      maxEntries: opts.maxL1 ?? L1_MAX_ENTRIES,
      maxBytes: opts.maxL1Bytes ?? L1_MAX_BYTES,
      ttlMs: this.l1TtlMs,
      sizeCalculation:
        opts.sizeCalculation ??
        ((key, value) => {
          const serialized = JSON.stringify(value);
          if (serialized === undefined) {
            throw new TypeError('Cache values must be JSON-serializable');
          }
          return Buffer.byteLength(key) + Buffer.byteLength(serialized) + 64;
        }),
      onEvict: () => tieredCacheMetrics.evictions.inc(),
    });
    this.onInvalidation = (payload) => this.applyRemoteInvalidation(payload);
    this.subscription = this.redis.subscribe?.(
      this.invalidationChannel,
      this.onInvalidation
    );
    this.subscription?.catch((error) => {
      console.error('[TieredCache] invalidation subscription failed:', error);
    });
  }

  /**
   * Retrieve from L1, then Redis, then fetchFn. Concurrent requests for one
   * key share the entire miss path, including the Redis lookup.
   */
  async get(key, fetchFn) {
    key = String(key);
    const l1Value = this.l1.get(key);
    if (l1Value !== undefined) {
      tieredCacheMetrics.hits.inc({ tier: 'l1' });
      return l1Value;
    }

    tieredCacheMetrics.misses.inc({ tier: 'l1' });
    const pending = this.inflight.get(key);
    if (pending) return pending;

    const promise = this.#load(key, fetchFn)
      .finally(() => {
        if (this.inflight.get(key) === promise) {
          this.inflight.delete(key);
          this.generations.delete(key);
        }
      });
    this.inflight.set(key, promise);
    return promise;
  }

  async #load(key, fetchFn) {
    let generation = this.#generation(key);

    while (true) {
      const l2Raw = await this.redis.get(key);
      if (generation !== this.#generation(key)) {
        generation = this.#generation(key);
        continue;
      }
      if (l2Raw !== null) {
        tieredCacheMetrics.hits.inc({ tier: 'l2' });
        const value = this.#safeParse(l2Raw);
        this.l1.set(key, value);
        return value;
      }

      tieredCacheMetrics.misses.inc({ tier: 'l2' });
      const value = await fetchFn();
      if (generation !== this.#generation(key)) {
        generation = this.#generation(key);
        continue;
      }
      if (value !== undefined && value !== null) {
        let serialized;
        try {
          serialized = JSON.stringify(value);
        } catch (error) {
          console.error('[TieredCache] value serialization failed:', error);
          return value;
        }
        if (serialized !== undefined) {
          this.l1.set(key, value);
          await this.redis.set(key, serialized, this.l2TtlS);
          if (generation !== this.#generation(key)) {
            this.l1.delete(key);
            await this.redis.delete(key);
            generation = this.#generation(key);
            continue;
          }
        }
      }
      return value;
    }
  }

  async has(key) {
    key = String(key);
    if (this.l1.has(key)) {
      tieredCacheMetrics.hits.inc({ tier: 'l1' });
      return true;
    }
    tieredCacheMetrics.misses.inc({ tier: 'l1' });
    const l2Value = await this.redis.get(key);
    if (l2Value !== null) {
      tieredCacheMetrics.hits.inc({ tier: 'l2' });
      return true;
    }
    tieredCacheMetrics.misses.inc({ tier: 'l2' });
    return false;
  }

  get size() {
    return this.l1.size;
  }

  async invalidate(key, { broadcast = true } = {}) {
    key = String(key);
    this.invalidateLocal(key);
    await this.redis.delete(key);
    if (broadcast) {
      await this.#publishInvalidation({ keys: [key] });
    }
  }

  invalidateLocal(key) {
    key = String(key);
    this.#bumpGeneration(key);
    return this.l1.delete(key);
  }

  async invalidatePattern(prefix, { broadcast = true } = {}) {
    this.invalidatePatternLocal(prefix);
    if (!this.redis.isFallbackMode && this.redis.client) {
      let cursor = '0';
      do {
        const [next, keys] = await this.redis.client.scan(
          cursor,
          'MATCH',
          `${prefix}*`,
          'COUNT',
          SCAN_COUNT
        );
        cursor = next;
        if (keys.length) await this.redis.client.del(...keys);
      } while (cursor !== '0');
    } else if (typeof this.redis.localCache?.keys === 'function') {
      for (const key of this.redis.localCache.keys()) {
        if (key.startsWith(prefix)) this.redis.localCache.delete(key);
      }
    }
    if (broadcast) {
      await this.#publishInvalidation({ prefix });
    }
  }

  invalidatePatternLocal(prefix) {
    const localKeys = new Set(
      [...this.l1.keys()].filter((key) => key.startsWith(prefix))
    );
    for (const key of localKeys) {
      this.invalidateLocal(key);
    }
    for (const key of this.inflight.keys()) {
      if (key.startsWith(prefix) && !localKeys.has(key)) {
        this.#bumpGeneration(key);
      }
    }
  }

  applyRemoteInvalidation(payload) {
    let message = payload;
    if (typeof payload === 'string') {
      try {
        message = JSON.parse(payload);
      } catch {
        return;
      }
    }
    if (!message || typeof message !== 'object') return;
    if (Array.isArray(message.keys)) {
      for (const key of message.keys) this.invalidateLocal(key);
    }
    if (typeof message.prefix === 'string') {
      this.invalidatePatternLocal(message.prefix);
    }
  }

  clear() {
    this.invalidatePatternLocal('');
    this.l1.clear();
  }

  async close() {
    if (this.subscription) {
      await this.redis.unsubscribe?.(
        this.invalidationChannel,
        this.onInvalidation
      );
      this.subscription = null;
    }
  }

  #generation(key) {
    return this.generations.get(key) || 0;
  }

  #bumpGeneration(key) {
    if (!this.inflight.has(key)) return;
    this.generations.set(key, this.#generation(key) + 1);
  }

  async #publishInvalidation(message) {
    await this.redis.publish?.(this.invalidationChannel, message);
  }

  #safeParse(raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
}

export const MultiLevelCache = TieredCache;
export const multiLevelCache = new TieredCache();
export default multiLevelCache;
