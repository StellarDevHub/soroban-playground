// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Strategy interface for Rate Limiting
 */
export class RateLimitStrategy {
  async check(redisService, key, limit, windowMs) {
    throw new Error('Check method must be implemented');
  }

  getName() {
    throw new Error('getName method must be implemented');
  }
}

export class FixedWindowStrategy extends RateLimitStrategy {
  async check(redisService, key, limit, windowMs) {
    return redisService.checkRateLimit(
      'FixedWindow',
      `rl:fw:${key}`,
      limit,
      windowMs
    );
  }
  getName() {
    return 'FixedWindow';
  }
}

export class SlidingWindowLogStrategy extends RateLimitStrategy {
  async check(redisService, key, limit, windowMs) {
    return redisService.checkRateLimit(
      'SlidingWindowLog',
      `rl:swl:${key}`,
      limit,
      windowMs
    );
  }
  getName() {
    return 'SlidingWindowLog';
  }
}

export class SlidingWindowCounterStrategy extends RateLimitStrategy {
  async check(redisService, key, limit, windowMs) {
    return redisService.checkRateLimit(
      'SlidingWindowCounter',
      `rl:swc:${key}`,
      limit,
      windowMs
    );
  }
  getName() {
    return 'SlidingWindowCounter';
  }
}

/**
 * Token bucket: allows bursts up to `limit` and refills continuously at
 * limit/windowMs, so clients cannot double their quota at window boundaries.
 */
export class TokenBucketStrategy extends RateLimitStrategy {
  async check(redisService, key, limit, windowMs) {
    return redisService.checkRateLimit(
      'TokenBucket',
      `rl:tb:${key}`,
      limit,
      windowMs
    );
  }
  getName() {
    return 'TokenBucket';
  }
}

export const STRATEGIES = {
  FIXED: new FixedWindowStrategy(),
  LOG: new SlidingWindowLogStrategy(),
  COUNTER: new SlidingWindowCounterStrategy(),
  TOKEN_BUCKET: new TokenBucketStrategy(),
};

export const getStrategy = (name) => {
  if (name === 'FixedWindow') return STRATEGIES.FIXED;
  if (name === 'SlidingWindowLog') return STRATEGIES.LOG;
  if (name === 'TokenBucket') return STRATEGIES.TOKEN_BUCKET;
  return STRATEGIES.COUNTER; // Default
};
