// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// Shared vote storage. Decouples consensus from where votes live so the
// same coordinator code works against an in-memory map (tests, single
// process) or Redis (clustered deployment).
//
// Schema, conceptually:
//   votes:<proofId> = HASH<nodeId, JSON{vote, signature, ts}>
// Each proof key has a TTL after which the votes age out automatically.

const KEY_PREFIX = 'oracle:votes';

function proofKey(proofId) {
  return `${KEY_PREFIX}:${proofId}`;
}

function envelope(vote, signature, ts) {
  return JSON.stringify({ vote, signature: signature || null, ts });
}

function parseEnvelope(raw) {
  try {
    const parsed = JSON.parse(raw);
    return { vote: parsed.vote, signature: parsed.signature, ts: parsed.ts };
  } catch {
    return null;
  }
}

export class MemoryVoteStore {
  constructor({ defaultTtlMs = 5 * 60_000, now = () => Date.now() } = {}) {
    this.store = new Map(); // proofId -> { expiresAt, votes: Map<nodeId, env> }
    this.defaultTtlMs = defaultTtlMs;
    this.now = now;
    this.name = 'memory';
  }

  _gc(proofId) {
    const entry = this.store.get(proofId);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= this.now()) {
      this.store.delete(proofId);
      return null;
    }
    return entry;
  }

  async put(proofId, nodeId, vote, signature, ttlMs) {
    let entry = this._gc(proofId);
    if (!entry) {
      const ttl = ttlMs ?? this.defaultTtlMs;
      entry = {
        expiresAt: ttl > 0 ? this.now() + ttl : null,
        votes: new Map(),
      };
      this.store.set(proofId, entry);
    }
    entry.votes.set(nodeId, {
      vote,
      signature: signature || null,
      ts: this.now(),
    });
    return true;
  }

  async get(proofId) {
    const entry = this._gc(proofId);
    if (!entry) return new Map();
    return new Map(entry.votes);
  }

  async tally(proofId) {
    const votes = await this.get(proofId);
    const counts = new Map();
    for (const { vote } of votes.values()) {
      const key = JSON.stringify(vote);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const results = [...counts.entries()]
      .map(([k, count]) => ({ vote: JSON.parse(k), count }))
      .sort((a, b) => b.count - a.count);
    return { totalVotes: votes.size, results };
  }

  async forget(proofId) {
    this.store.delete(proofId);
  }

  async listProofs() {
    const out = [];
    for (const [proofId] of this.store) {
      if (this._gc(proofId)) out.push(proofId);
    }
    return out;
  }

  // Test helper — clears state
  _clear() {
    this.store.clear();
  }
}

export class RedisVoteStore {
  constructor(client, { defaultTtlMs = 5 * 60_000 } = {}) {
    if (!client) throw new Error('RedisVoteStore requires an ioredis client');
    this.client = client;
    this.defaultTtlMs = defaultTtlMs;
    this.name = 'redis';
  }

  async put(proofId, nodeId, vote, signature, ttlMs) {
    const key = proofKey(proofId);
    const ts = Date.now();
    const ttl = ttlMs ?? this.defaultTtlMs;
    const pipeline = this.client.pipeline();
    pipeline.hset(key, nodeId, envelope(vote, signature, ts));
    if (ttl > 0) pipeline.pexpire(key, ttl);
    await pipeline.exec();
    return true;
  }

  async get(proofId) {
    const key = proofKey(proofId);
    const all = await this.client.hgetall(key);
    const map = new Map();
    for (const [nodeId, raw] of Object.entries(all)) {
      const env = parseEnvelope(raw);
      if (env) map.set(nodeId, env);
    }
    return map;
  }

  async tally(proofId) {
    const votes = await this.get(proofId);
    const counts = new Map();
    for (const { vote } of votes.values()) {
      const k = JSON.stringify(vote);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    const results = [...counts.entries()]
      .map(([k, count]) => ({ vote: JSON.parse(k), count }))
      .sort((a, b) => b.count - a.count);
    return { totalVotes: votes.size, results };
  }

  async forget(proofId) {
    await this.client.del(proofKey(proofId));
  }

  async listProofs() {
    const out = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.client.scan(
        cursor,
        'MATCH',
        `${KEY_PREFIX}:*`,
        'COUNT',
        200
      );
      cursor = next;
      for (const k of batch) {
        out.push(k.slice(KEY_PREFIX.length + 1));
      }
    } while (cursor !== '0');
    return out;
  }
}
