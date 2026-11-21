import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { BridgeTransferTracker } from "./BridgeTransferTracker";
import { BridgeSession, BridgeStage } from "../types/bridgeTracker";
import {
  saveBridgeSession,
  getBridgeSessions,
  BRIDGE_STORAGE_KEY,
  createDefaultBridgeSession,
} from "../utils/bridgeStorage";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  writable: true,
});

describe("BridgeTransferTracker Component & Multi-Hop Stepper", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  const mockSession: BridgeSession = {
    id: "bridge-test-123",
    depositId: 42,
    token: "USDC",
    amount: 1000,
    sourceNetwork: "stellar-testnet",
    destinationNetwork: "ethereum-sepolia",
    sourceTxHash: "0xstellar_mock_source_tx_hash_12345",
    destTxHash: "0xeth_mock_dest_tx_hash_67890",
    currentStage: "relayer_picked_up",
    stageStatuses: {
      source_confirmed: "completed",
      relayer_picked_up: "in_progress",
      proof_generated: "pending",
      destination_minted: "pending",
    },
    stageTimestamps: {
      source_confirmed: 1700000000000,
      relayer_picked_up: null,
      proof_generated: null,
      destination_minted: null,
    },
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    estimatedTotalSeconds: 600,
  };

  test("renders empty placeholder when no session is available", () => {
    render(<BridgeTransferTracker />);
    expect(
      screen.getByText("No active bridge transfer session selected.")
    ).toBeInTheDocument();
  });

  test("renders 4-stage stepper headers and token details", () => {
    render(<BridgeTransferTracker session={mockSession} />);

    // Header checks
    expect(screen.getByText("Cross-Chain Transfer Status")).toBeInTheDocument();
    expect(screen.getByText("ID: #42")).toBeInTheDocument();
    expect(screen.getByText("1,000 USDC")).toBeInTheDocument();

    // 4 stages check
    expect(
      screen.getByText("Source Transaction Confirmed")
    ).toBeInTheDocument();
    expect(screen.getByText("Relayer Picked Up")).toBeInTheDocument();
    expect(
      screen.getByText("Proof Generated / Attested")
    ).toBeInTheDocument();
    expect(screen.getByText("Destination Minted")).toBeInTheDocument();
  });

  test("renders live explorer links for both source and destination networks", () => {
    render(<BridgeTransferTracker session={mockSession} />);

    const explorerLinks = screen.getAllByRole("link");
    expect(explorerLinks.length).toBeGreaterThanOrEqual(2);

    // Source explorer link
    expect(explorerLinks[0]).toHaveAttribute(
      "href",
      `https://stellar.expert/explorer/testnet/tx/${mockSession.sourceTxHash}`
    );
    expect(explorerLinks[0]).toHaveAttribute("target", "_blank");

    // Destination explorer link
    expect(explorerLinks[1]).toHaveAttribute(
      "href",
      `https://sepolia.etherscan.io/tx/${mockSession.destTxHash}`
    );
    expect(explorerLinks[1]).toHaveAttribute("target", "_blank");
  });

  test("persists session to localStorage upon rendering", () => {
    render(<BridgeTransferTracker session={mockSession} />);
    const stored = getBridgeSessions();
    expect(stored.length).toBe(1);
    expect(stored[0].id).toBe("bridge-test-123");
    expect(stored[0].depositId).toBe(42);
  });

  test("re-hydrates session from localStorage when given sessionId prop", () => {
    saveBridgeSession(mockSession);
    render(<BridgeTransferTracker sessionId="bridge-test-123" />);

    expect(screen.getByText("ID: #42")).toBeInTheDocument();
    expect(screen.getByText("1,000 USDC")).toBeInTheDocument();
  });

  test("displays 100% Finalized celebration banner when all stages complete", () => {
    const completedSession: BridgeSession = {
      ...mockSession,
      currentStage: "destination_minted",
      stageStatuses: {
        source_confirmed: "completed",
        relayer_picked_up: "completed",
        proof_generated: "completed",
        destination_minted: "completed",
      },
    };

    render(<BridgeTransferTracker session={completedSession} />);
    expect(
      screen.getByText(
        "Bridge transfer successfully completed and minted on destination!"
      )
    ).toBeInTheDocument();
    expect(screen.getByText("100% Finalized")).toBeInTheDocument();
  });

  test("renders retry button and error banner when stage fails", () => {
    const failedSession: BridgeSession = {
      ...mockSession,
      currentStage: "relayer_picked_up",
      stageStatuses: {
        source_confirmed: "completed",
        relayer_picked_up: "failed",
        proof_generated: "pending",
        destination_minted: "pending",
      },
    };

    const handleRetry = jest.fn();
    render(
      <BridgeTransferTracker
        session={failedSession}
        onRetryStage={handleRetry}
      />
    );

    expect(
      screen.getByText(/Transfer stalled during relayer picked up/i)
    ).toBeInTheDocument();

    const retryButton = screen.getByRole("button", { name: /retry/i });
    expect(retryButton).toBeInTheDocument();
    fireEvent.click(retryButton);
    expect(handleRetry).toHaveBeenCalledWith("relayer_picked_up");
  });

  test("has proper accessibility attributes (ARIA region and lists)", () => {
    render(<BridgeTransferTracker session={mockSession} />);

    expect(
      screen.getByRole("region", {
        name: "Cross-Chain Bridge Transfer Status Tracker",
      })
    ).toBeInTheDocument();

    expect(screen.getByRole("list")).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBe(4);
  });
});
