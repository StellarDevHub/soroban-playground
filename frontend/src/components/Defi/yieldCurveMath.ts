/**
 * Yield Curve & Impermanent Loss Mathematics for Constant-Product and Concentrated Liquidity AMMs.
 * Implements Uniswap v3 & Soroban AMM liquidity formulas with high numerical precision.
 */

export interface TokenAmounts {
  tokenA: number;
  tokenB: number;
}

export interface YieldScenario {
  priceChangePct: number;
  priceRatio: number;
  constantProductIlPct: number;
  concentratedIlPct: number;
  feeAprPct: number;
  concentratedNetReturnPct: number;
  constantProductNetReturnPct: number;
  inRange: boolean;
}

export interface ReturnDataPoint {
  day: number;
  dateLabel: string;
  priceRatio: number;
  price: number;
  inRange: boolean;
  cumulativeFeesPct: number;
  concentratedReturnPct: number;
  constantProductReturnPct: number;
  hodlReturnPct: number;
}

/**
 * Standard Constant-product pool impermanent loss (x * y = k).
 * Formula: 2 * sqrt(P / P0) / (1 + P / P0) - 1
 */
export function impermanentLoss(priceRatio: number): number {
  if (!Number.isFinite(priceRatio) || priceRatio <= 0) return 0;
  return (2 * Math.sqrt(priceRatio)) / (1 + priceRatio) - 1;
}

/**
 * Exact token composition for a concentrated liquidity position with liquidity L = 1.
 * @param price Current price P
 * @param lower Lower bound of price range Pa
 * @param upper Upper bound of price range Pb
 */
export function concentratedAmounts(
  price: number,
  lower: number,
  upper: number,
): TokenAmounts {
  const lo = Math.sqrt(Math.max(lower, Number.EPSILON));
  const hi = Math.sqrt(Math.max(upper, lower + Number.EPSILON));
  const p = Math.sqrt(Math.max(price, Number.EPSILON));

  if (p <= lo) {
    return { tokenA: 1 / lo - 1 / hi, tokenB: 0 };
  }
  if (p >= hi) {
    return { tokenA: 0, tokenB: hi - lo };
  }
  return { tokenA: 1 / p - 1 / hi, tokenB: p - lo };
}

/**
 * Capital efficiency (leverage) multiplier for concentrated liquidity.
 * Represents how much more virtual liquidity is provided compared to full range (v2) pool.
 * Formula for entry price P0 = 1: 1 / (1 - (sqrt(lower) + 1 / sqrt(upper)) / 2)
 */
export function concentratedMultiplier(
  lower: number,
  upper: number,
  entryPrice: number = 1,
): number {
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower <= 0 || upper <= lower) {
    return 1;
  }
  const lo = Math.sqrt(lower);
  const hi = Math.sqrt(upper);
  const p0 = Math.sqrt(Math.max(entryPrice, Number.EPSILON));

  if (entryPrice <= lower) {
    const cost = (1 / lo - 1 / hi) * entryPrice;
    return cost > 0 ? (2 * p0) / cost : 1;
  }
  if (entryPrice >= upper) {
    const cost = hi - lo;
    return cost > 0 ? (2 * p0) / cost : 1;
  }

  const denom = 1 - (lo + entryPrice / hi) / (2 * p0);
  return denom > 1e-9 ? 1 / denom : 1;
}

/**
 * Exact Impermanent Loss for concentrated liquidity ranges.
 * Ratio of concentrated position value at current price to the HODL value of initial token deposit minus 1.
 *
 * @param priceRatio Current price / entry price (P / P0)
 * @param lower Lower bound price ratio (Pa / P0)
 * @param upper Upper bound price ratio (Pb / P0)
 * @param entryPrice Optional entry price baseline (defaults to 1.0)
 */
export function concentratedImpermanentLoss(
  priceRatio: number,
  lower: number,
  upper: number,
  entryPrice: number = 1,
): number {
  if (!Number.isFinite(priceRatio) || priceRatio <= 0) return 0;
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower <= 0 || upper <= lower) {
    return impermanentLoss(priceRatio);
  }

  const p0 = Math.max(entryPrice, Number.EPSILON);
  const currentPrice = priceRatio * p0;

  const initial = concentratedAmounts(p0, lower, upper);
  const current = concentratedAmounts(currentPrice, lower, upper);

  const initialValue = initial.tokenA * p0 + initial.tokenB;
  if (initialValue <= 0) return 0;

  const hodlValue = initial.tokenA * currentPrice + initial.tokenB;
  if (hodlValue <= 0) return 0;

  const posValue = current.tokenA * currentPrice + current.tokenB;
  return posValue / hodlValue - 1;
}

/**
 * Concentrated position value relative to holding its initial token mix.
 * Alias for concentratedImpermanentLoss with default entryPrice = 1.
 */
export function concentratedRelativeValue(
  priceRatio: number,
  lower: number,
  upper: number,
): number {
  return concentratedImpermanentLoss(priceRatio, lower, upper, 1);
}

/**
 * Estimates baseline annual fee return (APR) for standard full-range liquidity.
 */
export function estimatedFeeApr(
  dailyVolume: number,
  feeBps: number,
  liquiditySharePct: number,
  positionValue: number,
): number {
  if (positionValue <= 0 || dailyVolume <= 0 || feeBps <= 0) return 0;
  return (dailyVolume * (feeBps / 10_000) * (liquiditySharePct / 100) * 365) / positionValue;
}

/**
 * Calculates fee APR for concentrated liquidity positions.
 * Accounts for capital efficiency multiplier and whether the current price is within active bounds.
 */
export function concentratedFeeApr(
  dailyVolume: number,
  feeBps: number,
  liquiditySharePct: number,
  positionValue: number,
  lower: number,
  upper: number,
  currentPriceRatio: number = 1,
): number {
  if (positionValue <= 0) return 0;
  if (currentPriceRatio < lower || currentPriceRatio > upper) {
    // Position is out of range, earning 0 fees
    return 0;
  }
  const baseApr = estimatedFeeApr(dailyVolume, feeBps, liquiditySharePct, positionValue);
  const multiplier = concentratedMultiplier(lower, upper, 1);
  return baseApr * multiplier;
}

/**
 * Generate yield curve scenarios across a range of price changes.
 */
export function generateYieldCurveScenarios(
  lower: number,
  upper: number,
  dailyVolume: number,
  feeBps: number,
  liquiditySharePct: number,
  positionValue: number,
  minChangePct: number = -90,
  maxChangePct: number = 500,
  steps: number = 120,
): YieldScenario[] {
  const baseFeeApr = estimatedFeeApr(dailyVolume, feeBps, liquiditySharePct, positionValue);
  const multiplier = concentratedMultiplier(lower, upper, 1);

  return Array.from({ length: steps }, (_, i) => {
    const priceChangePct = minChangePct + ((maxChangePct - minChangePct) * i) / (steps - 1);
    const ratio = 1 + priceChangePct / 100;
    const inRange = ratio >= lower && ratio <= upper;

    const cpIl = impermanentLoss(ratio);
    const concIl = concentratedImpermanentLoss(ratio, lower, upper, 1);

    // Quarter-year (90 days) assumed fee accumulation for scenario comparison
    const timeFraction = 0.25;
    const activeFeeApr = inRange ? baseFeeApr * multiplier : 0;
    const feeAccrued = inRange ? activeFeeApr * timeFraction : 0;
    const cpFeeAccrued = baseFeeApr * timeFraction;

    return {
      priceChangePct,
      priceRatio: ratio,
      constantProductIlPct: cpIl * 100,
      concentratedIlPct: concIl * 100,
      feeAprPct: activeFeeApr * 100,
      concentratedNetReturnPct: (concIl + feeAccrued) * 100,
      constantProductNetReturnPct: (cpIl + cpFeeAccrued) * 100,
      inRange,
    };
  });
}

/**
 * Generates historical (backtested) vs projected return series for Chart.js visualization.
 */
export function generateHistoricalVsProjectedSeries(options: {
  lower: number;
  upper: number;
  dailyVolume: number;
  feeBps: number;
  liquiditySharePct: number;
  positionValue: number;
  basePrice?: number;
  historyDays?: number;
  projectDays?: number;
}): {
  historical: ReturnDataPoint[];
  projected: ReturnDataPoint[];
} {
  const {
    lower,
    upper,
    dailyVolume,
    feeBps,
    liquiditySharePct,
    positionValue,
    basePrice = 1.0,
    historyDays = 30,
    projectDays = 30,
  } = options;

  const baseApr = estimatedFeeApr(dailyVolume, feeBps, liquiditySharePct, positionValue);
  const mult = concentratedMultiplier(lower, upper, 1);
  const dailyBaseFeeRate = baseApr / 365;

  // 1. Generate Historical Data (Deterministic historical price path over past N days)
  const historical: ReturnDataPoint[] = [];
  let cumConcentratedFees = 0;
  let cumCpFees = 0;

  for (let i = historyDays; i >= 0; i--) {
    const day = i === 0 ? 0 : -i;
    // Controlled historical price movement with mean reversion and slight volatility
    const cycle = Math.sin((day / 6) * Math.PI) * 0.12 + Math.cos((day / 15) * Math.PI) * 0.08;
    const priceRatio = Math.max(0.1, 1 + cycle);
    const price = basePrice * priceRatio;
    const inRange = priceRatio >= lower && priceRatio <= upper;

    if (day > -historyDays) {
      if (inRange) {
        cumConcentratedFees += dailyBaseFeeRate * mult;
      }
      cumCpFees += dailyBaseFeeRate;
    }

    const cpIl = impermanentLoss(priceRatio);
    const concIl = concentratedImpermanentLoss(priceRatio, lower, upper, 1);
    const hodlReturn = priceRatio - 1;

    historical.push({
      day,
      dateLabel: day === 0 ? "Today" : `T${day}d`,
      priceRatio,
      price,
      inRange,
      cumulativeFeesPct: cumConcentratedFees * 100,
      concentratedReturnPct: (concIl + cumConcentratedFees) * 100,
      constantProductReturnPct: (cpIl + cumCpFees) * 100,
      hodlReturnPct: hodlReturn * 100,
    });
  }

  // 2. Generate Projected Data (Forward-looking N days under anticipated market conditions)
  const projected: ReturnDataPoint[] = [];
  let projConcentratedFees = cumConcentratedFees;
  let projCpFees = cumCpFees;

  for (let d = 0; d <= projectDays; d++) {
    const day = d;
    // Expected forward price trajectory (mild upward drift of +5% over period with moderate oscillation)
    const drift = (day / projectDays) * 0.05;
    const oscillation = Math.sin((day / 7) * Math.PI) * 0.06;
    const priceRatio = Math.max(0.1, 1 + drift + oscillation);
    const price = basePrice * priceRatio;
    const inRange = priceRatio >= lower && priceRatio <= upper;

    if (day > 0) {
      if (inRange) {
        projConcentratedFees += dailyBaseFeeRate * mult;
      }
      projCpFees += dailyBaseFeeRate;
    }

    const cpIl = impermanentLoss(priceRatio);
    const concIl = concentratedImpermanentLoss(priceRatio, lower, upper, 1);
    const hodlReturn = priceRatio - 1;

    projected.push({
      day,
      dateLabel: day === 0 ? "Today" : `+${day}d`,
      priceRatio,
      price,
      inRange,
      cumulativeFeesPct: projConcentratedFees * 100,
      concentratedReturnPct: (concIl + projConcentratedFees) * 100,
      constantProductReturnPct: (cpIl + projCpFees) * 100,
      hodlReturnPct: hodlReturn * 100,
    });
  }

  return { historical, projected };
}
