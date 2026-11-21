/**
 * Soroban AMM & Concentrated Liquidity Mathematical Engine
 *
 * Implements:
 * 1. Constant-product (x*y=k) Impermanent Loss
 * 2. Concentrated Liquidity (Uniswap v3 style) token distribution
 * 3. Concentrated Impermanent Loss & Relative Position Value
 * 4. Capital Efficiency Multiplier
 * 5. Multi-Tier Fee APR & Projected Yield
 */

/** Constant-product pool math used by standard AMM (x*y=k). */
export function impermanentLoss(priceRatio: number): number {
  if (!Number.isFinite(priceRatio) || priceRatio <= 0) return 0;
  return (2 * Math.sqrt(priceRatio)) / (1 + priceRatio) - 1;
}

/** Token amounts for a concentrated position normalized to L = 1. */
export function concentratedAmounts(
  price: number,
  lower: number,
  upper: number
): { tokenA: number; tokenB: number } {
  if (lower >= upper || lower <= 0 || upper <= 0 || price <= 0) {
    return { tokenA: 0, tokenB: 0 };
  }
  const lo = Math.sqrt(Math.max(lower, Number.EPSILON));
  const hi = Math.sqrt(Math.max(upper, lower + Number.EPSILON));
  const p = Math.sqrt(Math.max(price, Number.EPSILON));

  if (p <= lo) return { tokenA: 1 / lo - 1 / hi, tokenB: 0 };
  if (p >= hi) return { tokenA: 0, tokenB: hi - lo };
  return { tokenA: 1 / p - 1 / hi, tokenB: p - lo };
}

/**
 * Concentrated position value relative to holding its initial token mix (HODL).
 * Returns fractional gain or loss: (V_conc(p) - V_hold(p)) / V_hold(p)
 */
export function concentratedRelativeValue(
  priceRatio: number,
  lower: number,
  upper: number,
  entryPrice = 1
): number {
  return concentratedImpermanentLoss(priceRatio, lower, upper, entryPrice);
}

/**
 * Exact impermanent loss calculation formula for concentrated liquidity ranges.
 *
 * @param priceRatio Current price relative to entry price (or current price if entryPrice = 1)
 * @param lower Lower price boundary of the concentrated range
 * @param upper Upper price boundary of the concentrated range
 * @param entryPrice Position entry price (default: 1)
 * @returns Fractional impermanent loss (e.g. -0.05 for -5%)
 */
export function concentratedImpermanentLoss(
  priceRatio: number,
  lower: number,
  upper: number,
  entryPrice = 1
): number {
  if (
    !Number.isFinite(priceRatio) ||
    !Number.isFinite(lower) ||
    !Number.isFinite(upper) ||
    lower >= upper ||
    lower <= 0 ||
    upper <= 0 ||
    priceRatio <= 0 ||
    entryPrice <= 0
  ) {
    return 0;
  }

  const lo = Math.sqrt(lower);
  const hi = Math.sqrt(upper);
  const p0 = Math.sqrt(entryPrice);
  const p = Math.sqrt(priceRatio * entryPrice);

  // Initial token amounts at entry price
  let x0 = 0;
  let y0 = 0;
  if (p0 <= lo) {
    x0 = 1 / lo - 1 / hi;
    y0 = 0;
  } else if (p0 >= hi) {
    x0 = 0;
    y0 = hi - lo;
  } else {
    x0 = 1 / p0 - 1 / hi;
    y0 = p0 - lo;
  }

  // Value of holding the initial tokens at current price
  const vHold = x0 * (priceRatio * entryPrice) + y0;
  if (vHold <= 0) return 0;

  // Current token amounts at new price
  let x = 0;
  let y = 0;
  if (p <= lo) {
    x = 1 / lo - 1 / hi;
    y = 0;
  } else if (p >= hi) {
    x = 0;
    y = hi - lo;
  } else {
    x = 1 / p - 1 / hi;
    y = p - lo;
  }

  // Concentrated position value at current price
  const vConc = x * (priceRatio * entryPrice) + y;

  return (vConc - vHold) / vHold;
}

/**
 * Capital efficiency multiplier of a concentrated position compared to full-range (0, inf).
 * Multiplier = 1 / (1 - sqrt(lower / upper))
 */
export function capitalEfficiencyMultiplier(lower: number, upper: number): number {
  if (lower >= upper || lower <= 0 || upper <= 0) return 1;
  const ratio = Math.sqrt(lower / upper);
  if (ratio >= 1) return 1;
  return 1 / (1 - ratio);
}

/** Standard fee APR estimation from daily volume and fee basis points. */
export function estimatedFeeApr(
  dailyVolume: number,
  feeBps: number,
  liquiditySharePct: number,
  positionValue: number
): number {
  if (positionValue <= 0 || dailyVolume <= 0 || feeBps <= 0) return 0;
  return (dailyVolume * (feeBps / 10_000) * (liquiditySharePct / 100) * 365) / positionValue;
}

/** Concentrated liquidity fee APR factoring in capital concentration leverage. */
export function concentratedFeeApr(
  dailyVolume: number,
  feeBps: number,
  liquiditySharePct: number,
  positionValue: number,
  lower: number,
  upper: number,
  inRange = true
): number {
  if (!inRange) return 0;
  const baseApr = estimatedFeeApr(dailyVolume, feeBps, liquiditySharePct, positionValue);
  const efficiency = capitalEfficiencyMultiplier(lower, upper);
  return baseApr * efficiency;
}

/** Standard AMM fee tier definitions in basis points */
export const FEE_TIERS = [
  { label: "0.01% (Stable pairs)", bps: 1 },
  { label: "0.05% (Correlated pairs)", bps: 5 },
  { label: "0.30% (Standard pairs)", bps: 30 },
  { label: "1.00% (Exotic / Volatile)", bps: 100 },
] as const;
