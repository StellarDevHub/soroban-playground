import {
  concentratedAmounts,
  concentratedFeeApr,
  concentratedImpermanentLoss,
  concentratedMultiplier,
  concentratedRelativeValue,
  estimatedFeeApr,
  generateHistoricalVsProjectedSeries,
  generateYieldCurveScenarios,
  impermanentLoss,
} from "../../components/Defi/yieldCurveMath";

describe("Soroban AMM yield math", () => {
  describe("Constant-product AMM math (x * y = k)", () => {
    test("constant-product impermanent loss is zero at entry and symmetric in reciprocal price", () => {
      expect(impermanentLoss(1)).toBe(0);
      expect(impermanentLoss(4)).toBeCloseTo(-0.2, 10);
      expect(impermanentLoss(0.25)).toBeCloseTo(-0.2, 10);
    });

    test("handles non-positive or invalid price ratios gracefully", () => {
      expect(impermanentLoss(0)).toBe(0);
      expect(impermanentLoss(-1)).toBe(0);
      expect(impermanentLoss(NaN)).toBe(0);
      expect(impermanentLoss(Infinity)).toBe(0);
    });

    test("annualizes the fee share from daily volume and configured bps", () => {
      expect(estimatedFeeApr(1_000_000, 30, 1, 10_000)).toBeCloseTo(1.095, 10);
      expect(estimatedFeeApr(1_000_000, 30, 1, 0)).toBe(0);
      expect(estimatedFeeApr(0, 30, 1, 10_000)).toBe(0);
    });
  });

  describe("Concentrated liquidity token amounts", () => {
    test("concentrated liquidity holds only token A below its range and token B above", () => {
      const below = concentratedAmounts(0.25, 0.5, 2);
      expect(below.tokenB).toBe(0);
      expect(below.tokenA).toBeGreaterThan(0);

      const above = concentratedAmounts(4, 0.5, 2);
      expect(above.tokenA).toBe(0);
      expect(above.tokenB).toBeGreaterThan(0);
    });

    test("holds positive amounts of both token A and token B strictly within range", () => {
      const mid = concentratedAmounts(1, 0.5, 2);
      expect(mid.tokenA).toBeGreaterThan(0);
      expect(mid.tokenB).toBeGreaterThan(0);
      // For symmetric range around 1, token amounts at price 1 should be equal
      expect(mid.tokenA).toBeCloseTo(mid.tokenB, 10);
    });
  });

  describe("Concentrated impermanent loss formulas", () => {
    test("concentrated position has no relative loss at entry", () => {
      expect(concentratedRelativeValue(1, 0.5, 2)).toBeCloseTo(0, 10);
      expect(concentratedImpermanentLoss(1, 0.5, 2)).toBeCloseTo(0, 10);
      expect(concentratedImpermanentLoss(1, 0.8, 1.25)).toBeCloseTo(0, 10);
    });

    test("concentrated impermanent loss is strictly deeper than standard constant product", () => {
      const cpLoss = impermanentLoss(1.2);
      const concLoss = concentratedImpermanentLoss(1.2, 0.5, 2);
      expect(concLoss).toBeLessThan(cpLoss);
      expect(concLoss).toBeLessThan(0);
    });

    test("concentrated impermanent loss matches high precision analytical solution for range [0.5, 2.0]", () => {
      // At lower boundary price = 0.5:
      // initialTokenA = 1 - 1/sqrt(2) = 1 - sqrt(2)/2
      // initialTokenB = 1 - sqrt(0.5) = 1 - sqrt(2)/2
      // At price 0.5:
      // posValue = (sqrt(2)/2) * 0.5 = sqrt(2)/4
      // hodlValue = (1 - sqrt(2)/2) * 0.5 + (1 - sqrt(2)/2) = 1.5 * (1 - sqrt(2)/2)
      // exact IL = (sqrt(2)/4) / (1.5 * (1 - sqrt(2)/2)) - 1 = (4*sqrt(2) - 6) / (6 - 3*sqrt(2))
      const expectedIlAtLower = (4 * Math.SQRT2 - 6) / (6 - 3 * Math.SQRT2);
      expect(concentratedImpermanentLoss(0.5, 0.5, 2)).toBeCloseTo(expectedIlAtLower, 8);
    });

    test("handles out-of-range bounds gracefully without throwing", () => {
      expect(concentratedImpermanentLoss(0.1, 0.5, 2)).toBeLessThan(0);
      expect(concentratedImpermanentLoss(10, 0.5, 2)).toBeLessThan(0);
      expect(concentratedImpermanentLoss(-1, 0.5, 2)).toBe(0);
      expect(concentratedImpermanentLoss(1, 2, 0.5)).toBe(0);
    });
  });

  describe("Concentrated multiplier and capital efficiency", () => {
    test("calculates exact capital efficiency multiplier for range [0.5, 2.0]", () => {
      // Analytical multiplier = 1 / (1 - (sqrt(0.5) + 1/sqrt(2)) / 2) = 1 / (1 - sqrt(2)/2) = 2 + sqrt(2)
      const expectedMultiplier = 2 + Math.SQRT2;
      expect(concentratedMultiplier(0.5, 2)).toBeCloseTo(expectedMultiplier, 8);
    });

    test("narrower ranges yield higher capital efficiency leverage", () => {
      const wide = concentratedMultiplier(0.5, 2);
      const narrow = concentratedMultiplier(0.8, 1.25);
      const veryNarrow = concentratedMultiplier(0.95, 1.05);

      expect(narrow).toBeGreaterThan(wide);
      expect(veryNarrow).toBeGreaterThan(narrow);
      expect(veryNarrow).toBeGreaterThan(30);
    });
  });

  describe("Concentrated Fee APR calculations", () => {
    test("concentrated fee APR scales with capital efficiency when within range", () => {
      const baseApr = estimatedFeeApr(1_000_000, 30, 1, 10_000);
      const concApr = concentratedFeeApr(1_000_000, 30, 1, 10_000, 0.5, 2, 1.0);
      const multiplier = concentratedMultiplier(0.5, 2);

      expect(concApr).toBeCloseTo(baseApr * multiplier, 8);
      expect(concApr).toBeGreaterThan(baseApr);
    });

    test("concentrated fee APR is strictly zero when price is outside range bounds", () => {
      // Below range lower bound
      expect(concentratedFeeApr(1_000_000, 30, 1, 10_000, 0.5, 2, 0.4)).toBe(0);
      // Above range upper bound
      expect(concentratedFeeApr(1_000_000, 30, 1, 10_000, 0.5, 2, 2.5)).toBe(0);
    });
  });

  describe("Scenario and Time Series Generators", () => {
    test("generates expected scenario curve points", () => {
      const scenarios = generateYieldCurveScenarios(0.5, 2, 1_000_000, 30, 1, 10_000, -50, 100, 20);
      expect(scenarios.length).toBe(20);
      expect(scenarios[0].priceChangePct).toBeCloseTo(-50, 2);
      expect(scenarios[scenarios.length - 1].priceChangePct).toBeCloseTo(100, 2);

      // Verify in-range flag
      const entryScenario = scenarios.find((s) => Math.abs(s.priceChangePct) < 5);
      expect(entryScenario?.inRange).toBe(true);
    });

    test("generates historical and projected series with valid data points", () => {
      const series = generateHistoricalVsProjectedSeries({
        lower: 0.8,
        upper: 1.25,
        dailyVolume: 500_000,
        feeBps: 30,
        liquiditySharePct: 2,
        positionValue: 20_000,
        historyDays: 14,
        projectDays: 14,
      });

      expect(series.historical.length).toBe(15);
      expect(series.projected.length).toBe(15);
      expect(series.historical[series.historical.length - 1].day).toBe(0);
      expect(series.projected[0].day).toBe(0);

      // Projected cumulative returns should be tracked
      expect(series.projected[14].day).toBe(14);
      expect(series.projected[14].concentratedReturnPct).toBeDefined();
    });
  });
});
