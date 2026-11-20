// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import PredictionMarketPanel, {
  MarketData,
} from "../../components/PredictionMarketPanel";

const mockMarkets: MarketData[] = [
  {
    id: 1,
    question: "Will Stellar reach $1.00 by Q4?",
    marketType: "Binary",
    status: "Open",
    totalYesStake: 600,
    totalNoStake: 400,
    resolutionDeadline: Math.floor(Date.now() / 1000) + 86400,
  },
  {
    id: 2,
    question: "Will Soroban v23 launch on Mainnet?",
    marketType: "Binary",
    status: "Resolved",
    totalYesStake: 800,
    totalNoStake: 200,
    winningOutcome: "YES",
    resolutionDeadline: Math.floor(Date.now() / 1000) - 3600,
  },
];

describe("PredictionMarketPanel Component", () => {
  const defaultProps = {
    contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    walletAddress: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    onCreateMarket: jest.fn().mockResolvedValue(undefined),
    onPlaceBet: jest.fn().mockResolvedValue(undefined),
    onResolveMarket: jest.fn().mockResolvedValue(undefined),
    onCancelMarket: jest.fn().mockResolvedValue(undefined),
    onCalculatePayout: jest.fn().mockResolvedValue(150),
    markets: mockMarkets,
    isLoading: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("renders unconfigured state when contractId is missing", () => {
    render(<PredictionMarketPanel {...defaultProps} contractId={undefined} />);
    expect(
      screen.getByText(/deploy the prediction market contract to start trading/i),
    ).toBeInTheDocument();
  });

  test("renders market list with parimutuel odds and probability overview", () => {
    render(<PredictionMarketPanel {...defaultProps} />);

    // Check market questions
    expect(
      screen.getByText("Will Stellar reach $1.00 by Q4?"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Will Soroban v23 launch on Mainnet?"),
    ).toBeInTheDocument();

    // Check pool and probability summary: 600 YES vs 400 NO -> 60% vs 40%
    expect(
      screen.getByText(/pool: 1000 xlm · yes 60% \/ no 40%/i),
    ).toBeInTheDocument();
  });

  test("expands market card and displays live decimal and American odds", () => {
    render(<PredictionMarketPanel {...defaultProps} />);

    // Click first market header to expand
    fireEvent.click(screen.getByText("Will Stellar reach $1.00 by Q4?"));

    // Expected parimutuel odds at 2% takeout fee:
    // Net pool = 1000 * 0.98 = 980 XLM
    // YES: 980 / 600 = 1.63x (American -158)
    // NO: 980 / 400 = 2.45x (American +145)
    expect(screen.getByText("60.0%")).toBeInTheDocument();
    expect(screen.getByText("40.0%")).toBeInTheDocument();
    expect(screen.getByText(/\(1\.63x · -158\)/)).toBeInTheDocument();
    expect(screen.getByText(/\(2\.45x · \+145\)/)).toBeInTheDocument();

    // Staked breakdown
    expect(screen.getByText(/600 xlm staked/i)).toBeInTheDocument();
    expect(screen.getByText(/400 xlm staked/i)).toBeInTheDocument();
    expect(screen.getByText(/net: 980 xlm · fee: 2%/i)).toBeInTheDocument();
  });

  test("interactive bet slider dynamically calculates probability impact and price slippage", async () => {
    render(<PredictionMarketPanel {...defaultProps} />);

    // Expand market 1
    fireEvent.click(screen.getByText("Will Stellar reach $1.00 by Q4?"));

    const slider = screen.getByLabelText(/bet size slider/i);
    const textInput = screen.getByLabelText(/stake in xlm/i);

    // Initial state: bet stake empty, simulation card not visible
    expect(screen.queryByText(/projected return/i)).not.toBeInTheDocument();

    // Move slider to 100 XLM
    fireEvent.change(slider, { target: { value: "100" } });
    expect(textInput).toHaveValue(100);

    // Simulation card should appear
    expect(screen.getByText(/projected return/i)).toBeInTheDocument();
    expect(screen.getByText(/effective odds:/i)).toBeInTheDocument();
    expect(screen.getByText(/price slippage:/i)).toBeInTheDocument();
    expect(screen.getByText(/probability shift:/i)).toBeInTheDocument();
    expect(screen.getByText(/protocol fee deducted:/i)).toBeInTheDocument();

    // For 100 XLM on YES (total YES = 700, total pool = 1100, net pool = 1078):
    // Payout = (100 / 700) * 1078 = 154.00 XLM (+54.00 XLM)
    expect(screen.getByText("154.00 XLM")).toBeInTheDocument();
    expect(screen.getByText(/\+54\.00 xlm/i)).toBeInTheDocument();

    // Click preset chip "+50"
    fireEvent.click(screen.getByRole("button", { name: "50" }));
    expect(textInput).toHaveValue(50);

    // Click "Clear" button
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(textInput).toHaveValue(null);
    expect(screen.queryByText(/projected return/i)).not.toBeInTheDocument();
  });

  test("switches bet outcome to NO and updates effective payout simulation", () => {
    render(<PredictionMarketPanel {...defaultProps} />);

    fireEvent.click(screen.getByText("Will Stellar reach $1.00 by Q4?"));

    // Select NO outcome button using explicit aria-label
    const selectNoBtn = screen.getByLabelText(/select no outcome/i);
    fireEvent.click(selectNoBtn);

    // Enter 100 XLM stake
    const textInput = screen.getByLabelText(/stake in xlm/i);
    fireEvent.change(textInput, { target: { value: "100" } });

    // Pre-bet NO: 400. Post-bet: 500. Total: 1100. Net: 1078.
    // Payout = (100 / 500) * 1078 = 215.60 XLM
    expect(screen.getByText("215.60 XLM")).toBeInTheDocument();
    expect(screen.getByText(/\+115\.60 xlm/i)).toBeInTheDocument();
  });

  test("triggers onPlaceBet when submitting bet", async () => {
    render(<PredictionMarketPanel {...defaultProps} />);

    fireEvent.click(screen.getByText("Will Stellar reach $1.00 by Q4?"));

    const textInput = screen.getByLabelText(/stake in xlm/i);
    fireEvent.change(textInput, { target: { value: "75" } });

    const placeBetBtn = screen.getByRole("button", {
      name: /place 75 xlm bet on yes/i,
    });
    fireEvent.click(placeBetBtn);

    await waitFor(() => {
      expect(defaultProps.onPlaceBet).toHaveBeenCalledWith(1, 1, 75);
    });
  });

  test("triggers onResolveMarket and onCancelMarket admin actions", async () => {
    render(<PredictionMarketPanel {...defaultProps} />);

    fireEvent.click(screen.getByText("Will Stellar reach $1.00 by Q4?"));

    // Resolve YES
    fireEvent.click(screen.getByRole("button", { name: /resolve yes/i }));
    expect(defaultProps.onResolveMarket).toHaveBeenCalledWith(1, 1);

    // Resolve NO
    fireEvent.click(screen.getByRole("button", { name: /resolve no/i }));
    expect(defaultProps.onResolveMarket).toHaveBeenCalledWith(1, 0);

    // Cancel market
    fireEvent.click(screen.getByLabelText(/cancel market/i));
    expect(defaultProps.onCancelMarket).toHaveBeenCalledWith(1);
  });

  test("calculates and displays payout for resolved market", async () => {
    render(<PredictionMarketPanel {...defaultProps} />);

    // Expand resolved market 2
    fireEvent.click(screen.getByText("Will Soroban v23 launch on Mainnet?"));

    expect(
      screen.getByText(/resolved outcome: yes wins/i),
    ).toBeInTheDocument();

    const calcPayoutBtn = screen.getByRole("button", {
      name: /calculate my payout/i,
    });
    fireEvent.click(calcPayoutBtn);

    await waitFor(() => {
      expect(defaultProps.onCalculatePayout).toHaveBeenCalledWith(2);
      expect(screen.getByText(/payout: 150 xlm/i)).toBeInTheDocument();
    });
  });

  test("switches to create market tab and calls onCreateMarket", async () => {
    render(<PredictionMarketPanel {...defaultProps} />);

    // Switch to create tab
    fireEvent.click(screen.getByRole("button", { name: "Create Market" }));

    const questionInput = screen.getByPlaceholderText(
      /will btc exceed \$100k/i,
    );
    const oracleInput = screen.getByPlaceholderText("G...");

    fireEvent.change(questionInput, {
      target: { value: "Will Ethereum hit $10k in 2026?" },
    });
    fireEvent.change(oracleInput, {
      target: { value: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB" },
    });

    const submitBtn = screen.getByLabelText(/submit create market/i);
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(defaultProps.onCreateMarket).toHaveBeenCalledWith(
        expect.objectContaining({
          question: "Will Ethereum hit $10k in 2026?",
          oracle: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
          marketType: 0,
        }),
      );
    });
  });

  test("adjusts protocol takeout fee rate dynamically", () => {
    render(<PredictionMarketPanel {...defaultProps} />);

    // Expand market 1
    fireEvent.click(screen.getByText("Will Stellar reach $1.00 by Q4?"));

    // Check fee select
    const feeSelect = screen.getByLabelText(/protocol takeout fee rate/i);
    expect(feeSelect).toHaveValue("0.02");

    // Change fee select to 5%
    fireEvent.change(feeSelect, { target: { value: "0.05" } });
    expect(feeSelect).toHaveValue("0.05");

    // Net pool = 1000 * 0.95 = 950 XLM
    expect(screen.getByText(/net: 950 xlm · fee: 5%/i)).toBeInTheDocument();
  });
});
