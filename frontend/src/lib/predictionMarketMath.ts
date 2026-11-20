// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Parimutuel Prediction Market Odds, Takeout Fee & Slippage Math
 *
 * Implements mathematical formulations for:
 * - Parimutuel net pool calculation after market maker / vigorish (takeout) fee deduction.
 * - Implied probability percentage calculation for binary and multi-outcome market pools.
 * - Decimal (European), American (Moneyline), and Fractional odds formatting and conversions.
 * - Dynamic price slippage and odds shifting caused by marginal and large bet sizes.
 * - Exact projected payout and ROI calculation.
 */

export const DEFAULT_TAKEOUT_FEE_RATE = 0.02; // 2% protocol / market-maker fee
export const MIN_DECIMAL_ODDS = 1.01; // Minimum standard decimal payout floor

export interface OutcomePool {
  id: string | number;
  name: string;
  stake: number;
}

export interface MarketOddsSummary {
  outcomeId: string | number;
  name: string;
  stake: number;
  impliedProbability: number; // [0, 1]
  impliedProbabilityPercent: number; // [0, 100]
  decimalOdds: number | null; // e.g. 2.45 (null when outcome pool has 0 stake)
  americanOdds: string; // e.g. "+145", "-200", "EVEN", "—"
  fractionalOdds: string; // e.g. "3/2", "1/1", "—"
}

export interface MarketPoolSummary {
  totalPool: number;
  netPool: number;
  takeoutFeeRate: number;
  takeoutFeeAmount: number;
  outcomes: MarketOddsSummary[];
}

export interface BetSimulationParams {
  outcomes: OutcomePool[];
  targetOutcomeId: string | number;
  betAmount: number;
  takeoutFeeRate?: number;
  enforceMinPayoutFloor?: boolean;
}

export interface BetSimulationResult {
  targetOutcomeId: string | number;
  betAmount: number;
  takeoutFeeRate: number;

  // Pre-bet state
  preBetTotalPool: number;
  preBetNetPool: number;
  preBetOutcomeStake: number;
  preBetProbability: number;
  preBetProbabilityPercent: number;
  preBetDecimalOdds: number | null;
  preBetAmericanOdds: string;

  // Post-bet state
  postBetTotalPool: number;
  postBetNetPool: number;
  postBetOutcomeStake: number;
  postBetProbability: number;
  postBetProbabilityPercent: number;
  postBetDecimalOdds: number;
  postBetAmericanOdds: string;

  // Realized execution metrics
  expectedPayout: number;
  expectedProfit: number;
  effectiveDecimalOdds: number;
  effectiveAmericanOdds: string;
  roiPercent: number;

  // Dynamic impact & slippage
  probabilityShiftPercent: number; // Difference in percentage points (+/- %)
  oddsSlippagePercent: number; // Percentage decrease in decimal odds
  takeoutFeeDeduction: number;

  // Updated pool state across all outcomes
  updatedOutcomes: MarketOddsSummary[];
}

export interface BinaryMarketOddsSummary {
  totalPool: number;
  netPool: number;
  takeoutFeeRate: number;
  takeoutFeeAmount: number;
  yes: MarketOddsSummary;
  no: MarketOddsSummary;
}

// ─────────────────────────────────────────────────────────────────────────────
// Odds Formatting & Conversions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts decimal odds to American moneyline odds string.
 * @param decimalOdds - Decimal odds (e.g. 2.50)
 * @returns American odds string (e.g. "+150", "-200", "EVEN", "—")
 */
export function decimalToAmericanOdds(decimalOdds: number | null | undefined): string {
  if (decimalOdds == null || !Number.isFinite(decimalOdds) || decimalOdds <= 0) {
    return "—";
  }

  // Exact 2.00 is EVEN / +100
  if (Math.abs(decimalOdds - 2.0) < 0.001) {
    return "+100";
  }

  if (decimalOdds > 2.0) {
    const american = Math.round((decimalOdds - 1) * 100);
    return `+${american}`;
  }

  if (decimalOdds > 1.0) {
    const american = Math.round(100 / (decimalOdds - 1));
    return `-${american}`;
  }

  // Odds <= 1.0 (minus pool or zero return)
  return "-10000";
}

/**
 * Converts American odds string or number to decimal odds.
 */
export function americanToDecimalOdds(americanOdds: number | string): number {
  const parsed =
    typeof americanOdds === "string"
      ? americanOdds.trim().toUpperCase() === "EVEN"
        ? 100
        : parseFloat(americanOdds)
      : americanOdds;

  if (isNaN(parsed) || parsed === 0) return 2.0;

  if (parsed > 0) {
    return 1 + parsed / 100;
  } else {
    return 1 + 100 / Math.abs(parsed);
  }
}

/**
 * Greatest common divisor for fractional simplification.
 */
function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

/**
 * Converts decimal odds to a simplified British fractional odds string.
 */
export function decimalToFractionalOdds(decimalOdds: number | null | undefined): string {
  if (decimalOdds == null || !Number.isFinite(decimalOdds) || decimalOdds <= 1.0) {
    return "—";
  }

  const profitRatio = decimalOdds - 1;
  const tolerance = 1.0e-3;

  // Search denominators up to 100
  for (let denom = 1; denom <= 100; denom++) {
    const num = Math.round(profitRatio * denom);
    if (Math.abs(profitRatio - num / denom) < tolerance) {
      const divisor = gcd(num, denom);
      return `${num / divisor}/${denom / divisor}`;
    }
  }

  return `${profitRatio.toFixed(2)}/1`;
}

/**
 * Formats decimal odds for display.
 */
export function formatDecimalOdds(odds: number | null | undefined, decimals = 2): string {
  if (odds == null || !Number.isFinite(odds) || odds <= 0) {
    return "—";
  }
  return `${odds.toFixed(decimals)}x`;
}

/**
 * Formats a probability value [0, 1] as a percentage string.
 */
export function formatProbability(prob: number, decimals = 1): string {
  if (isNaN(prob)) return "0.0%";
  const clamped = Math.max(0, Math.min(1, prob));
  return `${(clamped * 100).toFixed(decimals)}%`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Parimutuel Pool Math
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculates net parimutuel pool and takeout fee amounts.
 */
export function calculateNetPool(
  totalPool: number,
  takeoutFeeRate = DEFAULT_TAKEOUT_FEE_RATE,
): { netPool: number; takeoutFeeAmount: number } {
  const sanitizedTotal = Math.max(0, totalPool);
  const sanitizedRate = Math.max(0, Math.min(0.9999, takeoutFeeRate));
  const takeoutFeeAmount = sanitizedTotal * sanitizedRate;
  const netPool = sanitizedTotal - takeoutFeeAmount;
  return { netPool, takeoutFeeAmount };
}

/**
 * Computes implied probabilities and parimutuel odds for an arbitrary set of outcomes.
 */
export function calculateMarketOdds(
  outcomes: OutcomePool[],
  takeoutFeeRate = DEFAULT_TAKEOUT_FEE_RATE,
): MarketPoolSummary {
  const sanitizedRate = Math.max(0, Math.min(0.9999, takeoutFeeRate));
  const totalPool = outcomes.reduce((sum, o) => sum + Math.max(0, o.stake), 0);
  const { netPool, takeoutFeeAmount } = calculateNetPool(totalPool, sanitizedRate);
  const numOutcomes = outcomes.length || 1;

  const summaries: MarketOddsSummary[] = outcomes.map((o) => {
    const stake = Math.max(0, o.stake);
    const impliedProbability =
      totalPool > 0 ? stake / totalPool : 1 / numOutcomes;
    const impliedProbabilityPercent = impliedProbability * 100;

    let decimalOdds: number | null = null;
    if (stake > 0) {
      decimalOdds = netPool / stake;
    }

    return {
      outcomeId: o.id,
      name: o.name,
      stake,
      impliedProbability,
      impliedProbabilityPercent,
      decimalOdds,
      americanOdds: decimalToAmericanOdds(decimalOdds),
      fractionalOdds: decimalToFractionalOdds(decimalOdds),
    };
  });

  return {
    totalPool,
    netPool,
    takeoutFeeRate: sanitizedRate,
    takeoutFeeAmount,
    outcomes: summaries,
  };
}

/**
 * Calculates parimutuel odds and implied probabilities for a binary (YES/NO) market.
 */
export function calculateBinaryParimutuelOdds(
  yesStake: number,
  noStake: number,
  takeoutFeeRate = DEFAULT_TAKEOUT_FEE_RATE,
): BinaryMarketOddsSummary {
  const outcomes: OutcomePool[] = [
    { id: 1, name: "YES", stake: Math.max(0, yesStake) },
    { id: 0, name: "NO", stake: Math.max(0, noStake) },
  ];

  const poolSummary = calculateMarketOdds(outcomes, takeoutFeeRate);
  return {
    totalPool: poolSummary.totalPool,
    netPool: poolSummary.netPool,
    takeoutFeeRate: poolSummary.takeoutFeeRate,
    takeoutFeeAmount: poolSummary.takeoutFeeAmount,
    yes: poolSummary.outcomes[0],
    no: poolSummary.outcomes[1],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic Bet Sizing, Payout & Slippage Simulation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Simulates a prospective bet on a specific outcome in a parimutuel market pool.
 * Computes exact dynamic odds shifting, probability impact, slippage, and projected payout.
 */
export function simulateBet(params: BetSimulationParams): BetSimulationResult {
  const {
    outcomes,
    targetOutcomeId,
    betAmount,
    takeoutFeeRate = DEFAULT_TAKEOUT_FEE_RATE,
    enforceMinPayoutFloor = false,
  } = params;

  const sanitizedBet = Math.max(0, betAmount);
  const sanitizedRate = Math.max(0, Math.min(0.9999, takeoutFeeRate));

  // 1. Initial State (Pre-bet)
  const preBetSummary = calculateMarketOdds(outcomes, sanitizedRate);
  const targetPre = preBetSummary.outcomes.find(
    (o) => String(o.outcomeId) === String(targetOutcomeId),
  );

  const preBetTotalPool = preBetSummary.totalPool;
  const preBetNetPool = preBetSummary.netPool;
  const preBetOutcomeStake = targetPre ? targetPre.stake : 0;
  const preBetProbability = targetPre ? targetPre.impliedProbability : 0;
  const preBetProbabilityPercent = targetPre ? targetPre.impliedProbabilityPercent : 0;
  const preBetDecimalOdds = targetPre ? targetPre.decimalOdds : null;
  const preBetAmericanOdds = targetPre ? targetPre.americanOdds : "—";

  // 2. Post-bet State
  const postBetOutcomes: OutcomePool[] = outcomes.map((o) => {
    const isTarget = String(o.id) === String(targetOutcomeId);
    return {
      id: o.id,
      name: o.name,
      stake: Math.max(0, o.stake) + (isTarget ? sanitizedBet : 0),
    };
  });

  const postBetSummary = calculateMarketOdds(postBetOutcomes, sanitizedRate);
  const targetPost = postBetSummary.outcomes.find(
    (o) => String(o.outcomeId) === String(targetOutcomeId),
  );

  const postBetTotalPool = postBetSummary.totalPool;
  const postBetNetPool = postBetSummary.netPool;
  const postBetOutcomeStake = targetPost ? targetPost.stake : sanitizedBet;
  const postBetProbability = targetPost ? targetPost.impliedProbability : 0;
  const postBetProbabilityPercent = targetPost ? targetPost.impliedProbabilityPercent : 0;

  // 3. Payout and Effective Realized Odds
  let expectedPayout = 0;
  let effectiveDecimalOdds = 0;

  if (sanitizedBet > 0 && postBetOutcomeStake > 0) {
    // Bettor's proportion of the winning outcome pool
    const shareOfWinningPool = sanitizedBet / postBetOutcomeStake;
    expectedPayout = shareOfWinningPool * postBetNetPool;

    if (enforceMinPayoutFloor && expectedPayout < sanitizedBet * MIN_DECIMAL_ODDS) {
      expectedPayout = sanitizedBet * MIN_DECIMAL_ODDS;
    }

    effectiveDecimalOdds = expectedPayout / sanitizedBet;
  } else if (sanitizedBet === 0) {
    expectedPayout = 0;
    effectiveDecimalOdds = preBetDecimalOdds ?? 0;
  }

  const expectedProfit = expectedPayout - sanitizedBet;
  const effectiveAmericanOdds = decimalToAmericanOdds(effectiveDecimalOdds);
  const roiPercent = sanitizedBet > 0 ? (expectedProfit / sanitizedBet) * 100 : 0;

  // 4. Probability Impact & Slippage Calculation
  const probabilityShiftPercent = postBetProbabilityPercent - preBetProbabilityPercent;

  let oddsSlippagePercent = 0;
  if (preBetDecimalOdds != null && preBetDecimalOdds > 0 && sanitizedBet > 0) {
    const rawSlippage =
      ((preBetDecimalOdds - effectiveDecimalOdds) / preBetDecimalOdds) * 100;
    oddsSlippagePercent = Math.max(0, rawSlippage);
  }

  const takeoutFeeDeduction = sanitizedBet * sanitizedRate;

  return {
    targetOutcomeId,
    betAmount: sanitizedBet,
    takeoutFeeRate: sanitizedRate,

    // Pre-bet
    preBetTotalPool,
    preBetNetPool,
    preBetOutcomeStake,
    preBetProbability,
    preBetProbabilityPercent,
    preBetDecimalOdds,
    preBetAmericanOdds,

    // Post-bet
    postBetTotalPool,
    postBetNetPool,
    postBetOutcomeStake,
    postBetProbability,
    postBetProbabilityPercent,
    postBetDecimalOdds: targetPost?.decimalOdds ?? effectiveDecimalOdds,
    postBetAmericanOdds: targetPost?.americanOdds ?? effectiveAmericanOdds,

    // Realized metrics
    expectedPayout,
    expectedProfit,
    effectiveDecimalOdds,
    effectiveAmericanOdds,
    roiPercent,

    // Impact
    probabilityShiftPercent,
    oddsSlippagePercent,
    takeoutFeeDeduction,

    // Updated outcomes
    updatedOutcomes: postBetSummary.outcomes,
  };
}

/**
 * Convenience simulation helper for binary prediction markets.
 */
export function simulateBinaryBet(
  yesStake: number,
  noStake: number,
  outcome: "YES" | "NO" | 1 | 0,
  betAmount: number,
  takeoutFeeRate = DEFAULT_TAKEOUT_FEE_RATE,
): BetSimulationResult {
  const targetId = outcome === "YES" || outcome === 1 ? 1 : 0;
  const outcomes: OutcomePool[] = [
    { id: 1, name: "YES", stake: Math.max(0, yesStake) },
    { id: 0, name: "NO", stake: Math.max(0, noStake) },
  ];

  return simulateBet({
    outcomes,
    targetOutcomeId: targetId,
    betAmount,
    takeoutFeeRate,
  });
}
