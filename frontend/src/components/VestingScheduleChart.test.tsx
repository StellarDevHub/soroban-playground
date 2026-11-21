import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import VestingScheduleChart from "./VestingScheduleChart";
import {
  calculateVestedTokens,
  getVestingBreakdown,
  formatCountdown,
  formatTokenAmount,
  generateVestingTimelinePoints,
} from "../utils/vestingMath";
import { VestingScheduleData } from "../types/vesting";

// Mock helper function compatible with both Jest and Vitest
const createMockFn = () => {
  if (typeof jest !== "undefined") return jest.fn();
  // @ts-expect-error Vitest global support
  if (typeof vi !== "undefined") return vi.fn();
  return () => {};
};

describe("Token Vesting Mathematical Calculations", () => {
  const baseSchedule: VestingScheduleData = {
    id: 1,
    beneficiary: "GBENEFICIARY1234567890STEL",
    token: "CCONTRACT1234567890STEL",
    symbol: "XLM",
    totalAmount: 10000,
    releasedAmount: 0,
    startTimestamp: 1000,
    cliffTimestamp: 2000,
    endTimestamp: 4000,
    vestingType: "Linear",
    cliffUnlockPercentage: 20, // 20% cliff unlock = 2,000 tokens
    milestones: [],
    revoked: false,
    revocable: true,
  };

  it("calculates 0 vested tokens before cliff timestamp", () => {
    // Before cliff timestamp (1500 < 2000)
    const vested = calculateVestedTokens(baseSchedule, 1500);
    expect(vested).toBe(0);

    const breakdown = getVestingBreakdown(baseSchedule, 1500);
    expect(breakdown.vestedAmount).toBe(0);
    expect(breakdown.vestedPercentage).toBe(0);
    expect(breakdown.isCliffReached).toBe(false);
    expect(breakdown.lockedAmount).toBe(10000);
    expect(breakdown.claimableAmount).toBe(0);
  });

  it("calculates exact cliff percentage released at exact cliff timestamp", () => {
    // At exact cliff timestamp (2000 === 2000) -> 20% of 10,000 = 2,000
    const vested = calculateVestedTokens(baseSchedule, 2000);
    expect(vested).toBe(2000);

    const breakdown = getVestingBreakdown(baseSchedule, 2000);
    expect(breakdown.vestedAmount).toBe(2000);
    expect(breakdown.vestedPercentage).toBe(20);
    expect(breakdown.isCliffReached).toBe(true);
    expect(breakdown.lockedAmount).toBe(8000);
    expect(breakdown.claimableAmount).toBe(2000);
  });

  it("calculates proportional linear accumulation midway through linear vesting", () => {
    // Post-cliff duration = 4000 - 2000 = 2000 seconds
    // Midway = 2000 + 1000 = 3000
    // Cliff amount = 2,000. Remaining to vest = 8,000.
    // Midway ratio = 0.5 -> 2,000 + (8,000 * 0.5) = 6,000 tokens (60%)
    const vestedMidway = calculateVestedTokens(baseSchedule, 3000);
    expect(vestedMidway).toBe(6000);

    const breakdown = getVestingBreakdown(baseSchedule, 3000);
    expect(breakdown.vestedAmount).toBe(6000);
    expect(breakdown.vestedPercentage).toBe(60);
    expect(breakdown.lockedAmount).toBe(4000);
    expect(breakdown.claimableAmount).toBe(6000);
  });

  it("calculates quarter-way linear accumulation accurately", () => {
    // 25% through linear phase = 2000 + (2000 * 0.25) = 2500
    // Cliff amount = 2,000 + (8,000 * 0.25) = 2,000 + 2,000 = 4,000 (40%)
    const vestedQuarter = calculateVestedTokens(baseSchedule, 2500);
    expect(vestedQuarter).toBe(4000);
  });

  it("calculates 100% vested tokens at exact maturity", () => {
    // At endTimestamp (4000) -> 10,000 tokens (100%)
    const vestedAtEnd = calculateVestedTokens(baseSchedule, 4000);
    expect(vestedAtEnd).toBe(10000);

    const breakdown = getVestingBreakdown(baseSchedule, 4000);
    expect(breakdown.vestedAmount).toBe(10000);
    expect(breakdown.vestedPercentage).toBe(100);
    expect(breakdown.lockedAmount).toBe(0);
    expect(breakdown.isMatured).toBe(true);
  });

  it("calculates 100% vested tokens after maturity", () => {
    // Far after endTimestamp (9000 > 4000) -> capped at 10,000 tokens (100%)
    const vestedAfter = calculateVestedTokens(baseSchedule, 9000);
    expect(vestedAfter).toBe(10000);

    const breakdown = getVestingBreakdown(baseSchedule, 9000);
    expect(breakdown.vestedAmount).toBe(10000);
    expect(breakdown.lockedAmount).toBe(0);
  });

  it("correctly factors already claimed tokens into claimable amount", () => {
    const scheduleWithClaimed: VestingScheduleData = {
      ...baseSchedule,
      releasedAmount: 2500,
    };

    // Midway: 6000 vested. 2500 claimed -> 3500 claimable.
    const breakdown = getVestingBreakdown(scheduleWithClaimed, 3000);
    expect(breakdown.vestedAmount).toBe(6000);
    expect(breakdown.claimedAmount).toBe(2500);
    expect(breakdown.claimableAmount).toBe(3500);
    expect(breakdown.lockedAmount).toBe(4000);
  });

  it("correctly identifies revocable and non-revocable portions", () => {
    // Midway: 6000 vested, 4000 locked.
    // If revocable, locked amount (4000) is revocable, 6000 is guaranteed non-revocable.
    const breakdown = getVestingBreakdown(baseSchedule, 3000);
    expect(breakdown.revocableAmount).toBe(4000);
    expect(breakdown.nonRevocableAmount).toBe(6000);

    // If irrevocable (revocable: false)
    const irrevocableSchedule: VestingScheduleData = {
      ...baseSchedule,
      revocable: false,
    };
    const irrBreakdown = getVestingBreakdown(irrevocableSchedule, 3000);
    expect(irrBreakdown.revocableAmount).toBe(0);
    expect(irrBreakdown.nonRevocableAmount).toBe(10000);
  });

  it("caps vested tokens when schedule is revoked", () => {
    const revokedSchedule: VestingScheduleData = {
      ...baseSchedule,
      revoked: true,
      revocationTimestamp: 2500, // Revoked at 2500 (when 4000 tokens had vested)
    };

    // Even if current time is 3500, vested tokens should remain capped at 4000
    const vested = calculateVestedTokens(revokedSchedule, 3500);
    expect(vested).toBe(4000);

    const breakdown = getVestingBreakdown(revokedSchedule, 3500);
    expect(breakdown.revocableAmount).toBe(0); // Cannot revoke anymore once already revoked
  });

  it("handles milestone-based schedules correctly", () => {
    const milestoneSchedule: VestingScheduleData = {
      ...baseSchedule,
      vestingType: "Milestone",
      milestones: [
        { index: 0, descriptionHash: 1, pctBps: 2500, approved: true },
        { index: 1, descriptionHash: 2, pctBps: 2500, approved: true },
        { index: 2, descriptionHash: 3, pctBps: 2500, approved: false },
        { index: 3, descriptionHash: 4, pctBps: 2500, approved: false },
      ],
    };

    // Before cliff -> 0
    expect(calculateVestedTokens(milestoneSchedule, 1500)).toBe(0);

    // After cliff -> 2 approved milestones of 25% = 50% = 5,000 tokens
    expect(calculateVestedTokens(milestoneSchedule, 2500)).toBe(5000);
  });
});

describe("Vesting Formatting & Timeline Utilities", () => {
  it("formats countdown strings properly", () => {
    expect(formatCountdown(0)).toBe("00h 00m 00s");
    expect(formatCountdown(3665)).toBe("01h 01m 05s");
    expect(formatCountdown(90065)).toBe("1d 01h 01m 05s");
  });

  it("formats token amounts with symbol and commas", () => {
    expect(formatTokenAmount(10000, "XLM")).toBe("10,000 XLM");
    expect(formatTokenAmount(2500.5, "USDC")).toBe("2,500.5 USDC");
  });

  it("generates timeline points including cliff step", () => {
    const schedule: VestingScheduleData = {
      id: 1,
      beneficiary: "GBENEFICIARY",
      token: "CTOKEN",
      totalAmount: 10000,
      releasedAmount: 0,
      startTimestamp: 1000,
      cliffTimestamp: 2000,
      endTimestamp: 4000,
      vestingType: "Linear",
      cliffUnlockPercentage: 25,
      milestones: [],
      revoked: false,
    };

    const points = generateVestingTimelinePoints(schedule, 5);
    expect(points.length).toBeGreaterThan(4);
    expect(points[0].event).toBe("start");
    expect(points[0].vestedAmount).toBe(0);

    const cliffPoint = points.find((p) => p.event === "cliff");
    expect(cliffPoint).toBeDefined();
    expect(cliffPoint?.vestedAmount).toBe(2500);

    const maturityPoint = points.find((p) => p.event === "maturity");
    expect(maturityPoint).toBeDefined();
    expect(maturityPoint?.vestedAmount).toBe(10000);
  });
});

describe("VestingScheduleChart Component Rendering & Interactions", () => {
  const sampleSchedule: VestingScheduleData = {
    id: 42,
    beneficiary: "GBENEFICIARY9876543210STEL",
    token: "CCONTRACTTOKEN1234567890STEL",
    symbol: "XLM",
    totalAmount: 20000,
    releasedAmount: 2000,
    startTimestamp: 1000,
    cliffTimestamp: 2000,
    endTimestamp: 6000,
    vestingType: "Linear",
    cliffUnlockPercentage: 25, // 25% at cliff = 5,000 tokens
    milestones: [],
    revoked: false,
    revocable: true,
  };

  it("renders the schedule header, badge, and region", () => {
    render(
      <VestingScheduleChart
        schedule={sampleSchedule}
        simulatedTimestamp={1500}
      />,
    );

    expect(
      screen.getByRole("region", { name: "Token vesting schedule visualizer" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Vesting Schedule #42")).toBeInTheDocument();
    expect(screen.getByText("Revocable")).toBeInTheDocument();
    expect(screen.getByText("Linear")).toBeInTheDocument();
  });

  it("displays correct breakdown values before cliff", () => {
    // At timestamp 1500 (< cliff 2000)
    render(
      <VestingScheduleChart
        schedule={sampleSchedule}
        simulatedTimestamp={1500}
      />,
    );

    // Vested tokens amount should be 0 XLM
    expect(screen.getByTestId("vested-tokens-amount")).toHaveTextContent(
      "0 XLM",
    );
    // Locked tokens amount should be 20,000 XLM
    expect(screen.getByTestId("locked-tokens-amount")).toHaveTextContent(
      "20,000 XLM",
    );
    // Countdown shows time to Cliff Unlock
    expect(screen.getByTestId("vesting-countdown-panel")).toHaveTextContent(
      /cliff unlock/i,
    );

    // Claim button is disabled because 0 claimable
    const claimButton = screen.getByRole("button", {
      name: /no tokens available to claim/i,
    });
    expect(claimButton).toBeDisabled();
  });

  it("displays correct breakdown values post-cliff and enables claim button", () => {
    // Total: 20,000. Cliff = 2000 (25% = 5,000). Linear: 2000 to 6000 (duration 4000).
    // At timestamp 4000 (midway post-cliff):
    // Vested = 5,000 + 15,000 * 0.5 = 12,500 XLM.
    // Released = 2,000. Claimable = 10,500 XLM. Locked = 7,500 XLM.
    render(
      <VestingScheduleChart
        schedule={sampleSchedule}
        simulatedTimestamp={4000}
      />,
    );

    expect(screen.getByTestId("vested-tokens-amount")).toHaveTextContent(
      "12,500 XLM",
    );
    expect(screen.getByTestId("claimed-tokens-amount")).toHaveTextContent(
      "2,000 XLM",
    );
    expect(screen.getByTestId("claimable-tokens-amount")).toHaveTextContent(
      "10,500 XLM",
    );
    expect(screen.getByTestId("locked-tokens-amount")).toHaveTextContent(
      "7,500 XLM",
    );

    // Claim button is enabled with exact claimable amount
    const claimButton = screen.getByRole("button", {
      name: /claim 10,500 xlm/i,
    });
    expect(claimButton).toBeEnabled();
  });

  it("dispatches claim event when One-Click Claim button is clicked", async () => {
    const onClaimMock = createMockFn();
    const onClaimSuccessMock = createMockFn();

    render(
      <VestingScheduleChart
        schedule={sampleSchedule}
        simulatedTimestamp={4000}
        onClaim={onClaimMock}
        onClaimSuccess={onClaimSuccessMock}
      />,
    );

    const claimButton = screen.getByRole("button", {
      name: /claim 10,500 xlm/i,
    });
    expect(claimButton).toBeEnabled();

    fireEvent.click(claimButton);

    expect(onClaimMock).toHaveBeenCalledTimes(1);
    expect(onClaimMock).toHaveBeenCalledWith(42);

    await waitFor(() => {
      expect(onClaimSuccessMock).toHaveBeenCalledWith(42, 10500);
      expect(screen.getByRole("status")).toHaveTextContent(
        /Claim successful! Transferred 10,500 XLM to your wallet./i,
      );
    });
  });

  it("renders SVG stepped-area chart with accessibility attributes", () => {
    render(
      <VestingScheduleChart
        schedule={sampleSchedule}
        simulatedTimestamp={4000}
      />,
    );

    const svg = screen.getByRole("img", {
      name: "Interactive stepped-area vesting chart for schedule #42",
    });
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("role", "img");
  });

  it("renders revocation banner and disables claim when schedule is revoked", () => {
    const revokedSchedule: VestingScheduleData = {
      ...sampleSchedule,
      revoked: true,
      revocationTimestamp: 1500, // revoked before cliff
    };

    render(
      <VestingScheduleChart
        schedule={revokedSchedule}
        simulatedTimestamp={3000}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      /Schedule Revoked: Unvested tokens have been forfeited./i,
    );

    const claimButton = screen.getByRole("button", {
      name: /no tokens available to claim/i,
    });
    expect(claimButton).toBeDisabled();
  });
});
