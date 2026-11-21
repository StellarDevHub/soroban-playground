import {
  concentratedAmounts,
  concentratedRelativeValue,
  concentratedImpermanentLoss,
  capitalEfficiencyMultiplier,
  estimatedFeeApr,
  concentratedFeeApr,
  impermanentLoss,
  FEE_TIERS,
} from "../../components/Defi/yieldCurveMath";

describe("Soroban AMM & Concentrated Liquidity Mathematical Engine", () => {
  describe("Constant-Product AMM (x*y=k) Impermanent Loss", () => {
    test("IL is 0 at entry price ratio (1.0)", () => {
      expect(impermanentLoss(1)).toBe(0);
    });

    test("IL is symmetric in reciprocal price movements", () => {
      // 4x price move and 0.25x price move produce the exact same IL (-20%)
      const il4x = impermanentLoss(4);
      const il025x = impermanentLoss(0.25);
      expect(il4x).toBeCloseTo(-0.2, 10);
      expect(il025x).toBeCloseTo(-0.2, 10);
      expect(il4x).toBeCloseTo(il025x, 10);
    });

    test("IL increases monotonically as price diverges further from entry", () => {
      const il12 = impermanentLoss(1.2);
      const il15 = impermanentLoss(1.5);
      const il20 = impermanentLoss(2.0);
      const il50 = impermanentLoss(5.0);

      expect(il12).toBeLessThan(0);
      expect(il15).toBeLessThan(il12);
      expect(il20).toBeLessThan(il15);
      expect(il50).toBeLessThan(il20);
    });

    test("handles non-finite and negative inputs gracefully", () => {
      expect(impermanentLoss(0)).toBe(0);
      expect(impermanentLoss(-1)).toBe(0);
      expect(impermanentLoss(NaN)).toBe(0);
      expect(impermanentLoss(Infinity)).toBe(0);
    });
  });

  describe("Concentrated Liquidity Token Amounts", () => {
    test("holds 100% token A below the price range", () => {
      const { tokenA, tokenB } = concentratedAmounts(0.25, 0.5, 2.0);
      expect(tokenB).toBe(0);
      expect(tokenA).toBeGreaterThan(0);
    });

    test("holds 100% token B above the price range", () => {
      const { tokenA, tokenB } = concentratedAmounts(4.0, 0.5, 2.0);
      expect(tokenA).toBe(0);
      expect(tokenB).toBeGreaterThan(0);
    });

    test("holds both token A and token B within the active price range", () => {
      const { tokenA, tokenB } = concentratedAmounts(1.0, 0.5, 2.0);
      expect(tokenA).toBeGreaterThan(0);
      expect(tokenB).toBeGreaterThan(0);
    });

    test("handles invalid ranges gracefully", () => {
      expect(concentratedAmounts(1.0, 2.0, 1.0)).toEqual({ tokenA: 0, tokenB: 0 });
      expect(concentratedAmounts(1.0, -1, 2.0)).toEqual({ tokenA: 0, tokenB: 0 });
      expect(concentratedAmounts(0, 0.5, 2.0)).toEqual({ tokenA: 0, tokenB: 0 });
    });
  });

  describe("Concentrated Liquidity Impermanent Loss & Relative Value", () => {
    test("concentrated position has 0 impermanent loss at entry price (priceRatio = 1)", () => {
      expect(concentratedImpermanentLoss(1, 0.5, 2.0)).toBeCloseTo(0, 10);
      expect(concentratedRelativeValue(1, 0.5, 2.0)).toBeCloseTo(0, 10);
    });

    test("concentrated IL is strictly greater than standard AMM IL for any price change", () => {
      // In concentrated liquidity, impermanent loss is amplified by capital concentration
      const stdIl = impermanentLoss(1.5);
      const concIl = concentratedImpermanentLoss(1.5, 0.5, 2.0);
      expect(concIl).toBeLessThan(stdIl);
    });

    test("calculates concentrated IL when price moves below range boundary", () => {
      const concIlBelow = concentratedImpermanentLoss(0.25, 0.5, 2.0);
      expect(concIlBelow).toBeLessThan(0);
      expect(Number.isFinite(concIlBelow)).toBe(true);
    });

    test("calculates concentrated IL when price moves above range boundary", () => {
      const concIlAbove = concentratedImpermanentLoss(4.0, 0.5, 2.0);
      expect(concIlAbove).toBeLessThan(0);
      expect(Number.isFinite(concIlAbove)).toBe(true);
    });

    test("handles non-finite or invalid bounds defensively", () => {
      expect(concentratedImpermanentLoss(1.5, 2.0, 0.5)).toBe(0);
      expect(concentratedImpermanentLoss(1.5, -0.5, 2.0)).toBe(0);
      expect(concentratedImpermanentLoss(NaN, 0.5, 2.0)).toBe(0);
    });
  });

  describe("Capital Efficiency Multiplier", () => {
    test("multiplier is > 1 for any concentrated range", () => {
      const eff = capitalEfficiencyMultiplier(0.5, 2.0);
      expect(eff).toBeGreaterThan(1);
    });

    test("tighter range yields higher capital efficiency multiplier", () => {
      const effWide = capitalEfficiencyMultiplier(0.5, 2.0); // [0.5, 2.0]
      const effTight = capitalEfficiencyMultiplier(0.8, 1.25); // [0.8, 1.25]
      const effVeryTight = capitalEfficiencyMultiplier(0.95, 1.05); // [0.95, 1.05]

      expect(effTight).toBeGreaterThan(effWide);
      expect(effVeryTight).toBeGreaterThan(effTight);
    });

    test("returns 1 for invalid or inverted range bounds", () => {
      expect(capitalEfficiencyMultiplier(2.0, 0.5)).toBe(1);
      expect(capitalEfficiencyMultiplier(-1, 2.0)).toBe(1);
    });
  });

  describe("Fee APR & Yield Calculations", () => {
    test("annualizes standard pool fee APR correctly", () => {
      // $1,000,000 daily volume * 0.30% fee = $3,000 daily pool fees
      // 1% share = $30/day -> $10,950/yr on $10,000 capital = 1.095 (109.5% APR)
      const apr = estimatedFeeApr(1_000_000, 30, 1, 10_000);
      expect(apr).toBeCloseTo(1.095, 10);
    });

    test("returns 0 fee APR when position value or daily volume is 0", () => {
      expect(estimatedFeeApr(1_000_000, 30, 1, 0)).toBe(0);
      expect(estimatedFeeApr(0, 30, 1, 10_000)).toBe(0);
      expect(estimatedFeeApr(1_000_000, 0, 1, 10_000)).toBe(0);
    });

    test("concentrated fee APR boosts base fee APR by capital efficiency when in range", () => {
      const baseApr = estimatedFeeApr(1_000_000, 30, 1, 10_000);
      const concApr = concentratedFeeApr(1_000_000, 30, 1, 10_000, 0.5, 2.0, true);
      const efficiency = capitalEfficiencyMultiplier(0.5, 2.0);

      expect(concApr).toBeCloseTo(baseApr * efficiency, 8);
      expect(concApr).toBeGreaterThan(baseApr);
    });

    test("concentrated fee APR is 0 when out of range", () => {
      const concAprOutOfRange = concentratedFeeApr(1_000_000, 30, 1, 10_000, 0.5, 2.0, false);
      expect(concAprOutOfRange).toBe(0);
    });
  });

  describe("Fee Tier Presets", () => {
    test("includes standard DeFi fee tiers: 0.01%, 0.05%, 0.30%, 1.00%", () => {
      expect(FEE_TIERS).toHaveLength(4);
      expect(FEE_TIERS.map((t) => t.bps)).toEqual([1, 5, 30, 100]);
    });
  });
});
