// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// Pluggable backends for the lock manager. Each backend implements:
//   tryAcquire(key, owner, ttlMs) -> Promise<boolean>
//   release(key, owner)            -> Promise<boolean>   (true == owner matched & deleted)
//   extend(key, owner, ttlMs)      -> Promise<boolean>
//   inspect(key)                    -> Promise<{ owner, expiresAt } | null>
//   listOwned(prefix)               -> Promise<Array<{ key, owner, expiresAt }>>
//   name                            -> string

// Atomic release: compare value, delete if match. Single round-trip on Redis.
const RELEASE_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
else
  return 0
end
`;

// Atomic extend: only if owner still matches.
const EXTEND_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
else
  return 0
end
`;

export class RedisBackend {
  constructor(client) {
    if (!client) throw new Error('RedisBackend requires an ioredis client');
    this.client = client;
    this.name = 'redis';
  }

  async tryAcquire(key, owner, ttlMs) {
    // SET key owner NX PX ttl  -- atomic SETNX with expiry
    const res = await this.client.set(key, owner, 'PX', ttlMs, 'NX');
    return res === 'OK';
  }

  async release(key, owner) {
    const res = await this.client.eval(RELEASE_LUA, 1, key, owner);
    return res === 1;
  }

  async extend(key, owner, ttlMs) {
    const res = await this.client.eval(EXTEND_LUA, 1, key, owner, ttlMs);
    return res === 1;
  }

  async inspect(key) {
    const [owner, pttl] = await Promise.all([
      this.client.get(key),
      this.client.pttl(key),
    ]);
    if (owner === null) return null;
    const expiresAt = pttl >= 0 ? Date.now() + pttl : null;
    return { owner, expiresAt };
  }

  async listOwned(prefix) {
    const out = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.client.scan(
        cursor,
        'MATCH',
        `${prefix}*`,
        'COUNT',
        200
      );
      cursor = next;
      for (const key of batch) {
        const inspected = await this.inspect(key);
        if (inspected) out.push({ key, ...inspected });
      }
    } while (cursor !== '0');
    return out;
  }
}

// In-memory backend used when Redis is unavailable, in tests, and as the
// substrate for optimistic locking. Process-local; not safe across nodes.
export class MemoryBackend {
  constructor({ now = () => Date.now() } = {}) {
    this.store = new Map(); // key -> { owner, expiresAt }
    this.now = now;
    this.name = 'memory';
  }

  _expired(entry) {
    return entry.expiresAt !== null && entry.expiresAt <= this.now();
  }

  _gc(key) {
    const e = this.store.get(key);
    if (e && this._expired(e)) {
      this.store.delete(key);
      return true;
    }
    return false;
  }

  async tryAcquire(key, owner, ttlMs) {
    this._gc(key);
    if (this.store.has(key)) return false;
    const expiresAt = ttlMs > 0 ? this.now() + ttlMs : null;
    this.store.set(key, { owner, expiresAt });
    return true;
  }

  async release(key, owner) {
    const e = this.store.get(key);
    if (!e) return false;
    if (this._expired(e)) {
      this.store.delete(key);
      return false;
    }
    if (e.owner !== owner) return false;
    this.store.delete(key);
    return true;
  }

  async extend(key, owner, ttlMs) {
    const e = this.store.get(key);
    if (!e) return false;
    if (this._expired(e)) {
      this.store.delete(key);
      return false;
    }
    if (e.owner !== owner) return false;
    e.expiresAt = ttlMs > 0 ? this.now() + ttlMs : null;
    return true;
  }

  async inspect(key) {
    const e = this.store.get(key);
    if (!e) return null;
    if (this._expired(e)) {
      this.store.delete(key);
      return null;
    }
    return { owner: e.owner, expiresAt: e.expiresAt };
  }

  async listOwned(prefix) {
    const out = [];
    for (const [key, e] of this.store) {
      if (!key.startsWith(prefix)) continue;
      if (this._expired(e)) {
        this.store.delete(key);
        continue;
      }
      out.push({ key, owner: e.owner, expiresAt: e.expiresAt });
    }
    return out;
  }

  // Test helper
  _clear() {
    this.store.clear();
  }
}

// Selects redis if the supplied client is healthy, otherwise memory.
// `client.status === 'ready'` is the ioredis convention.
export function selectBackend({ redisClient, memoryFallback = true } = {}) {
  if (
    redisClient &&
    (redisClient.status === 'ready' || redisClient.status === 'connect')
  ) {
    return new RedisBackend(redisClient);
  }
  if (!memoryFallback) {
    throw new Error('Redis backend unavailable and memoryFallback disabled');
  }
  return new MemoryBackend();
}
