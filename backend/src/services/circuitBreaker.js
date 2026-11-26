// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import redisService from './redisService.js';

export const CIRCUIT_STATES = Object.freeze({
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
});

export const DEFAULT_SLIDING_WINDOW_MS = 30_000;
export const DEFAULT_FAILURE_RATE_THRESHOLD = 0.5;
export const DEFAULT_MIN_SAMPLES = 5;
export const REDIS_CAS_MISSING = '__circuit_breaker_missing__';

const CAS_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if current == false then
  if ARGV[1] ~= '${REDIS_CAS_MISSING}' then return 0 end
elseif current ~= ARGV[1] then
  return 0
end
redis.call('SET', KEYS[1], ARGV[2])
if tonumber(ARGV[3]) > 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[3])
end
return 1
`;

const memoryState = new Map();

export function createMemoryCircuitStore(options = {}) {
  const prefix = options.prefix || '';

  return {
    mode: 'memory',
    async read(key) {
      const stored = memoryState.get(`${prefix}${key}`);
      return stored === undefined ? null : stored;
    },
    async write(key, previous, next) {
      const fullKey = `${prefix}${key}`;
      const current = memoryState.get(fullKey);
      if (previous === REDIS_CAS_MISSING) {
        if (current !== undefined) return false;
      } else if (previous != null && current !== previous) {
        return false;
      }
      memoryState.set(fullKey, next);
      return true;
    },
  };
}

export const sharedMemoryCircuitStore = createMemoryCircuitStore();

export function createRedisCircuitStore(options = {}) {
  const client = options.client;
  const ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
  if (!client || typeof client.eval !== 'function') {
    throw new TypeError('createRedisCircuitStore requires a Redis client');
  }

  return {
    mode: 'redis',
    async read(key) {
      const value = await client.get(key);
      return value == null ? null : String(value);
    },
    async write(key, previous, next) {
      const result = await client.eval(
        CAS_SCRIPT,
        1,
        key,
        previous == null ? REDIS_CAS_MISSING : previous,
        next,
        ttlMs
      );
      return Number(result) === 1;
    },
  };
}

function resolveStore(options) {
  if (options.store) return options.store;

  const client = options.redis || redisService?.client;
  const redisAvailable =
    client &&
    !redisService?.isFallbackMode &&
    typeof client.eval === 'function';

  return redisAvailable
    ? createRedisCircuitStore({ client, keyPrefix: options.keyPrefix })
    : sharedMemoryCircuitStore;
}

function emptySnapshot(now) {
  return {
    state: CIRCUIT_STATES.CLOSED,
    nextAttempt: 0,
    lastStateChange: now,
    halfOpenRequests: 0,
    halfOpenSuccesses: 0,
    samples: [],
  };
}

function countFailures(snapshot) {
  return snapshot.samples.reduce(
    (count, sample) => count + (sample.ok ? 0 : 1),
    0
  );
}

function publicState(snapshot, now) {
  const totalRequests = snapshot.samples.length;
  const failureCount = countFailures(snapshot);

  return {
    state: snapshot.state,
    nextAttempt: snapshot.nextAttempt,
    retryAfterMs: Math.max(0, snapshot.nextAttempt - now),
    lastStateChange: snapshot.lastStateChange,
    totalRequests,
    failureCount,
    successCount: totalRequests - failureCount,
    failureRate: totalRequests > 0 ? failureCount / totalRequests : 0,
    halfOpenRequests: snapshot.halfOpenRequests,
    halfOpenSuccesses: snapshot.halfOpenSuccesses,
  };
}

function trimSamples(snapshot, now, config) {
  const cutoff = now - config.slidingWindowMs;
  snapshot.samples = snapshot.samples.filter((sample) => sample.at >= cutoff);
  if (snapshot.samples.length > config.maxSamples) {
    snapshot.samples = snapshot.samples.slice(-config.maxSamples);
  }
}

function enterState(snapshot, state, now, config) {
  snapshot.state = state;
  snapshot.lastStateChange = now;
  snapshot.halfOpenRequests = 0;
  snapshot.halfOpenSuccesses = 0;
  snapshot.nextAttempt =
    state === CIRCUIT_STATES.OPEN ? now + config.resetTimeoutMs : 0;
  if (state === CIRCUIT_STATES.CLOSED) snapshot.samples = [];
}

function promoteExpiredOpen(snapshot, now) {
  if (snapshot.state === CIRCUIT_STATES.OPEN && now >= snapshot.nextAttempt) {
    enterState(snapshot, CIRCUIT_STATES.HALF_OPEN, now, {});
    return true;
  }
  return false;
}

export class CircuitBreaker {
  constructor(options = {}) {
    this.name = options.name || 'default-breaker';
    this.failureThreshold = options.failureThreshold ?? 5;
    this.failureRateThreshold =
      options.failureRateThreshold ?? DEFAULT_FAILURE_RATE_THRESHOLD;
    this.slidingWindowMs = options.slidingWindowMs ?? DEFAULT_SLIDING_WINDOW_MS;
    this.minSamples = options.minSamples ?? DEFAULT_MIN_SAMPLES;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30_000;
    this.halfOpenMaxRequests = options.halfOpenMaxRequests ?? 3;
    this.successThreshold = options.successThreshold ?? 2;
    this.maxSamples = options.maxSamples ?? 1000;
    this.maxRetries = options.maxRetries ?? 25;
    this.keyPrefix = options.keyPrefix || 'circuit-breaker';
    this.key = `${this.keyPrefix}:${this.name}`;
    this.now = typeof options.now === 'function' ? options.now : Date.now;
    this.store = resolveStore(options);

    this.state = CIRCUIT_STATES.CLOSED;
    this.nextAttempt = 0;
    this.lastStateChange = this.now();
    this.totalRequests = 0;
    this.failureCount = 0;
    this.successCount = 0;
    this.halfOpenRequests = 0;
    this.failureRate = 0;
    this.routeStats = { primary: 0, replica: 0, rejected: 0 };
  }

  #config() {
    return {
      failureThreshold: this.failureThreshold,
      failureRateThreshold: this.failureRateThreshold,
      slidingWindowMs: this.slidingWindowMs,
      minSamples: this.minSamples,
      resetTimeoutMs: this.resetTimeoutMs,
      halfOpenMaxRequests: this.halfOpenMaxRequests,
      successThreshold: this.successThreshold,
      maxSamples: this.maxSamples,
    };
  }

  async #load() {
    const raw = await this.store.read(this.key);
    if (!raw) return { raw: null, snapshot: emptySnapshot(this.now()) };

    try {
      const snapshot = JSON.parse(raw);
      if (!snapshot || !Array.isArray(snapshot.samples)) {
        throw new TypeError('malformed circuit breaker snapshot');
      }
      return { raw, snapshot };
    } catch {
      return { raw: REDIS_CAS_MISSING, snapshot: emptySnapshot(this.now()) };
    }
  }

  #mirror(status) {
    this.state = status.state;
    this.nextAttempt = status.nextAttempt;
    this.lastStateChange = status.lastStateChange;
    this.totalRequests = status.totalRequests;
    this.failureCount = status.failureCount;
    this.successCount = status.successCount;
    this.halfOpenRequests = status.halfOpenRequests;
    this.failureRate = status.failureRate;
  }

  async #update(mutator) {
    const config = this.#config();

    for (let attempt = 0; attempt < this.maxRetries; attempt += 1) {
      const { raw, snapshot } = await this.#load();
      const outcome = mutator(snapshot, config) || {};
      const status = publicState(snapshot, this.now());

      if (outcome.changed === false) {
        this.#mirror(status);
        return outcome.result;
      }

      const next = JSON.stringify(snapshot);
      const committed = await this.store.write(
        this.key,
        raw || REDIS_CAS_MISSING,
        next
      );
      if (committed) {
        this.#mirror(status);
        return outcome.result;
      }
    }

    throw new Error(
      'Circuit breaker ' +
        this.name +
        ' state update failed after ' +
        this.maxRetries +
        ' retries'
    );
  }

  async getState() {
    return this.#update((snapshot) => {
      const changed = promoteExpiredOpen(snapshot, this.now());
      return { changed, result: snapshot.state };
    });
  }

  async getStatus() {
    return this.#update((snapshot) => {
      const changed = promoteExpiredOpen(snapshot, this.now());
      return {
        changed,
        result: { name: this.name, ...publicState(snapshot, this.now()) },
      };
    });
  }

  async canExecute() {
    const config = this.#config();
    return this.#update((snapshot) => {
      const changed = promoteExpiredOpen(snapshot, this.now());
      let allowed = false;
      let reason = null;

      if (snapshot.state === CIRCUIT_STATES.CLOSED) {
        allowed = true;
      } else if (snapshot.state === CIRCUIT_STATES.HALF_OPEN) {
        if (snapshot.halfOpenRequests < config.halfOpenMaxRequests) {
          snapshot.halfOpenRequests += 1;
          allowed = true;
        } else {
          reason = 'half-open probe limit reached';
        }
      } else {
        reason = 'circuit is open';
      }

      const status = publicState(snapshot, this.now());
      return {
        changed:
          changed || (allowed && snapshot.state === CIRCUIT_STATES.HALF_OPEN),
        result: {
          allowed,
          state: snapshot.state,
          reason,
          retryAfterMs: status.retryAfterMs,
          failureRate: status.failureRate,
        },
      };
    });
  }

  async #record(ok) {
    const config = this.#config();
    const at = this.now();

    return this.#update((snapshot) => {
      promoteExpiredOpen(snapshot, at);
      trimSamples(snapshot, at, config);
      snapshot.samples.push({ at, ok });

      if (snapshot.state === CIRCUIT_STATES.HALF_OPEN) {
        if (!ok) {
          enterState(snapshot, CIRCUIT_STATES.OPEN, at, config);
        } else {
          snapshot.halfOpenSuccesses += 1;
          if (snapshot.halfOpenSuccesses >= config.successThreshold) {
            enterState(snapshot, CIRCUIT_STATES.CLOSED, at, config);
          }
        }
      } else if (snapshot.state === CIRCUIT_STATES.CLOSED) {
        const failures = countFailures(snapshot);
        const rate = failures / snapshot.samples.length;
        if (
          failures >= config.failureThreshold ||
          (snapshot.samples.length >= config.minSamples &&
            rate > config.failureRateThreshold)
        ) {
          enterState(snapshot, CIRCUIT_STATES.OPEN, at, config);
        }
      }

      return { changed: true, result: publicState(snapshot, at) };
    });
  }

  async recordSuccess() {
    return this.#record(true);
  }

  async recordFailure() {
    return this.#record(false);
  }

  async trip() {
    const at = this.now();
    return this.#update((snapshot) => {
      enterState(snapshot, CIRCUIT_STATES.OPEN, at, this.#config());
      return { changed: true, result: publicState(snapshot, at) };
    });
  }

  async reset() {
    const at = this.now();
    return this.#update((snapshot) => {
      enterState(snapshot, CIRCUIT_STATES.CLOSED, at, this.#config());
      return { changed: true, result: publicState(snapshot, at) };
    });
  }

  async execute(action, options = {}) {
    const decision = await this.canExecute();

    if (!decision.allowed) {
      const critical = options.critical === true;
      if (!critical && options.fallback != null) {
        this.routeStats.replica += 1;
        return typeof options.fallback === 'function'
          ? await options.fallback(decision)
          : options.fallback;
      }

      this.routeStats.rejected += 1;
      const error = new Error(`Circuit breaker '${this.name}' is OPEN`);
      error.status = 503;
      error.circuitBreakerOpen = true;
      error.circuitBreakerState = decision.state;
      error.retryAfterMs = decision.retryAfterMs;
      throw error;
    }

    this.routeStats.primary += 1;
    try {
      const result = await action();
      await this.recordSuccess();
      return result;
    } catch (err) {
      await this.recordFailure();
      throw err;
    }
  }
}

export async function routeReadCall(breaker, options = {}) {
  return breaker.execute(options.primary, {
    fallback: options.fallback,
    critical: options.critical === true,
  });
}

export function createCachedReadReplica(options = {}) {
  const namespace = options.namespace || 'rpc-replica';
  const freshTtlMs = options.freshTtlMs ?? 30_000;
  const staleTtlMs = options.staleTtlMs ?? 60 * 60 * 1000;
  const cache = options.cache || redisService;
  const local = new Map();
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const cacheKey = (key) => `${namespace}:${key}`;

  async function readEntry(key) {
    const keyName = cacheKey(key);
    if (cache && !cache.isFallbackMode && typeof cache.get === 'function') {
      try {
        const raw = await cache.get(keyName);
        if (raw) return JSON.parse(raw);
      } catch {}
    }
    return local.get(keyName) || null;
  }

  async function writeEntry(key, entry) {
    const keyName = cacheKey(key);
    local.set(keyName, entry);
    if (cache && !cache.isFallbackMode && typeof cache.set === 'function') {
      try {
        await cache.set(
          keyName,
          JSON.stringify(entry),
          Math.ceil(staleTtlMs / 1000)
        );
      } catch {}
    }
  }

  async function get(key, { allowStale = false } = {}) {
    const entry = await readEntry(key);
    if (!entry) return null;

    const ageMs = now() - entry.cachedAt;
    if (ageMs > freshTtlMs && !allowStale) return null;
    if (ageMs > staleTtlMs) return null;

    return { value: entry.value, stale: ageMs > freshTtlMs, ageMs };
  }

  async function set(key, value) {
    const entry = { value, cachedAt: now() };
    await writeEntry(key, entry);
    return value;
  }

  async function read(key, fetchFn) {
    const cached = await get(key);
    if (cached) return { value: cached.value, source: 'cache', stale: false };
    const value = await fetchFn();
    await set(key, value);
    return { value, source: 'primary', stale: false };
  }

  async function readWithBreaker(breaker, key, fetchFn, opts = {}) {
    const critical = opts.critical === true;
    const decision = await breaker.canExecute();

    if (!decision.allowed && !critical) {
      const cached = await get(key, { allowStale: true });
      if (cached) {
        breaker.routeStats.replica += 1;
        return {
          value: cached.value,
          source: 'replica',
          stale: cached.stale,
          circuitBreakerState: decision.state,
        };
      }
    }

    if (!decision.allowed) {
      breaker.routeStats.rejected += 1;
      const error = new Error(`Circuit breaker '${breaker.name}' is OPEN`);
      error.status = 503;
      error.circuitBreakerOpen = true;
      error.circuitBreakerState = decision.state;
      error.retryAfterMs = decision.retryAfterMs;
      throw error;
    }

    breaker.routeStats.primary += 1;
    try {
      const value = await fetchFn();
      await breaker.recordSuccess();
      await set(key, value);
      return { value, source: 'primary', stale: false };
    } catch (err) {
      await breaker.recordFailure();
      if (!critical) {
        const cached = await get(key, { allowStale: true });
        if (cached) {
          breaker.routeStats.replica += 1;
          return {
            value: cached.value,
            source: 'replica',
            stale: true,
            circuitBreakerState: CIRCUIT_STATES.OPEN,
          };
        }
      }
      throw err;
    }
  }

  return { get, set, read, readWithBreaker };
}

export function createCircuitBreakerMiddleware(options = {}) {
  const breaker = new CircuitBreaker(options);

  const middleware = async (req, res, next) => {
    let decision;
    try {
      decision = await breaker.canExecute();
    } catch (err) {
      return next(err);
    }

    if (!decision.allowed) {
      const retryAfterSeconds =
        Math.ceil(decision.retryAfterMs / 1000) ||
        Math.ceil(breaker.resetTimeoutMs / 1000);
      res.setHeader('Retry-After', String(Math.max(1, retryAfterSeconds)));
      res.setHeader('X-Circuit-Breaker', decision.state);

      const isRead =
        !req.method || req.method === 'GET' || req.method === 'HEAD';
      const fallback = options.fallback;
      const replica = options.replica;

      if (!options.critical && isRead && (fallback || replica)) {
        try {
          let payload;
          if (replica && typeof replica.get === 'function') {
            const cached = await replica.get(
              options.replicaKey || req.originalUrl || req.url || '',
              { allowStale: true }
            );
            if (cached) payload = cached.value;
          }
          if (payload === undefined && fallback != null) {
            payload =
              typeof fallback === 'function' ? await fallback(req) : fallback;
          }
          if (payload !== undefined) {
            breaker.routeStats.replica += 1;
            res.setHeader('X-Data-Source', 'replica');
            return res.status(200).json({
              success: true,
              data: payload,
              degraded: true,
              circuitBreakerState: decision.state,
            });
          }
        } catch (err) {
          return next(err);
        }
      }

      breaker.routeStats.rejected += 1;
      return res.status(503).json({
        success: false,
        error: 'Service Unavailable',
        message: `Upstream service circuit breaker '${breaker.name}' is OPEN`,
        circuitBreakerState: decision.state,
        failureRate: decision.failureRate,
      });
    }

    res.on('finish', () => {
      const outcome =
        res.statusCode >= 500
          ? breaker.recordFailure()
          : breaker.recordSuccess();
      Promise.resolve(outcome).catch(() => {});
    });

    return next();
  };

  middleware.breaker = breaker;
  return middleware;
}

export default CircuitBreaker;
