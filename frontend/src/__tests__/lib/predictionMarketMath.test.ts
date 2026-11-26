// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * @file predictionMarketMath.test.ts
 * Unit tests for parimutuel pool math, odds conversion and bet simulation.
 */

import {
  DEFAULT_TAKEOUT_FEE_RATE,
  MIN_DECIMAL_ODDS,
  americanToDecimalOdds,
  calculateBinaryParimutuelOdds,
  calculateMarketOdds,
  calculateNetPool,
  decimalToAmericanOdds,
  decimalToFractionalOdds,
  formatDecimalOdds,
  formatProbability,
  simulateBet,
  simulateBinaryBet,
  type OutcomePool,
} from "../../lib/predictionMarketMath";

describe("predictionMarketMath", () => {
  describe("odds conversions and formatting", () => {
    it("converts decimal odds to American moneyline strings", () => {
      expect(decimalToAmericanOdds(2.5)).toBe("+150");
      expect(decimalToAmericanOdds(3)).toBe("+200");
      expect(decimalToAmericanOdds(4.25)).toBe("+325");
      expect(decimalToAmericanOdds(2)).toBe("+100");
      expect(decimalToAmericanOdds(1.5)).toBe("-200");
      expect(decimalToAmericanOdds(1.25)).toBe("-400");
      expect(decimalToAmericanOdds(1.8)).toBe("-125");
      expect(decimalToAmericanOdds(1)).toBe("-10000");
      expect(decimalToAmericanOdds(0.8)).toBe("-10000");
      expect(decimalToAmericanOdds(null)).toBe("—");
      expect(decimalToAmericanOdds(undefined)).toBe("—");
      expect(decimalToAmericanOdds(Infinity)).toBe("—");
    });

    it("converts American odds back to decimal odds", () => {
      expect(americanToDecimalOdds(150)).toBeCloseTo(2.5, 4);
      expect(americanToDecimalOdds("+150")).toBeCloseTo(2.5, 4);
      expect(americanToDecimalOdds(-200)).toBeCloseTo(1.5, 4);
      expect(americanToDecimalOdds("-200")).toBeCloseTo(1.5, 4);
      expect(americanToDecimalOdds("EVEN")).toBe(2);
      expect(americanToDecimalOdds(0)).toBe(2);
      expect(americanToDecimalOdds("invalid")).toBe(2);
    });

    it("converts decimal odds to simplified fractional odds", () => {
      expect(decimalToFractionalOdds(2.5)).toBe("3/2");
      expect(decimalToFractionalOdds(2)).toBe("1/1");
      expect(decimalToFractionalOdds(1.5)).toBe("1/2");
      expect(decimalToFractionalOdds(3)).toBe("2/1");
      expect(decimalToFractionalOdds(1.3333)).toBe("1/3");
      expect(decimalToFractionalOdds(1)).toBe("—");
      expect(decimalToFractionalOdds(null)).toBe("—");
    });

    it("formats decimal odds and probabilities for display", () => {
      expect(formatDecimalOdds(2.456)).toBe("2.46x");
      expect(formatDecimalOdds(null)).toBe("—");
      expect(formatDecimalOdds(undefined)).toBe("—");
      expect(formatDecimalOdds(0)).toBe("—");

      expect(formatProbability(0.6543)).toBe("65.4%");
      expect(formatProbability(0.6543, 2)).toBe("65.43%");
      expect(formatProbability(1.5)).toBe("100.0%");
      expect(formatProbability(-0.2)).toBe("0.0%");
      expect(formatProbability(NaN)).toBe("0.0%");
    });
  });

  describe("net pool and takeout fee", () => {
    it("deducts the takeout fee from the total pool", () => {
      expect(calculateNetPool(1000, 0.02)).toEqual({
        netPool: 980,
        takeoutFeeAmount: 20,
      });
      expect(calculateNetPool(500)).toEqual({
        netPool: 490,
        takeoutFeeAmount: 10,
      });
      expect(calculateNetPool(1000, 0)).toEqual({
        netPool: 1000,
        takeoutFeeAmount: 0,
      });
    });

    it("treats negative or invalid pools and fees safely", () => {
      expect(calculateNetPool(-100)).toEqual({
        netPool: 0,
        takeoutFeeAmount: 0,
      });
      expect(calculateNetPool(NaN)).toEqual({
        netPool: 0,
        takeoutFeeAmount: 0,
      });
      expect(calculateNetPool(1000, 2).takeoutFeeAmount).toBeCloseTo(999.9, 6);
    });
  });

  describe("multi-outcome market odds", () => {
    it("computes exact parimutuel odds for a three-outcome pool", () => {
      const outcomes: OutcomePool[] = [
        { id: "A", name: "Team Alpha", stake: 500 },
        { id: "B", name: "Team Beta", stake: 300 },
        { id: "C", name: "Draw", stake: 200 },
      ];

      const summary = calculateMarketOdds(outcomes, 0.02);

      expect(summary.totalPool).toBe(1000);
      expect(summary.netPool).toBe(980);
      expect(summary.takeoutFeeRate).toBe(0.02);
      expect(summary.takeoutFeeAmount).toBe(20);
      expect(summary.outcomes).toHaveLength(3);

      const [alpha, beta, draw] = summary.outcomes;
      expect(alpha.impliedProbability).toBe(0.5);
      expect(alpha.impliedProbabilityPercent).toBe(50);
      expect(beta.impliedProbability).toBe(0.3);
      expect(draw.impliedProbability).toBe(0.2);

      expect(alpha.decimalOdds).toBeCloseTo(1.96, 4);
      expect(alpha.americanOdds).toBe("-104");
      expect(beta.decimalOdds).toBeCloseTo(3.2667, 4);
      expect(beta.americanOdds).toBe("+227");
      expect(draw.decimalOdds).toBeCloseTo(4.9, 4);
      expect(draw.americanOdds).toBe("+390");
    });

    it("splits an empty pool equally and leaves odds undefined", () => {
      const summary = calculateMarketOdds(
        [
          { id: 1, name: "One", stake: 0 },
          { id: 2, name: "Two", stake: 0 },
          { id: 3, name: "Three", stake: 0 },
          { id: 4, name: "Four", stake: 0 },
        ],
        0.03,
      );

      expect(summary.totalPool).toBe(0);
      expect(summary.netPool).toBe(0);
      summary.outcomes.forEach((outcome) => {
        expect(outcome.impliedProbability).toBe(0.25);
        expect(outcome.impliedProbabilityPercent).toBe(25);
        expect(outcome.decimalOdds).toBeNull();
        expect(outcome.americanOdds).toBe("—");
        expect(outcome.fractionalOdds).toBe("—");
      });
    });

    it("handles outcomes with zero stake in a one-sided pool", () => {
      const summary = calculateMarketOdds(
        [
          { id: 1, name: "Outcome 1", stake: 100 },
          { id: 2, name: "Outcome 2", stake: 0 },
        ],
        0.02,
      );

      expect(summary.outcomes[0].impliedProbability).toBe(1);
      expect(summary.outcomes[0].decimalOdds).toBeCloseTo(0.98, 4);
      expect(summary.outcomes[1].impliedProbability).toBe(0);
      expect(summary.outcomes[1].decimalOdds).toBeNull();
    });
  });

  describe("binary market odds", () => {
    it("computes YES and NO parimutuel odds", () => {
      const binary = calculateBinaryParimutuelOdds(600, 400, 0.02);

      expect(binary.totalPool).toBe(1000);
      expect(binary.netPool).toBe(980);
      expect(binary.yes.impliedProbabilityPercent).toBe(60);
      expect(binary.no.impliedProbabilityPercent).toBe(40);
      expect(binary.yes.decimalOdds).toBeCloseTo(1.6333, 3);
      expect(binary.yes.americanOdds).toBe("-158");
      expect(binary.no.decimalOdds).toBeCloseTo(2.45, 3);
      expect(binary.no.americanOdds).toBe("+145");
    });
  });

  describe("dynamic bet simulation", () => {
    it("models post-bet odds, slippage and payout for a large bet", () => {
      const simulation = simulateBet({
        outcomes: [
          { id: "A", name: "Alpha", stake: 500 },
          { id: "B", name: "Beta", stake: 500 },
        ],
        targetOutcomeId: "A",
        betAmount: 500,
        takeoutFeeRate: 0.02,
      });

      expect(simulation.preBetTotalPool).toBe(1000);
      expect(simulation.preBetOutcomeStake).toBe(500);
      expect(simulation.preBetProbabilityPercent).toBe(50);
      expect(simulation.preBetDecimalOdds).toBeCloseTo(1.96, 4);

      expect(simulation.postBetTotalPool).toBe(1500);
      expect(simulation.postBetOutcomeStake).toBe(1000);
      expect(simulation.postBetNetPool).toBe(1470);
      expect(simulation.postBetProbabilityPercent).toBeCloseTo(66.6667, 2);

      expect(simulation.expectedPayout).toBeCloseTo(735, 4);
      expect(simulation.expectedProfit).toBeCloseTo(235, 4);
      expect(simulation.effectiveDecimalOdds).toBeCloseTo(1.47, 4);
      expect(simulation.roiPercent).toBeCloseTo(47, 1);

      expect(simulation.probabilityShiftPercent).toBeCloseTo(16.6667, 2);
      expect(simulation.oddsSlippagePercent).toBeCloseTo(25, 1);
      expect(simulation.takeoutFeeDeduction).toBe(10);
    });

    it("simulates a binary bet on NO", () => {
      const simulation = simulateBinaryBet(700, 300, 0, 100, 0.02);

      expect(simulation.preBetProbabilityPercent).toBe(30);
      expect(simulation.preBetDecimalOdds).toBeCloseTo(3.2667, 3);
      expect(simulation.expectedPayout).toBeCloseTo(269.5, 2);
      expect(simulation.expectedProfit).toBeCloseTo(169.5, 2);
      expect(simulation.effectiveDecimalOdds).toBeCloseTo(2.695, 3);
      expect(simulation.oddsSlippagePercent).toBeCloseTo(17.5, 1);
      expect(simulation.probabilityShiftPercent).toBeCloseTo(6.36, 1);
    });

    it("handles a zero bet without changing the pool", () => {
      const simulation = simulateBinaryBet(500, 500, "YES", 0, 0.02);

      expect(simulation.betAmount).toBe(0);
      expect(simulation.expectedPayout).toBe(0);
      expect(simulation.expectedProfit).toBe(0);
      expect(simulation.oddsSlippagePercent).toBe(0);
      expect(simulation.probabilityShiftPercent).toBe(0);
      expect(simulation.preBetProbabilityPercent).toBe(50);
      expect(simulation.postBetProbabilityPercent).toBe(50);
    });

    it("handles a bet on an outcome with no existing stake", () => {
      const simulation = simulateBinaryBet(1000, 0, "NO", 100, 0.02);

      expect(simulation.preBetDecimalOdds).toBeNull();
      expect(simulation.preBetProbabilityPercent).toBe(0);
      expect(simulation.expectedPayout).toBeCloseTo(1078, 2);
      expect(simulation.effectiveDecimalOdds).toBeCloseTo(10.78, 2);
      expect(simulation.oddsSlippagePercent).toBe(0);
      expect(simulation.probabilityShiftPercent).toBeCloseTo(9.09, 1);
    });

    it("enforces the minimum decimal payout floor when requested", () => {
      const withoutFloor = simulateBinaryBet(999, 1, "YES", 1000, 0.05);
      expect(withoutFloor.effectiveDecimalOdds).toBeLessThan(1);

      const withFloor = simulateBet({
        outcomes: [
          { id: 1, name: "YES", stake: 999 },
          { id: 0, name: "NO", stake: 1 },
        ],
        targetOutcomeId: 1,
        betAmount: 1000,
        takeoutFeeRate: 0.05,
        enforceMinPayoutFloor: true,
      });
      expect(withFloor.effectiveDecimalOdds).toBeGreaterThanOrEqual(
        MIN_DECIMAL_ODDS,
      );
    });

    it("exposes the default takeout fee rate", () => {
      expect(DEFAULT_TAKEOUT_FEE_RATE).toBe(0.02);
    });
  });
});
