// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * @file PredictionMarketPanel.test.tsx
 * Interaction tests for parimutuel odds, the bet sizing slider and admin actions.
 */

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import PredictionMarketPanel, {
  type MarketData,
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

function renderPanel(overrides: Record<string, unknown> = {}) {
  const props = {
    contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    walletAddress: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    onCreateMarket: jest.fn().mockResolvedValue(undefined),
    onPlaceBet: jest.fn().mockResolvedValue(undefined),
    onResolveMarket: jest.fn().mockResolvedValue(undefined),
    onCancelMarket: jest.fn().mockResolvedValue(undefined),
    onCalculatePayout: jest.fn().mockResolvedValue(150),
    markets: mockMarkets,
    isLoading: false,
    ...overrides,
  };

  return { props, ...render(<PredictionMarketPanel {...props} />) };
}

describe("PredictionMarketPanel", () => {
  test("shows the unconfigured state without a contract", () => {
    renderPanel({ contractId: undefined });
    expect(
      screen.getByText(/deploy the prediction market contract to start trading/i),
    ).toBeInTheDocument();
  });

  test("lists markets with pool and implied probabilities", () => {
    renderPanel();

    expect(
      screen.getByText("Will Stellar reach $1.00 by Q4?"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Will Soroban v23 launch on Mainnet?"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/pool: 1000 xlm · yes 60% \/ no 40%/i),
    ).toBeInTheDocument();
  });

  test("shows live decimal and American odds when a market expands", () => {
    renderPanel();
    fireEvent.click(screen.getByText("Will Stellar reach $1.00 by Q4?"));

    expect(screen.getByText("60.0%")).toBeInTheDocument();
    expect(screen.getByText("40.0%")).toBeInTheDocument();
    expect(screen.getByText(/\(1\.63x · -158\)/)).toBeInTheDocument();
    expect(screen.getByText(/\(2\.45x · \+145\)/)).toBeInTheDocument();
    expect(screen.getByText(/600 xlm staked/i)).toBeInTheDocument();
    expect(screen.getByText(/400 xlm staked/i)).toBeInTheDocument();
    expect(screen.getByText(/net: 980 xlm · fee: 2%/i)).toBeInTheDocument();
  });

  test("slider drives projected return, probability shift and slippage", () => {
    renderPanel();
    fireEvent.click(screen.getByText("Will Stellar reach $1.00 by Q4?"));

    const slider = screen.getByLabelText(/bet size slider/i);
    const stakeInput = screen.getByLabelText(/stake in xlm/i);

    expect(screen.queryByText(/projected return/i)).not.toBeInTheDocument();

    fireEvent.change(slider, { target: { value: "100" } });
    expect(stakeInput).toHaveValue(100);

    expect(screen.getByText(/projected return/i)).toBeInTheDocument();
    expect(screen.getByText(/effective odds:/i)).toBeInTheDocument();
    expect(screen.getByText(/price slippage:/i)).toBeInTheDocument();
    expect(screen.getByText(/probability shift:/i)).toBeInTheDocument();
    expect(screen.getByText(/protocol fee deducted:/i)).toBeInTheDocument();

    expect(screen.getByText("154.00 XLM")).toBeInTheDocument();
    expect(screen.getByText(/\+54\.00 xlm/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "50" }));
    expect(stakeInput).toHaveValue(50);

    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(stakeInput).toHaveValue(null);
    expect(screen.queryByText(/projected return/i)).not.toBeInTheDocument();
  });

  test("switching to NO recalculates the projected payout", () => {
    renderPanel();
    fireEvent.click(screen.getByText("Will Stellar reach $1.00 by Q4?"));

    fireEvent.click(screen.getByLabelText(/select no outcome/i));
    fireEvent.change(screen.getByLabelText(/stake in xlm/i), {
      target: { value: "100" },
    });

    expect(screen.getByText("215.60 XLM")).toBeInTheDocument();
    expect(screen.getByText(/\+115\.60 xlm/i)).toBeInTheDocument();
  });

  test("submits a bet with the selected outcome and stake", async () => {
    const { props } = renderPanel();
    fireEvent.click(screen.getByText("Will Stellar reach $1.00 by Q4?"));

    fireEvent.change(screen.getByLabelText(/stake in xlm/i), {
      target: { value: "75" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /place 75 xlm bet on yes/i }),
    );

    await waitFor(() => {
      expect(props.onPlaceBet).toHaveBeenCalledWith(1, 1, 75);
    });
  });

  test("exposes resolve and cancel admin actions", () => {
    const { props } = renderPanel();
    fireEvent.click(screen.getByText("Will Stellar reach $1.00 by Q4?"));

    fireEvent.click(screen.getByRole("button", { name: /resolve yes/i }));
    expect(props.onResolveMarket).toHaveBeenCalledWith(1, 1);

    fireEvent.click(screen.getByRole("button", { name: /resolve no/i }));
    expect(props.onResolveMarket).toHaveBeenCalledWith(1, 0);

    fireEvent.click(screen.getByLabelText(/cancel market/i));
    expect(props.onCancelMarket).toHaveBeenCalledWith(1);
  });

  test("calculates the payout for a resolved market", async () => {
    const { props } = renderPanel();
    fireEvent.click(screen.getByText("Will Soroban v23 launch on Mainnet?"));

    expect(screen.getByText(/resolved outcome: yes wins/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /calculate my payout/i }));

    await waitFor(() => {
      expect(props.onCalculatePayout).toHaveBeenCalledWith(2);
      expect(screen.getByText(/payout: 150 xlm/i)).toBeInTheDocument();
    });
  });

  test("creates a market from the create tab", async () => {
    const { props } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Create Market" }));

    fireEvent.change(
      screen.getByPlaceholderText(/will btc exceed \$100k/i),
      { target: { value: "Will Ethereum hit $10k in 2026?" } },
    );
    fireEvent.change(screen.getByPlaceholderText("G..."), {
      target: {
        value: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      },
    });
    fireEvent.click(screen.getByLabelText(/submit create market/i));

    await waitFor(() => {
      expect(props.onCreateMarket).toHaveBeenCalledWith(
        expect.objectContaining({
          question: "Will Ethereum hit $10k in 2026?",
          oracle: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
          marketType: 0,
        }),
      );
    });
  });

  test("updates the takeout fee and net pool", () => {
    renderPanel();
    fireEvent.click(screen.getByText("Will Stellar reach $1.00 by Q4?"));

    const feeSelect = screen.getByLabelText(/protocol takeout fee rate/i);
    expect(feeSelect).toHaveValue("0.02");

    fireEvent.change(feeSelect, { target: { value: "0.05" } });
    expect(feeSelect).toHaveValue("0.05");
    expect(screen.getByText(/net: 950 xlm · fee: 5%/i)).toBeInTheDocument();
  });
});
