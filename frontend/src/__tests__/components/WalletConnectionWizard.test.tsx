import React from "react";
import { render, screen } from "@testing-library/react";
import WalletConnectionWizard from "@/components/WalletConnectionWizard";
import { WalletProvider } from "@/components/providers/WalletProvider";

jest.mock("@/components/providers/WalletProvider", () => ({
  WalletProvider: ({ children }: { children: React.ReactNode }) => children,
  useWallet: () => ({
    connect: jest.fn(),
    disconnect: jest.fn(),
    activeWallet: null,
    activeAccount: null,
    allAccounts: [],
    switchAccount: jest.fn(),
    status: "idle",
    error: null,
    reauthenticationRequired: false,
    reauthenticate: jest.fn(),
    sessionValidation: "idle",
    isWalletDetected: () => false,
    retry: jest.fn(),
    lastAttemptedWallet: null,
  }),
}));

describe("WalletConnectionWizard", () => {
  it("renders the supported Stellar software and hardware wallet options", () => {
    render(
      <WalletProvider>
        <WalletConnectionWizard />
      </WalletProvider>,
    );

    expect(
      screen.getByText(/Unified Stellar Wallet Suite/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Freighter/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Albedo Link/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /xBull Wallet/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Hana Wallet/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /WalletConnect/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ledger" })).toBeInTheDocument();
  });
});
