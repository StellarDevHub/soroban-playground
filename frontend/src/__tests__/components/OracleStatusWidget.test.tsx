import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { OracleStatusWidget } from "@/components/OracleStatusWidget";

describe("OracleStatusWidget Component", () => {
  it("renders with default props and shows active status", () => {
    render(<OracleStatusWidget />);

    expect(screen.getByTestId("oracle-status-widget")).toBeInTheDocument();
    expect(screen.getByText("Stellar Core Testnet Oracle")).toBeInTheDocument();
    expect(screen.getByText("XLM/USD Feed")).toBeInTheDocument();
    expect(screen.getByTestId("oracle-health-pill")).toHaveTextContent("Active (< 60s)");
    expect(screen.getByText("48")).toBeInTheDocument();
  });

  it("renders stale status pill when last proof was more than 300s ago", () => {
    const staleTime = Date.now() - 350_000;
    render(
      <OracleStatusWidget
        lastProofAt={staleTime}
      />,
    );

    expect(screen.getByTestId("oracle-health-pill")).toHaveTextContent("Stale (> 300s)");
  });

  it("renders down status pill when last proof is null or > 1800s ago", () => {
    render(
      <OracleStatusWidget
        lastProofAt={null}
      />,
    );

    expect(screen.getByTestId("oracle-health-pill")).toHaveTextContent("Down (> 1800s)");
  });

  it("displays price deviation warning banner when deviation exceeds tolerance threshold", () => {
    render(
      <OracleStatusWidget
        oraclePrice={0.125}
        spotPrice={0.10}
        toleranceThresholdPct={1.5}
      />,
    );

    expect(screen.getByTestId("deviation-alert-banner")).toBeInTheDocument();
    expect(screen.getByText(/Price deviation exceeds safe threshold/i)).toBeInTheDocument();
  });

  it("does not show alert banner when price deviation is within safe tolerance", () => {
    render(
      <OracleStatusWidget
        oraclePrice={0.1005}
        spotPrice={0.1000}
        toleranceThresholdPct={1.5}
      />,
    );

    expect(screen.queryByTestId("deviation-alert-banner")).not.toBeInTheDocument();
  });
});
