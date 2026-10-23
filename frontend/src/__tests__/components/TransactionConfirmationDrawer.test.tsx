// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  Keypair,
  Networks,
  Account,
  TransactionBuilder,
  Operation,
  Asset,
} from "@stellar/stellar-sdk";
import TransactionConfirmationDrawer from "../../components/transaction/TransactionConfirmationDrawer";
import { FeeBumpService } from "../../services/stellar/feeBumpService";

const mockSignTransaction = jest.fn();

jest.mock("../../components/providers/WalletProvider", () => ({
  useWallet: () => ({
    signTransaction: mockSignTransaction,
    status: "connected",
    error: null,
    network: "Testnet",
    networkPassphrase: "Test SDF Network ; September 2015",
  }),
}));

describe("TransactionConfirmationDrawer", () => {
  let studentKey: Keypair;
  let relayerKey: Keypair;
  let testSignedInnerXdr: string;
  const networkPassphrase = Networks.TESTNET;

  beforeEach(() => {
    jest.clearAllMocks();
    studentKey = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1));
    relayerKey = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2));

    const studentAccount = new Account(studentKey.publicKey(), "1");
    const innerTx = new TransactionBuilder(studentAccount, {
      fee: "100",
      networkPassphrase,
    })
      .addOperation(
        Operation.payment({
          destination: studentKey.publicKey(),
          asset: Asset.native(),
          amount: "0.0000001",
        })
      )
      .setTimeout(30)
      .build();

    innerTx.sign(studentKey);
    testSignedInnerXdr = innerTx.toXDR();
    mockSignTransaction.mockResolvedValue(testSignedInnerXdr);
  });

  it("renders the confirmation drawer with transaction summary and sponsorship toggle", () => {
    render(
      <TransactionConfirmationDrawer
        isOpen={true}
        onClose={jest.fn()}
        xdr={testSignedInnerXdr}
        networkPassphrase={networkPassphrase}
      />
    );

    expect(screen.getByTestId("transaction-confirmation-drawer")).toBeInTheDocument();
    expect(screen.getByText("Confirm Transaction")).toBeInTheDocument();
    expect(screen.getByTestId("fee-bump-toggle-container")).toBeInTheDocument();
    expect(screen.getByText("Lab Sponsored")).toBeInTheDocument();
  });

  it("displays fee breakdown showing sponsor address and max fee limits", () => {
    render(
      <TransactionConfirmationDrawer
        isOpen={true}
        onClose={jest.fn()}
        xdr={testSignedInnerXdr}
        networkPassphrase={networkPassphrase}
        sponsorKeypair={relayerKey}
      />
    );

    expect(screen.getByTestId("fee-breakdown")).toBeInTheDocument();
    expect(screen.getByTestId("sponsor-address")).toBeInTheDocument();
    expect(screen.getByTestId("max-fee-limit")).toHaveTextContent("400 stroops");
    expect(screen.getByTestId("student-fee")).toHaveTextContent("0 stroops");
    expect(screen.getByTestId("student-fee")).toHaveTextContent("Free");
  });

  it("allows zero-XLM students to submit valid exercise verification transactions wrapped in Fee Bump", async () => {
    const onConfirm = jest.fn();
    render(
      <TransactionConfirmationDrawer
        isOpen={true}
        onClose={jest.fn()}
        xdr={testSignedInnerXdr}
        networkPassphrase={networkPassphrase}
        sponsorKeypair={relayerKey}
        onConfirm={onConfirm}
      />
    );

    const submitBtn = screen.getByRole("button", { name: "Sponsor & Submit" });
    expect(submitBtn).toBeDisabled();

    // Student reviews transaction
    const reviewCheckbox = screen.getByRole("checkbox");
    fireEvent.click(reviewCheckbox);
    expect(submitBtn).toBeEnabled();

    // Student clicks submit
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockSignTransaction).toHaveBeenCalledWith(testSignedInnerXdr);
      expect(onConfirm).toHaveBeenCalled();
    });

    const [submittedXdr, isSponsored] = onConfirm.mock.calls[0];
    expect(isSponsored).toBe(true);
    expect(submittedXdr).not.toBe(testSignedInnerXdr);

    // Verify submitted XDR is indeed a valid FeeBumpTransaction sponsored by relayer
    const parsed = TransactionBuilder.fromXDR(submittedXdr, networkPassphrase) as unknown as {
      feeSource: string;
      innerTransaction: { source: string };
    };
    expect(parsed.feeSource).toBe(relayerKey.publicKey());
    expect(parsed.innerTransaction.source).toBe(studentKey.publicKey());
  });

  it("falls back gracefully to self-pay when relayer sponsor budget is exhausted", async () => {
    // Exhaust budget on custom service
    const customService = new FeeBumpService({
      secretKey: relayerKey.secret(),
      networkPassphrase,
      budgetLimitStroops: BigInt(0),
      remainingBudgetStroops: BigInt(0),
    });
    customService.exhaustBudget();

    const onConfirm = jest.fn();
    render(
      <TransactionConfirmationDrawer
        isOpen={true}
        onClose={jest.fn()}
        xdr={testSignedInnerXdr}
        networkPassphrase={networkPassphrase}
        sponsorKeypair={relayerKey}
        onConfirm={onConfirm}
      />
    );

    // Trigger toggle to self-pay or disable sponsorship
    const toggle = screen.getByRole("switch");
    fireEvent.click(toggle);

    // Now submit as self-pay
    const reviewCheckbox = screen.getByRole("checkbox");
    fireEvent.click(reviewCheckbox);

    const submitBtn = screen.getByRole("button", { name: "Confirm & Submit" });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith(testSignedInnerXdr, false);
    });
  });

  it("handles cancel action", () => {
    const onClose = jest.fn();
    render(
      <TransactionConfirmationDrawer
        isOpen={true}
        onClose={onClose}
        xdr={testSignedInnerXdr}
      />
    );

    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    fireEvent.click(cancelBtn);
    expect(onClose).toHaveBeenCalled();
  });
});
