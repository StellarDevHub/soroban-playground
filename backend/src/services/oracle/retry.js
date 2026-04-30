// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

export const RetryStrategy = Object.freeze({
  FIXED: 'fixed',
  EXPONENTIAL: 'exponential',
});

const DEFAULTS = {
  strategy: RetryStrategy.EXPONENTIAL,
  maxAttempts: 5,
  baseMs: 25,
  maxMs: 1000,
  jitter: 0.25,
};

export function normalizeRetry(opts = {}) {
  const merged = { ...DEFAULTS, ...opts };
  if (merged.maxAttempts < 1) merged.maxAttempts = 1;
  if (merged.baseMs < 0) merged.baseMs = 0;
  if (merged.maxMs < merged.baseMs) merged.maxMs = merged.baseMs;
  if (merged.jitter < 0) merged.jitter = 0;
  if (merged.jitter > 1) merged.jitter = 1;
  return merged;
}

// attempt is 1-indexed: 1, 2, 3, ...
export function nextDelay(opts, attempt, rng = Math.random) {
  const { strategy, baseMs, maxMs, jitter } = opts;
  let delay;
  if (strategy === RetryStrategy.FIXED) {
    delay = baseMs;
  } else {
    // exponential: base * 2^(attempt-1)
    delay = Math.min(maxMs, baseMs * Math.pow(2, attempt - 1));
  }
  if (jitter > 0) {
    const spread = delay * jitter;
    delay = delay - spread / 2 + rng() * spread;
  }
  if (delay < 0) delay = 0;
  if (delay > maxMs) delay = maxMs;
  return Math.floor(delay);
}

export function sleep(ms) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
