import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QuorumCircularGauge } from "@/components/Gov/QuorumCircularGauge";

describe("QuorumCircularGauge Component", () => {
  it("renders pending state with correct percentage and values", () => {
    render(
      <QuorumCircularGauge
        progressPct={65.4}
        totalTokensVoted={65400}
        quorumThresholdTokens={100000}
        reached={false}
      />,
    );

    expect(screen.getByTestId("quorum-circular-gauge")).toBeInTheDocument();
    expect(screen.getByTestId("quorum-gauge-pct")).toHaveTextContent("65.4%");
    expect(screen.getByTestId("quorum-status-badge")).toHaveTextContent("Quorum Floor Pending");
    expect(screen.getByText("65,400")).toBeInTheDocument();
    expect(screen.getByText(/100,000 Tokens/)).toBeInTheDocument();
  });

  it("renders reached state when quorum is satisfied", () => {
    render(
      <QuorumCircularGauge
        progressPct={100}
        totalTokensVoted={120000}
        quorumThresholdTokens={100000}
        reached={true}
      />,
    );

    expect(screen.getByTestId("quorum-gauge-pct")).toHaveTextContent("100%");
    expect(screen.getByTestId("quorum-status-badge")).toHaveTextContent("Quorum Floor Reached");
  });
});
