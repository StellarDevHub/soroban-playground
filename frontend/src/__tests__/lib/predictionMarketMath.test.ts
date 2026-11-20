// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import {
  DEFAULT_TAKEOUT_FEE_RATE,
  MIN_DECIMAL_ODDS,
  OutcomePool,
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
} from "../../lib/predictionMarketMath";

describe("predictionMarketMath", () => {
  describe("Odds Formatting & Conversions", () => {
    test("converts decimal odds to American moneyline odds accurately", () => {
      // Underdog / positive moneyline (> 2.0)
      expect(decimalToAmericanOdds(2.5)).toBe("+150");
      expect(decimalToAmericanOdds(3.0)).toBe("+200");
      expect(decimalToAmericanOdds(4.25)).toBe("+325");

      // Even money (= 2.0)
      expect(decimalToAmericanOdds(2.0)).toBe("+100");

      // Favorite / negative moneyline (1.0 < D < 2.0)
      expect(decimalToAmericanOdds(1.5)).toBe("-200");
      expect(decimalToAmericanOdds(1.25)).toBe("-400");
      expect(decimalToAmericanOdds(1.8)).toBe("-125");

      // Extreme edge cases (<= 1.0 or non-finite)
      expect(decimalToAmericanOdds(1.0)).toBe("-10000");
      expect(decimalToAmericanOdds(0.8)).toBe("-10000");
      expect(decimalToAmericanOdds(null)).toBe("—");
      expect(decimalToAmericanOdds(undefined)).toBe("—");
      expect(decimalToAmericanOdds(Infinity)).toBe("—");
    });

    test("converts American odds back to decimal odds", () => {
      expect(americanToDecimalOdds(150)).toBeCloseTo(2.5, 4);
      expect(americanToDecimalOdds("+150")).toBeCloseTo(2.5, 4);
      expect(americanToDecimalOdds(-200)).toBeCloseTo(1.5, 4);
      expect(americanToDecimalOdds("-200")).toBeCloseTo(1.5, 4);
      expect(americanToDecimalOdds("EVEN")).toBe(2.0);
      expect(americanToDecimalOdds(0)).toBe(2.0);
      expect(americanToDecimalOdds("invalid")).toBe(2.0);
    });

    test("converts decimal odds to fractional odds strings", () => {
      expect(decimalToFractionalOdds(2.5)).toBe("3/2");
      expect(decimalToFractionalOdds(2.0)).toBe("1/1");
      expect(decimalToFractionalOdds(1.5)).toBe("1/2");
      expect(decimalToFractionalOdds(3.0)).toBe("2/1");
      expect(decimalToFractionalOdds(1.3333)).toBe("1/3");
      expect(decimalToFractionalOdds(1.0)).toBe("—");
      expect(decimalToFractionalOdds(null)).toBe("—");
    });

    test("formats decimal odds and probability percentages cleanly", () => {
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

  describe("Parimutuel Net Pool & Fee Math", () => {
    test("deducts takeout fee rate correctly from total pool", () => {
      const res = calculateNetPool(1000, 0.02);
      expect(res.totalPool === undefined).toBe(true);
      expect(res.netPool).toBe(980);
      expect(res.takeoutFeeAmount).toBe(20);

      // Default fee (2%)
      const defRes = calculateNetPool(500);
      expect(defRes.netPool).toBe(490);
      expect(defRes.takeoutFeeAmount).toBe(10);

      // Zero fee
      const zeroFee = calculateNetPool(1000, 0);
      expect(zeroFee.netPool).toBe(1000);
      expect(zeroFee.takeoutFeeAmount).toBe(0);

      // Negative pool handled safely
      const neg = calculateNetPool(-100);
      expect(neg.netPool).toBe(0);
      expect(neg.takeoutFeeAmount).toBe(0);
    });
  });

  describe("Multi-Outcome Market Odds", () => {
    test("calculates exact parimutuel odds across 3-outcome market pool", () => {
      const outcomes: OutcomePool[] = [
        { id: "A", name: "Team Alpha", stake: 500 },
        { id: "B", name: "Team Beta", stake: 300 },
        { id: "C", name: "Draw", stake: 200 },
      ];

      // Total pool = 1000. Takeout = 2% (20). Net pool = 980.
      const summary = calculateMarketOdds(outcomes, 0.02);

      expect(summary.totalPool).toBe(1000);
      expect(summary.netPool).toBe(980);
      expect(summary.takeoutFeeRate).toBe(0.02);
      expect(summary.takeoutFeeAmount).toBe(20);
      expect(summary.outcomes).toHaveLength(3);

      const [teamA, teamB, draw] = summary.outcomes;

      // Probabilities
      expect(teamA.impliedProbability).toBe(0.5);
      expect(teamA.impliedProbabilityPercent).toBe(50);
      expect(teamB.impliedProbability).toBe(0.3);
      expect(teamB.impliedProbabilityPercent).toBe(30);
      expect(draw.impliedProbability).toBe(0.2);
      expect(draw.impliedProbabilityPercent).toBe(20);

      // Decimal odds = NetPool / Stake
      // Team A: 980 / 500 = 1.96
      expect(teamA.decimalOdds).toBeCloseTo(1.96, 4);
      expect(teamA.americanOdds).toBe("-104"); // 100 / (1.96 - 1) = 104.16 -> -104

      // Team B: 980 / 300 = 3.2667
      expect(teamB.decimalOdds).toBeCloseTo(3.2667, 4);
      expect(teamB.americanOdds).toBe("+227"); // (3.2667 - 1) * 100 = 226.67 -> +227

      // Draw: 980 / 200 = 4.90
      expect(draw.decimalOdds).toBeCloseTo(4.9, 4);
      expect(draw.americanOdds).toBe("+390"); // (4.90 - 1) * 100 = 390 -> +390
    });

    test("handles empty market pools with equal distribution and null odds", () => {
      const outcomes: OutcomePool[] = [
        { id: 1, name: "Candidate 1", stake: 0 },
        { id: 2, name: "Candidate 2", stake: 0 },
        { id: 3, name: "Candidate 3", stake: 0 },
        { id: 4, name: "Candidate 4", stake: 0 },
      ];

      const summary = calculateMarketOdds(outcomes, 0.03);
      expect(summary.totalPool).toBe(0);
      expect(summary.netPool).toBe(0);

      summary.outcomes.forEach((o) => {
        expect(o.impliedProbability).toBe(0.25);
        expect(o.impliedProbabilityPercent).toBe(25);
        expect(o.decimalOdds).toBeNull();
        expect(o.americanOdds).toBe("—");
        expect(o.fractionalOdds).toBe("—");
      });
    });

    test("handles one-sided market with zero stake on some outcomes", () => {
      const outcomes: OutcomePool[] = [
        { id: 1, name: "Outcome 1", stake: 100 },
        { id: 2, name: "Outcome 2", stake: 0 },
      ];

      const summary = calculateMarketOdds(outcomes, 0.02);
      expect(summary.outcomes[0].impliedProbability).toBe(1.0);
      expect(summary.outcomes[0].decimalOdds).toBeCloseTo(0.98, 4);
      expect(summary.outcomes[1].impliedProbability).toBe(0);
      expect(summary.outcomes[1].decimalOdds).toBeNull();
      expect(summary.outcomes[1].americanOdds).toBe("—");
    });
  });

  describe("Binary Market Parimutuel Odds", () => {
    test("computes binary market odds for YES and NO correctly", () => {
      const binary = calculateBinaryParimutuelOdds(600, 400, 0.02);
      expect(binary.totalPool).toBe(1000);
      expect(binary.netPool).toBe(980);
      expect(binary.yes.impliedProbabilityPercent).toBe(60);
      expect(binary.no.impliedProbabilityPercent).toBe(40);

      // YES: 980 / 600 = 1.6333... -> -158 American
      expect(binary.yes.decimalOdds).toBeCloseTo(1.6333, 3);
      expect(binary.yes.americanOdds).toBe("-158");

      // NO: 980 / 400 = 2.45 -> +145 American
      expect(binary.no.decimalOdds).toBeCloseTo(2.45, 3);
      expect(binary.no.americanOdds).toBe("+145");
    });
  });

  describe("Dynamic Bet Sizing, Payout & Slippage Simulation", () => {
    test("simulates large bet on multi-outcome pool with dynamic odds shifting and slippage", () => {
      const outcomes: OutcomePool[] = [
        { id: "A", name: "Alpha", stake: 500 },
        { id: "B", name: "Beta", stake: 500 },
      ];

      // Pre-bet: 500 vs 500 (50% each), total 1000, net 980. Initial odds = 1.96x
      // Now bet 500 on Alpha:
      // Post-bet: Alpha stake = 1000, Total pool = 1500, Net pool = 1500 * 0.98 = 1470
      // Bettor owns 500 / 1000 = 50% of Alpha
      // Expected payout = 50% * 1470 = 735 XLM
      // Profit = 735 - 500 = 235 XLM
      // Effective odds = 735 / 500 = 1.47x
      // Probability shift: 50% -> 66.6667% (+16.67%)
      // Odds slippage: (1.96 - 1.47) / 1.96 = 25.0%

      const sim = simulateBet({
        outcomes,
        targetOutcomeId: "A",
        betAmount: 500,
        takeoutFeeRate: 0.02,
      });

      expect(sim.preBetTotalPool).toBe(1000);
      expect(sim.preBetOutcomeStake).toBe(500);
      expect(sim.preBetProbabilityPercent).toBe(50);
      expect(sim.preBetDecimalOdds).toBeCloseTo(1.96, 4);

      expect(sim.postBetTotalPool).toBe(1500);
      expect(sim.postBetOutcomeStake).toBe(1000);
      expect(sim.postBetNetPool).toBe(1470);
      expect(sim.postBetProbabilityPercent).toBeCloseTo(66.6667, 2);

      expect(sim.expectedPayout).toBeCloseTo(735, 4);
      expect(sim.expectedProfit).toBeCloseTo(235, 4);
      expect(sim.effectiveDecimalOdds).toBeCloseTo(1.47, 4);
      expect(sim.roiPercent).toBeCloseTo(47.0, 1);

      expect(sim.probabilityShiftPercent).toBeCloseTo(16.6667, 2);
      expect(sim.oddsSlippagePercent).toBeCloseTo(25.0, 1);
      expect(sim.takeoutFeeDeduction).toBe(10); // 500 * 0.02
    });

    test("calculates binary bet simulation with slider values", () => {
      // 1000 XLM pool (700 YES, 300 NO). Bet 100 on NO.
      const sim = simulateBinaryBet(700, 300, 0, 100, 0.02);

      // Pre-bet NO: 300 / 1000 = 30%. Initial odds = (1000 * 0.98) / 300 = 3.2667x
      expect(sim.preBetProbabilityPercent).toBe(30);
      expect(sim.preBetDecimalOdds).toBeCloseTo(3.2667, 3);

      // Post-bet NO: 400 / 1100 = 36.36%. Post net pool = 1100 * 0.98 = 1078
      // Payout for 100 stake: (100 / 400) * 1078 = 269.5 XLM
      expect(sim.expectedPayout).toBeCloseTo(269.5, 2);
      expect(sim.expectedProfit).toBeCloseTo(169.5, 2);
      expect(sim.effectiveDecimalOdds).toBeCloseTo(2.695, 3);

      // Slippage: (3.2667 - 2.695) / 3.2667 = 17.5%
      expect(sim.oddsSlippagePercent).toBeCloseTo(17.5, 1);
      expect(sim.probabilityShiftPercent).toBeCloseTo(6.36, 1);
    });

    test("handles zero bet amount gracefully", () => {
      const sim = simulateBinaryBet(500, 500, "YES", 0, 0.02);
      expect(sim.betAmount).toBe(0);
      expect(sim.expectedPayout).toBe(0);
      expect(sim.expectedProfit).toBe(0);
      expect(sim.oddsSlippagePercent).toBe(0);
      expect(sim.probabilityShiftPercent).toBe(0);
      expect(sim.preBetProbabilityPercent).toBe(50);
      expect(sim.postBetProbabilityPercent).toBe(50);
    });

    test("handles betting on an outcome that currently has 0 stake", () => {
      // Pool has 1000 on YES, 0 on NO. User places 100 on NO.
      const sim = simulateBinaryBet(1000, 0, "NO", 100, 0.02);

      // Pre-bet NO has null decimal odds
      expect(sim.preBetDecimalOdds).toBeNull();
      expect(sim.preBetProbabilityPercent).toBe(0);

      // Post-bet: 100 on NO, 1000 on YES. Total pool = 1100. Net = 1078.
      // Bettor owns 100% of NO -> expected payout = 1078 XLM!
      expect(sim.expectedPayout).toBeCloseTo(1078, 2);
      expect(sim.effectiveDecimalOdds).toBeCloseTo(10.78, 2);
      expect(sim.oddsSlippagePercent).toBe(0);
      expect(sim.probabilityShiftPercent).toBeCloseTo(9.09, 1);
    });

    test("enforces minimum decimal payout floor when requested", () => {
      // Heavily skewed pool: 999 YES, 1 NO. Bet 1000 on YES.
      const sim = simulateBinaryBet(999, 1, "YES", 1000, 0.05);
      expect(sim.effectiveDecimalOdds).toBeLessThan(1.0); // Without floor, fee takes payout below 1.0

      const simWithFloor = simulateBet({
        outcomes: [
          { id: 1, name: "YES", stake: 999 },
          { id: 0, name: "NO", stake: 1 },
        ],
        targetOutcomeId: 1,
        betAmount: 1000,
        takeoutFeeRate: 0.05,
        enforceMinPayoutFloor: true,
      });

      expect(simWithFloor.effectiveDecimalOdds).toBeGreaterThanOrEqual(MIN_DECIMAL_ODDS);
    });
  });
});
