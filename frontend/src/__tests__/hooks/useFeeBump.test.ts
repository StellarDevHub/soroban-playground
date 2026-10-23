// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { renderHook, act } from "@testing-library/react";
import {
  Keypair,
  Networks,
  Account,
  TransactionBuilder,
  Operation,
  Asset,
} from "@stellar/stellar-sdk";
import { FeeBumpService } from "../../services/stellar/feeBumpService";
import { useFeeBump } from "../../hooks/useFeeBump";

describe("useFeeBump", () => {
  let service: FeeBumpService;
  let studentKey: Keypair;
  let relayerKey: Keypair;
  let testSignedInnerXdr: string;
  const networkPassphrase = Networks.TESTNET;

  beforeEach(() => {
    studentKey = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1));
    relayerKey = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2));

    service = new FeeBumpService({
      secretKey: relayerKey.secret(),
      networkPassphrase,
      budgetLimitStroops: BigInt(5000),
      remainingBudgetStroops: BigInt(5000),
      maxBaseFeeStroops: 200,
    });

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
  });

  it("initializes with sponsorship enabled by default and populates sponsor address", () => {
    const { result } = renderHook(() =>
      useFeeBump({
        service,
        networkPassphrase,
      })
    );

    expect(result.current.isSponsored).toBe(true);
    expect(result.current.sponsorAddress).toBe(relayerKey.publicKey());
    expect(result.current.isBudgetExhausted).toBe(false);
    expect(result.current.fallbackOccurred).toBe(false);
  });

  it("toggles sponsorship between sponsored and self-pay", () => {
    const { result } = renderHook(() =>
      useFeeBump({
        service,
        networkPassphrase,
      })
    );

    act(() => {
      result.current.toggleSponsorship();
    });
    expect(result.current.isSponsored).toBe(false);

    act(() => {
      result.current.toggleSponsorship();
    });
    expect(result.current.isSponsored).toBe(true);
  });

  it("calculates fee breakdown with sponsor address and max fee limits", () => {
    const { result } = renderHook(() =>
      useFeeBump({
        service,
        networkPassphrase,
      })
    );

    const breakdown = result.current.getFeeBreakdown(testSignedInnerXdr);
    expect(breakdown.isSponsored).toBe(true);
    expect(breakdown.sponsorAddress).toBe(relayerKey.publicKey());
    expect(breakdown.studentFeeStroops).toBe("0");
    expect(breakdown.maxFeeStroops).toBeDefined();
    expect(breakdown.maxFeeXlm).toBeDefined();
  });

  it("wraps signed transaction envelope in a Fee Bump transaction when sponsored", async () => {
    const { result } = renderHook(() =>
      useFeeBump({
        service,
        networkPassphrase,
      })
    );

    let finalXdr = "";
    await act(async () => {
      finalXdr = await result.current.wrapTransaction(testSignedInnerXdr);
    });

    expect(finalXdr).not.toBe(testSignedInnerXdr);

    const parsed = TransactionBuilder.fromXDR(finalXdr, networkPassphrase) as unknown as {
      feeSource: string;
      innerTransaction: { source: string };
    };
    expect(parsed.feeSource).toBe(relayerKey.publicKey());
    expect(parsed.innerTransaction.source).toBe(studentKey.publicKey());
  });

  it("returns original inner XDR when sponsorship is disabled (self-pay)", async () => {
    const { result } = renderHook(() =>
      useFeeBump({
        service,
        networkPassphrase,
        initialSponsored: false,
      })
    );

    let finalXdr = "";
    await act(async () => {
      finalXdr = await result.current.wrapTransaction(testSignedInnerXdr);
    });

    expect(finalXdr).toBe(testSignedInnerXdr);
  });

  it("falls back gracefully to self-pay if relayer sponsor budget is exhausted during wrapping", async () => {
    service.exhaustBudget();
    const onFallback = jest.fn();

    const { result } = renderHook(() =>
      useFeeBump({
        service,
        networkPassphrase,
        autoFallback: true,
        onFallbackToSelfPay: onFallback,
      })
    );

    let finalXdr = "";
    await act(async () => {
      finalXdr = await result.current.wrapTransaction(testSignedInnerXdr);
    });

    // Gracefully returns the student's inner XDR instead of crashing
    expect(finalXdr).toBe(testSignedInnerXdr);
    expect(result.current.isSponsored).toBe(false);
    expect(result.current.fallbackOccurred).toBe(true);
    expect(result.current.fallbackReason).toContain("Relayer sponsor budget is exhausted");
    expect(onFallback).toHaveBeenCalledWith(expect.stringContaining("Relayer sponsor budget is exhausted"));
  });

  it("submits transaction using submitTransaction and wraps with fee bump", async () => {
    const { result } = renderHook(() =>
      useFeeBump({
        service,
        networkPassphrase,
      })
    );

    const mockSubmit = jest.fn().mockResolvedValue({ hash: "tx-hash-123" });

    let response: unknown;
    await act(async () => {
      response = await result.current.submitTransaction(testSignedInnerXdr, mockSubmit);
    });

    expect(response).toEqual({ hash: "tx-hash-123" });
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    // Submitted XDR should be the fee bump transaction
    const submittedXdr = mockSubmit.mock.calls[0][0];
    expect(submittedXdr).not.toBe(testSignedInnerXdr);
  });
});
