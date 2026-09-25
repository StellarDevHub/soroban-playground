// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Distributed token bucket (issue #1574).
 *
 * A bucket holds up to `capacity` tokens and refills continuously at
 * capacity / windowMs tokens per millisecond. Each request costs one token.
 * Unlike fixed windows this allows short bursts up to `capacity` while
 * capping sustained throughput, and has no window-boundary double spend.
 *
 * TOKEN_BUCKET_LUA runs atomically inside Redis and reads the Redis server
 * clock, so every API node shares one bucket and one time source regardless
 * of local clock skew. tokenBucketStep() is the same algorithm in JS, used
 * for the in-process fallback when Redis is unavailable.
 *
 * Both return [allowed (1|0), used, retryAfterSeconds] where
 * used = capacity - remainingTokens (rounded up).
 */
export const TOKEN_BUCKET_LUA = `
  local key = KEYS[1]
  local capacity = tonumber(ARGV[1])
  local window_ms = tonumber(ARGV[2])
  local cost = tonumber(ARGV[3])
  local t = redis.call('TIME')
  local now_ms = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
  local rate = capacity / window_ms
  local state = redis.call('HMGET', key, 'tokens', 'ts')
  local tokens = tonumber(state[1])
  local ts = tonumber(state[2])
  if tokens == nil or ts == nil then
    tokens = capacity
    ts = now_ms
  end
  local elapsed = math.max(0, now_ms - ts)
  tokens = math.min(capacity, tokens + elapsed * rate)
  local allowed = 0
  local retry_after = 0
  if tokens >= cost then
    tokens = tokens - cost
    allowed = 1
  else
    retry_after = math.ceil((cost - tokens) / rate / 1000)
  end
  redis.call('HSET', key, 'tokens', tostring(tokens), 'ts', now_ms)
  redis.call('PEXPIRE', key, math.ceil(window_ms * 2))
  return {allowed, math.ceil(capacity - tokens), retry_after}
`;

/**
 * Pure token bucket step.
 * @param {{tokens:number, ts:number}|undefined} state - Previous bucket state
 * @param {number} capacity
 * @param {number} windowMs
 * @param {number} now - Current time in ms
 * @param {number} [cost=1]
 * @returns {{state:{tokens:number, ts:number}, result:[number, number, number]}}
 */
export function tokenBucketStep(state, capacity, windowMs, now, cost = 1) {
  const rate = capacity / windowMs;
  const previous = state || { tokens: capacity, ts: now };
  const elapsed = Math.max(0, now - previous.ts);
  let tokens = Math.min(capacity, previous.tokens + elapsed * rate);
  let allowed = 0;
  let retryAfter = 0;
  if (tokens >= cost) {
    tokens -= cost;
    allowed = 1;
  } else {
    retryAfter = Math.ceil((cost - tokens) / rate / 1000);
  }
  return {
    state: { tokens, ts: now },
    result: [allowed, Math.ceil(capacity - tokens), retryAfter],
  };
}
