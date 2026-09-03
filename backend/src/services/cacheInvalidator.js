// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Distributed cache invalidation with tag-based dependency purging.
 *
 * Ledger / Soroban contract events map onto cache tags (contract, ledger,
 * market, event type). Invalidating a tag deletes every key that registered
 * that tag, then publishes the purge so other API processes drop their L1
 * copies. Redis is used when available; otherwise an in-process index is used.
 */

import redisService from './redisService.js';
import multiLevelCache from './multiLevelCache.js';

export const INVALIDATION_CHANNEL = 'cache:invalidate';
export const TAG_SET_PREFIX = 'cache:tag:';
export const KEY_TAGS_PREFIX = 'cache:keytags:';
export const CONTRACT_CACHE_PREFIXES = [
  'contract:',
  'events:',
  'ledger:',
  'prediction:',
  'invoke:',
  'deploy:',
  'oracle:',
];

const TAG_TTL_SECONDS = 86_400;

function unique(values) {
  return [...new Set((values || []).filter(Boolean).map(String))];
}

function tagKey(tag) {
  return `${TAG_SET_PREFIX}${tag}`;
}

function keyTagsKey(cacheKey) {
  return `${KEY_TAGS_PREFIX}${cacheKey}`;
}

function tagsForLedgerEvent(event = {}) {
  const tags = ['ledger', 'contract'];
  const contractId = event.contractId || event.contract_id;
  const ledger = event.ledgerSequence ?? event.ledger;
  const topics = Array.isArray(event.topics)
    ? event.topics
    : Array.isArray(event.topic)
      ? event.topic
      : [];

  if (contractId) {
    tags.push(`contract:${contractId}`);
  }
  if (ledger != null && ledger !== '') {
    tags.push(`ledger:${ledger}`);
  }

  const topic0 = topics[0];
  if (topic0 != null) {
    tags.push(`event:${topic0}`);
  }

  const marketId = topics[1] ?? event.marketId ?? event.value?.market_id;
  if (marketId != null && marketId !== '') {
    tags.push(`market:${marketId}`);
  }

  return unique(tags);
}

export class CacheInvalidator {
  constructor({
    redis = redisService,
    localCache = multiLevelCache,
    channel = INVALIDATION_CHANNEL,
  } = {}) {
    this.redis = redis;
    this.localCache = localCache;
    this.channel = channel;
    this.localTags = new Map();
    this.localKeyTags = new Map();
    this.subscriber = null;
    this.started = false;
    this.stats = {
      tagPurges: 0,
      keysDeleted: 0,
      ledgerEvents: 0,
      pubsubReceived: 0,
    };
  }

  /**
   * Remember that `cacheKey` depends on `tags` so a later tag purge can find it.
   */
  async remember(cacheKey, tags, ttlSeconds = TAG_TTL_SECONDS) {
    const key = String(cacheKey);
    const normalized = unique(tags);
    if (!key || normalized.length === 0) return 0;

    this.#rememberLocal(key, normalized);

    const client = this.#redisClient();
    if (!client) return normalized.length;

    const pipeline = client.pipeline();
    pipeline.sadd(keyTagsKey(key), ...normalized);
    pipeline.expire(keyTagsKey(key), ttlSeconds);
    for (const tag of normalized) {
      pipeline.sadd(tagKey(tag), key);
      pipeline.expire(tagKey(tag), ttlSeconds);
    }
    await pipeline.exec();
    return normalized.length;
  }

  /**
   * Delete every key attached to the given tags, including local L1 entries.
   * When `broadcast` is true (default) other processes are notified over Redis.
   */
  async invalidateTags(tags, { reason = 'tag', broadcast = true } = {}) {
    const normalized = unique(tags);
    if (normalized.length === 0) {
      return { tags: [], keys: [] };
    }

    const keys = new Set();
    for (const tag of normalized) {
      for (const key of this.localTags.get(tag) || []) {
        keys.add(key);
      }
    }

    const client = this.#redisClient();
    if (client) {
      for (const tag of normalized) {
        const members = await client.smembers(tagKey(tag));
        for (const member of members || []) {
          keys.add(member);
        }
      }
    }

    const deleted = await this.#deleteKeys([...keys]);
    if (client && normalized.length > 0) {
      await client.del(...normalized.map(tagKey));
    }
    for (const tag of normalized) {
      this.localTags.delete(tag);
    }

    this.stats.tagPurges += normalized.length;
    this.stats.keysDeleted += deleted;

    if (broadcast) {
      await this.#publish({
        tags: normalized,
        keys: [...keys],
        reason,
        at: new Date().toISOString(),
      });
    }

    return { tags: normalized, keys: [...keys], deleted };
  }

  /**
   * Drop every contract-related cache prefix plus the derived event tags.
   * Called whenever a new ledger event is published by the indexer.
   */
  async invalidateForLedgerEvent(event, { broadcast = true } = {}) {
    this.stats.ledgerEvents += 1;
    const tags = tagsForLedgerEvent(event);
    const prefixDeleted = await this.#invalidateContractPrefixes(event);
    const tagged = await this.invalidateTags(tags, {
      reason: 'ledger-event',
      broadcast,
    });
    return {
      tags,
      prefixDeleted,
      keys: tagged.keys,
      deleted: tagged.deleted + prefixDeleted,
    };
  }

  async invalidateForLedgerEvents(events = []) {
    let deleted = 0;
    const tags = new Set();
    for (const event of events) {
      const result = await this.invalidateForLedgerEvent(event, {
        broadcast: false,
      });
      deleted += result.deleted;
      for (const tag of result.tags) tags.add(tag);
    }
    const collected = [...tags];
    if (collected.length > 0) {
      await this.#publish({
        tags: collected,
        reason: 'ledger-batch',
        count: events.length,
        at: new Date().toISOString(),
      });
    }
    return { tags: collected, deleted, count: events.length };
  }

  async start() {
    if (this.started) return this;
    this.started = true;

    try {
      const { registerHandler } = await import('./contractEventParser.js');
      registerHandler('*', (parsed) => {
        this.invalidateForLedgerEvent(parsed).catch((err) => {
          console.error('[CacheInvalidator] ledger purge failed:', err.message);
        });
      });
    } catch (err) {
      console.warn(
        '[CacheInvalidator] event parser not attached:',
        err.message
      );
    }

    const client = this.#redisClient();
    if (!client || typeof client.duplicate !== 'function') {
      return this;
    }

    try {
      this.subscriber = client.duplicate();
      this.subscriber.on('error', (err) => {
        console.warn('[CacheInvalidator] subscriber error:', err.message);
      });
      await this.subscriber.subscribe(this.channel);
      this.subscriber.on('message', (channel, payload) => {
        if (channel !== this.channel) return;
        this.applyRemoteInvalidation(payload);
      });
    } catch (err) {
      console.warn('[CacheInvalidator] pub/sub unavailable:', err.message);
      this.subscriber = null;
    }

    return this;
  }

  async stop() {
    this.started = false;
    if (this.subscriber) {
      try {
        await this.subscriber.unsubscribe(this.channel);
        await this.subscriber.quit();
      } catch {
        try {
          this.subscriber.disconnect();
        } catch {
          // already gone
        }
      }
      this.subscriber = null;
    }
  }

  getStatus() {
    return {
      started: this.started,
      pubsub: Boolean(this.subscriber),
      redis: Boolean(this.#redisClient()),
      localTags: this.localTags.size,
      ...this.stats,
    };
  }

  tagsForLedgerEvent(event) {
    return tagsForLedgerEvent(event);
  }

  #rememberLocal(key, tags) {
    const existing = this.localKeyTags.get(key) || new Set();
    for (const tag of tags) {
      existing.add(tag);
      if (!this.localTags.has(tag)) this.localTags.set(tag, new Set());
      this.localTags.get(tag).add(key);
    }
    this.localKeyTags.set(key, existing);
  }

  async #deleteKeys(keys) {
    let deleted = 0;
    for (const key of keys) {
      if (this.localCache?.l1?.delete) {
        this.localCache.l1.delete(key);
      } else if (typeof this.localCache?.invalidate === 'function') {
        await this.localCache.invalidate(key);
      }
      const client = this.#redisClient();
      if (client) {
        await client.del(key, keyTagsKey(key));
      } else if (typeof this.redis?.delete === 'function') {
        await this.redis.delete(key);
      }
      const ownedTags = this.localKeyTags.get(key);
      if (ownedTags) {
        for (const tag of ownedTags) {
          this.localTags.get(tag)?.delete(key);
        }
        this.localKeyTags.delete(key);
      }
      deleted += 1;
    }
    return deleted;
  }

  async #invalidateContractPrefixes(event) {
    let deleted = 0;
    const prefixes = [...CONTRACT_CACHE_PREFIXES];
    const contractId = event?.contractId || event?.contract_id;
    if (contractId) {
      prefixes.push(`contract:${contractId}`);
    }
    for (const prefix of unique(prefixes)) {
      if (typeof this.localCache?.invalidatePattern === 'function') {
        await this.localCache.invalidatePattern(prefix);
        deleted += 1;
      }
    }
    return deleted;
  }

  async #publish(message) {
    const client = this.#redisClient();
    if (!client || typeof client.publish !== 'function') return;
    try {
      await client.publish(this.channel, JSON.stringify(message));
    } catch (err) {
      console.warn('[CacheInvalidator] publish failed:', err.message);
    }
  }

  applyRemoteInvalidation(payload) {
    this.stats.pubsubReceived += 1;
    let parsed = payload;
    if (typeof payload === 'string') {
      try {
        parsed = JSON.parse(payload);
      } catch {
        return;
      }
    }
    const keys = parsed?.keys || [];
    for (const key of keys) {
      this.localCache?.l1?.delete?.(key);
      const ownedTags = this.localKeyTags.get(key);
      if (ownedTags) {
        for (const tag of ownedTags) {
          this.localTags.get(tag)?.delete(key);
        }
        this.localKeyTags.delete(key);
      }
    }
    for (const tag of parsed?.tags || []) {
      this.localTags.delete(tag);
    }
  }

  #redisClient() {
    if (this.redis?.isFallbackMode) return null;
    return this.redis?.client || null;
  }
}

export const cacheInvalidator = new CacheInvalidator();
export default cacheInvalidator;
