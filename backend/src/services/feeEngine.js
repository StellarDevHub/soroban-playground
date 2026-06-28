// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import redisService from './redisService.js';

const HORIZON = {
  testnet: 'https://horizon-testnet.stellar.org',
  mainnet: 'https://horizon.stellar.org',
};

const FEE_STATS_TTL_SECONDS = 15;

const BASE_FEE = 100;
const DEFAULT_MAX_FEE = parseInt(process.env.FEE_ENGINE_MAX_FEE || '10000', 10);
const DEFAULT_ESCALATION_FACTOR = parseFloat(
  process.env.FEE_ENGINE_ESCALATION_FACTOR || '1.5'
);
const DEFAULT_MAX_ATTEMPTS = parseInt(
  process.env.FEE_ENGINE_MAX_ATTEMPTS || '5',
  10
);

// In-memory cache: { [network]: { stats, expiresAt } }
const feeStatsCache = {};

export async function fetchFeeStats(network = 'testnet') {
  const cacheKey = `fee_stats:${network}`;
  const redisValue = await redisService.get(cacheKey);
  if (redisValue !== null) {
    if (typeof redisValue === 'string') {
      try {
        return JSON.parse(redisValue);
      } catch {
        // Ignore corrupted Redis payload and refresh from Horizon.
      }
    } else if (typeof redisValue === 'object') {
      return redisValue;
    }
  }

  const cached = feeStatsCache[network];
  if (cached && cached.expiresAt > Date.now()) return cached.stats;

  const baseUrl = HORIZON[network] ?? HORIZON.testnet;
  const url = `${baseUrl}/fee_stats`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok)
    throw new Error(
      `Horizon fee_stats HTTP ${res.status} for network=${network}`
    );
  const stats = await res.json();
  feeStatsCache[network] = {
    stats,
    expiresAt: Date.now() + FEE_STATS_TTL_SECONDS * 1000,
  };
  redisService.set(cacheKey, JSON.stringify(stats), FEE_STATS_TTL_SECONDS).catch(
    () => null
  );
  return stats;
}

export function calculateFee(
  stats,
  attempt,
  {
    escalationFactor = DEFAULT_ESCALATION_FACTOR,
    maxFee = DEFAULT_MAX_FEE,
  } = {}
) {
  const p90 = parseInt(stats?.fee_charged?.p90 ?? BASE_FEE, 10);
  const base = Number.isFinite(p90) && p90 > 0 ? p90 : BASE_FEE;
  const escalated = Math.ceil(base * Math.pow(escalationFactor, attempt - 1));
  return Math.max(Math.min(escalated, maxFee), BASE_FEE);
}

// Detect fee-specific Horizon errors — parse result_codes.transaction to avoid
// retrying on unrelated 400 errors (bad_auth, bad_seq, no_source_account, etc.)
export function isFeeError(err) {
  const code = err?.horizonResultCode ?? err?.result_codes?.transaction;
  if (code) return code === 'tx_insufficient_fee';
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('tx_insufficient_fee') || msg.includes('fee_too_low');
}

export async function submitWithEscalation(submitFn, opts = {}) {
  const {
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    escalationFactor = DEFAULT_ESCALATION_FACTOR,
    maxFee = DEFAULT_MAX_FEE,
    network = 'testnet',
  } = opts;

  const stats = await fetchFeeStats(network);
  let lastErr;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const fee = calculateFee(stats, attempt, { escalationFactor, maxFee });
    try {
      return await submitFn(fee, attempt);
    } catch (err) {
      lastErr = err;
      if (!isFeeError(err) || attempt === maxAttempts) throw err;
    }
  }

  throw lastErr;
}

export function _clearCacheForTesting() {
  Object.keys(feeStatsCache).forEach((k) => delete feeStatsCache[k]);
}

export {
  DEFAULT_MAX_FEE,
  DEFAULT_ESCALATION_FACTOR,
  DEFAULT_MAX_ATTEMPTS,
  BASE_FEE,
};
