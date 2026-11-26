// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import crypto from 'crypto';
import Redis from 'ioredis';
import redisService from './redisService.js';
import { getDatabase } from '../database/connection.js';

const FLAGS_CACHE_KEY = 'feature_flags:all';
const FLAG_TTL_S = 60;
const INVALIDATE_CHANNEL = 'feature_flags:invalidate';

/**
 * MurmurHash3 (x86, 32-bit) implementation.
 * Used for deterministic percentage bucketing.
 */
export function murmurHash3(key, seed = 0) {
  const data = Buffer.from(String(key), 'utf8');
  const len = data.length;
  const nblocks = Math.floor(len / 4);
  let h1 = seed >>> 0;
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;

  for (let i = 0; i < nblocks; i++) {
    let k1 = data.readUInt32LE(i * 4);
    k1 = Math.imul(k1, c1);
    k1 = (k1 << 15) | (k1 >>> 17);
    k1 = Math.imul(k1, c2);

    h1 ^= k1;
    h1 = (h1 << 13) | (h1 >>> 19);
    h1 = (Math.imul(h1, 5) + 0xe6546b64) | 0;
  }

  const tailIndex = nblocks * 4;
  let k1 = 0;
  switch (len & 3) {
    case 3:
      k1 ^= data[tailIndex + 2] << 16;
    // falls through
    case 2:
      k1 ^= data[tailIndex + 1] << 8;
    // falls through
    case 1:
      k1 ^= data[tailIndex];
      k1 = Math.imul(k1, c1);
      k1 = (k1 << 15) | (k1 >>> 17);
      k1 = Math.imul(k1, c2);
      h1 ^= k1;
  }

  h1 ^= len;
  h1 ^= h1 >>> 16;
  h1 = Math.imul(h1, 0x85ebca6b);
  h1 ^= h1 >>> 13;
  h1 = Math.imul(h1, 0xc2b2ae35);
  h1 ^= h1 >>> 16;
  return h1 >>> 0;
}

/**
 * Deterministic bucket in [0, 100) for a flag + subject key.
 */
export function rolloutBucket(flagKey, subjectKey) {
  return murmurHash3(`${flagKey}:${subjectKey}`) % 100;
}

function parseJSONArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || value.length === 0) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

class FeatureFlagService {
  constructor() {
    // Pub/Sub requires a SEPARATE ioredis connection — a connection in subscriber
    // mode cannot execute regular commands (GET/SET/DEL). Regular Redis ops use
    // redisService.client; this subClient is exclusively for .subscribe().
    this.subClient = null;
    this.inflightLoad = null;
  }

  async initialize() {
    this.initSubscriber();
    await this.loadFlags().catch(() => {});
  }

  initSubscriber() {
    if (
      !redisService.isFallbackMode &&
      redisService.client &&
      redisService.client.status === 'ready'
    ) {
      this.subClient = new Redis(
        process.env.REDIS_URL || 'redis://localhost:6379',
        {
          maxRetriesPerRequest: 1,
          connectTimeout: 5000,
          connectionName: 'feature-flags-sub',
        }
      );
      this.subClient.on('error', () => {
        // subscriber is best-effort; swallow to avoid unhandled rejection spam
      });
      this.subClient.subscribe(INVALIDATE_CHANNEL).catch(() => {});
      this.subClient.on('message', (channel) => {
        if (channel === INVALIDATE_CHANNEL) {
          // Drop local in-memory/in-flight state and the shared cache entry so
          // every cluster instance reloads from the database on next evaluate.
          this.inflightLoad = null;
          redisService.delete(FLAGS_CACHE_KEY).catch(() => {});
        }
      });
    }
  }

  async loadFlags() {
    if (this.inflightLoad) return this.inflightLoad;

    const cached = await redisService.get(FLAGS_CACHE_KEY);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        // corrupted cache — fall through to reload
      }
    }

    this.inflightLoad = this._fetchAndCache().finally(() => {
      this.inflightLoad = null;
    });
    return this.inflightLoad;
  }

  async _fetchAndCache() {
    const db = getDatabase();
    const flags = await db.all('SELECT * FROM feature_flags');
    const cohorts = await db.all('SELECT * FROM flag_cohorts');
    const data = { flags, cohorts };
    await redisService.set(FLAGS_CACHE_KEY, JSON.stringify(data), FLAG_TTL_S);
    return data;
  }

  /**
   * Evaluation order:
   * 1. Unknown flag -> false
   * 2. Environment scoping: flag.environment (if set) must match context.environment
   * 3. Cohort override (cohortId) -> explicit enabled/disabled
   * 4. Segment rules: flag.segments (admin, beta-testers, network:<name>) — if the
   *    flag declares segments, context must match at least one of them
   * 5. Global kill switch: enabled=0 -> false
   * 6. Full rollout: rollout_pct=100 -> true
   * 7. Subject key (userId, else publicKey) required for hashing -> false otherwise
   * 8. Deterministic MurmurHash3 percentage bucket per (flagKey, subject)
   */
  async evaluate(flagKey, context = {}) {
    const { flags, cohorts } = await this.loadFlags();
    const flag = flags.find((f) => f.key === flagKey);
    if (!flag) return false;

    if (flag.environment && context.environment !== flag.environment) {
      return false;
    }

    if (context.cohortId) {
      const cohort = cohorts.find(
        (c) => c.flag_key === flagKey && c.cohort_id === context.cohortId
      );
      if (cohort) return !!cohort.enabled;
    }

    const segments = parseJSONArray(flag.segments);
    if (segments.length > 0 && !this._matchesSegments(segments, context)) {
      return false;
    }

    if (!flag.enabled) return false;
    if (flag.rollout_pct >= 100) return true;

    const subject = context.userId ?? context.publicKey;
    if (!subject) return false;

    return rolloutBucket(flagKey, subject) < flag.rollout_pct;
  }

  _matchesSegments(segments, context) {
    const ctxSegments = new Set(parseJSONArray(context.segments));
    if (context.isAdmin) ctxSegments.add('admin');
    if (context.isBetaTester) ctxSegments.add('beta-testers');
    if (context.network) ctxSegments.add(`network:${context.network}`);
    return segments.some((s) => ctxSegments.has(s));
  }

  async invalidate() {
    await redisService.delete(FLAGS_CACHE_KEY);
    if (!redisService.isFallbackMode && redisService.client) {
      await redisService.client.publish(INVALIDATE_CHANNEL, '1');
    }
  }

  async listFlags() {
    const db = getDatabase();
    return db.all('SELECT * FROM feature_flags ORDER BY created_at DESC');
  }

  async getFlag(key) {
    const db = getDatabase();
    return db.get('SELECT * FROM feature_flags WHERE key = ?', [key]);
  }

  async createFlag({
    key,
    enabled = 0,
    rollout_pct = 0,
    description = '',
    environment = null,
    segments = [],
  }) {
    const db = getDatabase();
    await db.run(
      'INSERT INTO feature_flags (key, enabled, rollout_pct, description, environment, segments) VALUES (?, ?, ?, ?, ?, ?)',
      [
        key,
        enabled ? 1 : 0,
        rollout_pct,
        description,
        environment,
        JSON.stringify(segments ?? []),
      ]
    );
    await this.invalidate();
    return this.getFlag(key);
  }

  async updateFlag(key, updates = {}) {
    const db = getDatabase();
    const flag = await this.getFlag(key);
    if (!flag) return null;

    const enabled =
      updates.enabled !== undefined ? (updates.enabled ? 1 : 0) : flag.enabled;
    const rollout_pct =
      updates.rollout_pct !== undefined
        ? updates.rollout_pct
        : flag.rollout_pct;
    const description =
      updates.description !== undefined
        ? updates.description
        : flag.description;
    const environment =
      updates.environment !== undefined
        ? updates.environment
        : flag.environment ?? null;
    const segments =
      updates.segments !== undefined
        ? JSON.stringify(updates.segments ?? [])
        : flag.segments ?? '[]';

    await db.run(
      'UPDATE feature_flags SET enabled = ?, rollout_pct = ?, description = ?, environment = ?, segments = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?',
      [enabled, rollout_pct, description, environment, segments, key]
    );
    await this.invalidate();
    return this.getFlag(key);
  }

  async deleteFlag(key) {
    const db = getDatabase();
    const result = await db.run('DELETE FROM feature_flags WHERE key = ?', [
      key,
    ]);
    await this.invalidate();
    return result.changes > 0;
  }

  async listCohorts(flagKey) {
    const db = getDatabase();
    return db.all(
      'SELECT * FROM flag_cohorts WHERE flag_key = ? ORDER BY created_at DESC',
      [flagKey]
    );
  }

  async addCohort(flagKey, cohortId, enabled = 1) {
    const db = getDatabase();
    await db.run(
      'INSERT INTO flag_cohorts (flag_key, cohort_id, enabled) VALUES (?, ?, ?) ON CONFLICT(flag_key, cohort_id) DO UPDATE SET enabled = excluded.enabled',
      [flagKey, cohortId, enabled ? 1 : 0]
    );
    await this.invalidate();
  }

  async removeCohort(flagKey, cohortId) {
    const db = getDatabase();
    const result = await db.run(
      'DELETE FROM flag_cohorts WHERE flag_key = ? AND cohort_id = ?',
      [flagKey, cohortId]
    );
    await this.invalidate();
    return result.changes > 0;
  }
}

export const featureFlagService = new FeatureFlagService();
export default featureFlagService;
