import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import AssetBalanceCard from "@/components/AssetBalanceCard";

describe("AssetBalanceCard Component", () => {
  it("renders asset code and formatted balance", () => {
    render(
      <AssetBalanceCard
        initialStroops="10000000"
        assetCode="XLM"
        exchangeRateUsd={0.12}
      />,
    );

    expect(screen.getByText(/XLM Balance/i)).toBeInTheDocument();
    expect(screen.getByTestId("token-balance-text")).toHaveTextContent("1.0000000");
    expect(screen.getByTestId("fiat-balance-text")).toHaveTextContent("$0.12");
  });

  it("switches fiat currency when currency buttons are clicked", () => {
    render(
      <AssetBalanceCard
        initialStroops="1000000000" // 100 XLM
        assetCode="XLM"
        exchangeRateUsd={0.10}
      />,
    );

    const eurButton = screen.getByTestId("fiat-toggle-eur");
    fireEvent.click(eurButton);

    expect(eurButton).toHaveClass("bg-teal-500/20");
  });

  it("updates balance when quick test presets are selected", () => {
    render(<AssetBalanceCard assetCode="XLM" />);

    const oneStroopBtn = screen.getByRole("button", { name: "1 Stroop" });
    fireEvent.click(oneStroopBtn);

    expect(screen.getByTestId("raw-stroops-text")).toHaveTextContent("Raw: 1 Stroops");
    expect(screen.getByTestId("token-balance-text")).toHaveTextContent("0.0000001");
  });

  it("handles copy button interaction", () => {
    render(<AssetBalanceCard assetCode="XLM" />);
    const copyBtn = screen.getByTestId("copy-balance-btn");
    expect(copyBtn).toBeInTheDocument();
    fireEvent.click(copyBtn);
  });
});
