import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import VestingDashboard from "./VestingDashboard";
import { VestingScheduleData } from "../types/vesting";

const createMockFn = () => {
  if (typeof jest !== "undefined") return jest.fn();
  // @ts-expect-error Vitest global support
  if (typeof vi !== "undefined") return vi.fn();
  return () => {};
};

describe("VestingDashboard with Integrated VestingScheduleChart", () => {
  const sampleSchedule: VestingScheduleData = {
    id: 1,
    beneficiary: "GBENEFICIARY1234567890STEL",
    token: "CCONTRACTTOKEN1234567890STEL",
    symbol: "XLM",
    totalAmount: 50000,
    releasedAmount: 5000,
    startTimestamp: 1000,
    cliffTimestamp: 2000,
    endTimestamp: 6000,
    vestingType: "Linear",
    cliffUnlockPercentage: 20,
    milestones: [],
    revoked: false,
    revocable: true,
  };

  const defaultProps = {
    contractId: "CVESTINGCONTRACT123456789",
    walletAddress: "GADMINWALLET1234567890STEL",
    schedules: [sampleSchedule],
    isLoading: false,
    onCreateLinear: createMockFn(),
    onCreateMilestone: createMockFn(),
    onRelease: createMockFn(),
    onRevoke: createMockFn(),
    onApproveMilestone: createMockFn(),
  };

  it("renders the dashboard and schedule summary", () => {
    render(<VestingDashboard {...defaultProps} />);
    expect(screen.getByText("Token Vesting")).toBeInTheDocument();
    expect(screen.getByText("Schedules (1)")).toBeInTheDocument();
    expect(screen.getByText("#1")).toBeInTheDocument();
  });

  it("expands the schedule and renders the interactive VestingScheduleChart", () => {
    render(<VestingDashboard {...defaultProps} />);

    // Initially collapsed, VestingScheduleChart region is not yet expanded
    expect(
      screen.queryByRole("region", {
        name: "Token vesting schedule visualizer",
      }),
    ).not.toBeInTheDocument();

    // Click to expand schedule #1
    const expandButton = screen.getByText("#1").closest("button");
    expect(expandButton).toBeInTheDocument();
    fireEvent.click(expandButton!);

    // Now VestingScheduleChart is rendered inside
    expect(
      screen.getByRole("region", {
        name: "Token vesting schedule visualizer",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Vesting Schedule #1")).toBeInTheDocument();
  });
});
