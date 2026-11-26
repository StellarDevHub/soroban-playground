// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * @file predictionMarketMath.ts
 * Parimutuel prediction market mathematics.
 *
 * Implements:
 * - Net pool calculation after the protocol / market-maker takeout fee.
 * - Implied probabilities and parimutuel odds for binary and multi-outcome pools.
 * - Decimal, American (moneyline) and fractional odds formatting.
 * - Dynamic bet simulation: post-bet odds, probability shift, slippage and payout.
 */

export const DEFAULT_TAKEOUT_FEE_RATE = 0.02;
export const MIN_DECIMAL_ODDS = 1.01;

const MAX_TAKEOUT_FEE_RATE = 0.9999;
const FRACTIONAL_DENOMINATOR_LIMIT = 100;
const FRACTIONAL_TOLERANCE = 1e-3;

export interface OutcomePool {
  id: string | number;
  name: string;
  stake: number;
}

export interface MarketOddsSummary {
  outcomeId: string | number;
  name: string;
  stake: number;
  /** Probability in the range [0, 1]. */
  impliedProbability: number;
  /** Probability in the range [0, 100]. */
  impliedProbabilityPercent: number;
  /** Parimutuel decimal odds, or null when the outcome has no stake. */
  decimalOdds: number | null;
  americanOdds: string;
  fractionalOdds: string;
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
  /** When true, never project a return below MIN_DECIMAL_ODDS. */
  enforceMinPayoutFloor?: boolean;
}

export interface BetSimulationResult {
  targetOutcomeId: string | number;
  betAmount: number;
  takeoutFeeRate: number;

  preBetTotalPool: number;
  preBetNetPool: number;
  preBetOutcomeStake: number;
  preBetProbability: number;
  preBetProbabilityPercent: number;
  preBetDecimalOdds: number | null;
  preBetAmericanOdds: string;

  postBetTotalPool: number;
  postBetNetPool: number;
  postBetOutcomeStake: number;
  postBetProbability: number;
  postBetProbabilityPercent: number;
  postBetDecimalOdds: number;
  postBetAmericanOdds: string;

  /** Total return to the bettor, including their own stake. */
  expectedPayout: number;
  expectedProfit: number;
  effectiveDecimalOdds: number;
  effectiveAmericanOdds: string;
  roiPercent: number;

  /** Change in implied probability, in percentage points. */
  probabilityShiftPercent: number;
  /** Relative decrease in decimal odds caused by the bet, in percent. */
  oddsSlippagePercent: number;
  takeoutFeeDeduction: number;

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

function sanitizeAmount(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

function sanitizeFeeRate(rate: number | null | undefined): number {
  if (typeof rate !== "number" || !Number.isFinite(rate)) {
    return DEFAULT_TAKEOUT_FEE_RATE;
  }
  return Math.min(MAX_TAKEOUT_FEE_RATE, Math.max(0, rate));
}

function greatestCommonDivisor(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const remainder = x % y;
    x = y;
    y = remainder;
  }
  return x;
}

/**
 * Converts decimal odds to an American moneyline string.
 *
 * @example decimalToAmericanOdds(2.5) === "+150"
 * @example decimalToAmericanOdds(1.5) === "-200"
 */
export function decimalToAmericanOdds(
  decimalOdds: number | null | undefined,
): string {
  if (
    decimalOdds == null ||
    !Number.isFinite(decimalOdds) ||
    decimalOdds <= 0
  ) {
    return "—";
  }

  if (Math.abs(decimalOdds - 2) < 0.001) {
    return "+100";
  }

  if (decimalOdds > 2) {
    return `+${Math.round((decimalOdds - 1) * 100)}`;
  }

  if (decimalOdds > 1) {
    return `-${Math.round(100 / (decimalOdds - 1))}`;
  }

  return "-10000";
}

/**
 * Converts American moneyline odds (number or string) to decimal odds.
 */
export function americanToDecimalOdds(americanOdds: number | string): number {
  const parsed =
    typeof americanOdds === "string"
      ? americanOdds.trim().toUpperCase() === "EVEN"
        ? 100
        : Number.parseFloat(americanOdds)
      : americanOdds;

  if (!Number.isFinite(parsed) || parsed === 0) {
    return 2;
  }

  return parsed > 0 ? 1 + parsed / 100 : 1 + 100 / Math.abs(parsed);
}

/**
 * Converts decimal odds to a simplified fractional odds string.
 *
 * @example decimalToFractionalOdds(2.5) === "3/2"
 */
export function decimalToFractionalOdds(
  decimalOdds: number | null | undefined,
): string {
  if (
    decimalOdds == null ||
    !Number.isFinite(decimalOdds) ||
    decimalOdds <= 1
  ) {
    return "—";
  }

  const profitRatio = decimalOdds - 1;
  for (let denominator = 1; denominator <= FRACTIONAL_DENOMINATOR_LIMIT; denominator++) {
    const numerator = Math.round(profitRatio * denominator);
    if (
      Math.abs(profitRatio - numerator / denominator) < FRACTIONAL_TOLERANCE
    ) {
      const divisor = greatestCommonDivisor(numerator, denominator) || 1;
      return `${numerator / divisor}/${denominator / divisor}`;
    }
  }

  return `${profitRatio.toFixed(2)}/1`;
}

/** Formats decimal odds for display, e.g. "2.46x". */
export function formatDecimalOdds(
  odds: number | null | undefined,
  decimals = 2,
): string {
  if (odds == null || !Number.isFinite(odds) || odds <= 0) {
    return "—";
  }
  return `${odds.toFixed(decimals)}x`;
}

/** Formats a probability in [0, 1] as a percentage string. */
export function formatProbability(prob: number, decimals = 1): string {
  if (!Number.isFinite(prob)) {
    return `${(0).toFixed(decimals)}%`;
  }
  const clamped = Math.min(1, Math.max(0, prob));
  return `${(clamped * 100).toFixed(decimals)}%`;
}

/**
 * Splits a parimutuel pool into its net payout pool and takeout fee.
 */
export function calculateNetPool(
  totalPool: number,
  takeoutFeeRate = DEFAULT_TAKEOUT_FEE_RATE,
): { netPool: number; takeoutFeeAmount: number } {
  const pool = sanitizeAmount(totalPool);
  const feeRate = sanitizeFeeRate(takeoutFeeRate);
  const takeoutFeeAmount = pool * feeRate;
  return {
    netPool: pool - takeoutFeeAmount,
    takeoutFeeAmount,
  };
}

/**
 * Calculates implied probabilities and parimutuel odds for any number of outcomes.
 *
 * Implied probability is stake / total pool. Decimal odds are net pool / outcome
 * stake, because every unit staked on the winning outcome shares the whole net pool.
 */
export function calculateMarketOdds(
  outcomes: OutcomePool[],
  takeoutFeeRate = DEFAULT_TAKEOUT_FEE_RATE,
): MarketPoolSummary {
  const feeRate = sanitizeFeeRate(takeoutFeeRate);
  const sanitizedOutcomes = outcomes.map((outcome) => ({
    ...outcome,
    stake: sanitizeAmount(outcome.stake),
  }));
  const totalPool = sanitizedOutcomes.reduce(
    (sum, outcome) => sum + outcome.stake,
    0,
  );
  const { netPool, takeoutFeeAmount } = calculateNetPool(totalPool, feeRate);
  const outcomeCount = sanitizedOutcomes.length;

  const summaries = sanitizedOutcomes.map<MarketOddsSummary>((outcome) => {
    const impliedProbability =
      totalPool > 0
        ? outcome.stake / totalPool
        : outcomeCount > 0
          ? 1 / outcomeCount
          : 0;
    const decimalOdds =
      outcome.stake > 0 ? netPool / outcome.stake : null;

    return {
      outcomeId: outcome.id,
      name: outcome.name,
      stake: outcome.stake,
      impliedProbability,
      impliedProbabilityPercent: impliedProbability * 100,
      decimalOdds,
      americanOdds: decimalToAmericanOdds(decimalOdds),
      fractionalOdds: decimalToFractionalOdds(decimalOdds),
    };
  });

  return {
    totalPool,
    netPool,
    takeoutFeeRate: feeRate,
    takeoutFeeAmount,
    outcomes: summaries,
  };
}

/**
 * Convenience wrapper for binary YES/NO markets. YES uses outcome id 1, NO id 0.
 */
export function calculateBinaryParimutuelOdds(
  yesStake: number,
  noStake: number,
  takeoutFeeRate = DEFAULT_TAKEOUT_FEE_RATE,
): BinaryMarketOddsSummary {
  const summary = calculateMarketOdds(
    [
      { id: 1, name: "YES", stake: yesStake },
      { id: 0, name: "NO", stake: noStake },
    ],
    takeoutFeeRate,
  );

  return {
    totalPool: summary.totalPool,
    netPool: summary.netPool,
    takeoutFeeRate: summary.takeoutFeeRate,
    takeoutFeeAmount: summary.takeoutFeeAmount,
    yes: summary.outcomes[0],
    no: summary.outcomes[1],
  };
}

/**
 * Simulates a prospective bet and its effect on the pool.
 *
 * The projected payout is the bettor's share of the winning pool multiplied by
 * the post-bet net pool. Because the bet itself joins the pool, the payout
 * includes the bettor's stake.
 */
export function simulateBet(params: BetSimulationParams): BetSimulationResult {
  const {
    outcomes,
    targetOutcomeId,
    betAmount,
    takeoutFeeRate = DEFAULT_TAKEOUT_FEE_RATE,
    enforceMinPayoutFloor = false,
  } = params;

  const bet = sanitizeAmount(betAmount);
  const feeRate = sanitizeFeeRate(takeoutFeeRate);

  const baseOutcomes: OutcomePool[] = outcomes.map((outcome) => ({
    id: outcome.id,
    name: outcome.name,
    stake: sanitizeAmount(outcome.stake),
  }));

  const targetExists = baseOutcomes.some(
    (outcome) => String(outcome.id) === String(targetOutcomeId),
  );
  if (!targetExists) {
    baseOutcomes.push({
      id: targetOutcomeId,
      name: String(targetOutcomeId),
      stake: 0,
    });
  }

  const preBetSummary = calculateMarketOdds(baseOutcomes, feeRate);
  const preBetTarget = preBetSummary.outcomes.find(
    (outcome) => String(outcome.outcomeId) === String(targetOutcomeId),
  );

  const postBetOutcomes = baseOutcomes.map((outcome) => ({
    ...outcome,
    stake:
      String(outcome.id) === String(targetOutcomeId)
        ? outcome.stake + bet
        : outcome.stake,
  }));
  const postBetSummary = calculateMarketOdds(postBetOutcomes, feeRate);
  const postBetTarget = postBetSummary.outcomes.find(
    (outcome) => String(outcome.outcomeId) === String(targetOutcomeId),
  );

  const postBetOutcomeStake = postBetTarget?.stake ?? bet;

  let expectedPayout = 0;
  if (bet > 0 && postBetOutcomeStake > 0) {
    expectedPayout = (bet / postBetOutcomeStake) * postBetSummary.netPool;
    if (enforceMinPayoutFloor && expectedPayout < bet * MIN_DECIMAL_ODDS) {
      expectedPayout = bet * MIN_DECIMAL_ODDS;
    }
  }

  const effectiveDecimalOdds = bet > 0 ? expectedPayout / bet : 0;
  const expectedProfit = expectedPayout - bet;

  const preBetProbabilityPercent =
    preBetTarget?.impliedProbabilityPercent ?? 0;
  const postBetProbabilityPercent =
    postBetTarget?.impliedProbabilityPercent ?? 0;

  const preBetDecimalOdds = preBetTarget?.decimalOdds ?? null;
  const oddsSlippagePercent =
    preBetDecimalOdds != null && preBetDecimalOdds > 0 && bet > 0
      ? Math.max(
          0,
          ((preBetDecimalOdds - effectiveDecimalOdds) / preBetDecimalOdds) *
            100,
        )
      : 0;

  return {
    targetOutcomeId,
    betAmount: bet,
    takeoutFeeRate: feeRate,

    preBetTotalPool: preBetSummary.totalPool,
    preBetNetPool: preBetSummary.netPool,
    preBetOutcomeStake: preBetTarget?.stake ?? 0,
    preBetProbability: preBetTarget?.impliedProbability ?? 0,
    preBetProbabilityPercent,
    preBetDecimalOdds,
    preBetAmericanOdds: preBetTarget?.americanOdds ?? "—",

    postBetTotalPool: postBetSummary.totalPool,
    postBetNetPool: postBetSummary.netPool,
    postBetOutcomeStake,
    postBetProbability: postBetTarget?.impliedProbability ?? 0,
    postBetProbabilityPercent,
    postBetDecimalOdds:
      postBetTarget?.decimalOdds ?? effectiveDecimalOdds,
    postBetAmericanOdds:
      postBetTarget?.americanOdds ?? decimalToAmericanOdds(effectiveDecimalOdds),

    expectedPayout,
    expectedProfit,
    effectiveDecimalOdds,
    effectiveAmericanOdds: decimalToAmericanOdds(effectiveDecimalOdds),
    roiPercent: bet > 0 ? (expectedProfit / bet) * 100 : 0,

    probabilityShiftPercent:
      postBetProbabilityPercent - preBetProbabilityPercent,
    oddsSlippagePercent,
    takeoutFeeDeduction: bet * feeRate,

    updatedOutcomes: postBetSummary.outcomes,
  };
}

/**
 * Convenience simulation helper for binary markets.
 * Accepts "YES"/"NO" or the contract outcome ids 1/0.
 */
export function simulateBinaryBet(
  yesStake: number,
  noStake: number,
  outcome: "YES" | "NO" | 1 | 0,
  betAmount: number,
  takeoutFeeRate = DEFAULT_TAKEOUT_FEE_RATE,
): BetSimulationResult {
  return simulateBet({
    outcomes: [
      { id: 1, name: "YES", stake: yesStake },
      { id: 0, name: "NO", stake: noStake },
    ],
    targetOutcomeId: outcome === "YES" || outcome === 1 ? 1 : 0,
    betAmount,
    takeoutFeeRate,
  });
}
