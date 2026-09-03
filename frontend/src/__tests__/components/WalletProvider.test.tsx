import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { WalletProvider, useWallet } from "@/components/providers/WalletProvider";
import WalletModal from "@/components/WalletModal";

function TestConsumer() {
  const {
    connect,
    disconnect,
    activeWallet,
    activeAccount,
    status,
    network,
    openWalletModal,
  } = useWallet();

  return (
    <div>
      <div data-testid="wallet-status">{status}</div>
      <div data-testid="active-wallet">{activeWallet || "none"}</div>
      <div data-testid="active-account">{activeAccount || "none"}</div>
      <div data-testid="network">{network || "none"}</div>
      <button onClick={() => connect("albedo")}>Connect Albedo</button>
      <button onClick={() => connect("xbull")}>Connect xBull</button>
      <button onClick={disconnect}>Disconnect</button>
      <button onClick={openWalletModal}>Open Modal</button>
      <WalletModal />
    </div>
  );
}

describe("WalletProvider & Session Management", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  it("connects to Albedo and updates context and localStorage", async () => {
    render(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>,
    );

    expect(screen.getByTestId("wallet-status")).toHaveTextContent("idle");

    await act(async () => {
      fireEvent.click(screen.getByText("Connect Albedo"));
    });

    expect(screen.getByTestId("wallet-status")).toHaveTextContent("connected");
    expect(screen.getByTestId("active-wallet")).toHaveTextContent("albedo");
    expect(screen.getByTestId("network")).toHaveTextContent("TESTNET");
    expect(localStorage.getItem("preferred_wallet")).toBe("albedo");
    expect(localStorage.getItem("preferred_account")).toBeTruthy();
  });

  it("handles disconnect and clears stored session", async () => {
    render(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Connect xBull"));
    });

    expect(screen.getByTestId("wallet-status")).toHaveTextContent("connected");
    expect(screen.getByTestId("active-wallet")).toHaveTextContent("xbull");

    await act(async () => {
      fireEvent.click(screen.getByText("Disconnect"));
    });

    expect(screen.getByTestId("wallet-status")).toHaveTextContent("idle");
    expect(screen.getByTestId("active-wallet")).toHaveTextContent("none");
    expect(localStorage.getItem("preferred_wallet")).toBeNull();
  });

  it("opens and closes WalletModal", async () => {
    render(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText("Open Modal"));
    });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Connect Stellar Wallet")).toBeInTheDocument();

    const closeBtn = screen.getByRole("button", { name: /close modal/i });
    await act(async () => {
      fireEvent.click(closeBtn);
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
