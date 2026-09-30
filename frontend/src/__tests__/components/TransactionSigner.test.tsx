import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import TransactionSigner from "@/components/TransactionSigner";

const mockSignTransaction = jest.fn();
let mockActiveWallet: string | null = "freighter";

jest.mock("@/components/providers/WalletProvider", () => ({
  useWallet: () => ({
    signTransaction: mockSignTransaction,
    status: "connected",
    error: null,
    network: "Testnet",
    networkPassphrase: "Test SDF Network ; September 2015",
    activeWallet: mockActiveWallet,
  }),
}));

jest.mock("@stellar/stellar-sdk", () => ({
  TransactionBuilder: { fromXDR: jest.fn() },
}), { virtual: true });

const mockTransactionBuilder = jest.requireMock("@stellar/stellar-sdk").TransactionBuilder;

describe("TransactionSigner", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActiveWallet = "freighter";
    mockTransactionBuilder.fromXDR.mockReturnValue({
      fee: "100",
      operations: [{ type: "payment" }, { type: "invokeHostFunction" }],
    });
    mockSignTransaction.mockResolvedValue("signed-transaction-xdr");
  });

  it("requires review and passes only the signed XDR to the callback", async () => {
    const onSign = jest.fn();
    render(
      <TransactionSigner
        xdr="unsigned-transaction-xdr"
        onSign={onSign}
        isOpen
      />,
    );

    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText(/100 stroops/)).toBeInTheDocument();
    const signButton = screen.getByRole("button", { name: "Review & Sign" });
    expect(signButton).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(signButton).toBeEnabled();
    fireEvent.click(signButton);

    await waitFor(() =>
      expect(onSign).toHaveBeenCalledWith("signed-transaction-xdr"),
    );
    expect(mockSignTransaction).toHaveBeenCalledWith("unsigned-transaction-xdr");
  });

  it("blocks invalid XDR from signing", () => {
    mockTransactionBuilder.fromXDR.mockImplementation(() => {
      throw new Error("invalid xdr");
    });
    render(
      <TransactionSigner xdr="invalid-xdr" onSign={jest.fn()} isOpen />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("invalid");
    expect(screen.getByRole("button", { name: "Review & Sign" })).toBeDisabled();
    expect(mockSignTransaction).not.toHaveBeenCalled();
  });

  it("shows the interactive device-screen guide for Ledger", () => {
    mockActiveWallet = "ledger";
    render(<TransactionSigner xdr="ledger-transaction-xdr" isOpen />);

    expect(screen.getByText("Ledger device confirmation")).toBeInTheDocument();
    expect(screen.getByText(/open the Stellar app/i)).toBeInTheDocument();
    expect(screen.getByText(/Confirm on the Ledger/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Review & Send to Ledger" }),
    ).toBeDisabled();
  });
});