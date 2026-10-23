// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import {
  Keypair,
  Networks,
  Account,
  TransactionBuilder,
  Operation,
  Asset,
  FeeBumpTransaction,
} from "@stellar/stellar-sdk";
import {
  FeeBumpService,
  RelayerBudgetExhaustedError,
} from "../../services/stellar/feeBumpService";

describe("FeeBumpService", () => {
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
      budgetLimitStroops: BigInt(5000), // 5,000 stroops budget for testing
      remainingBudgetStroops: BigInt(5000),
      maxBaseFeeStroops: 200,
    });

    // Create a mock signed inner transaction from student
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

  it("initializes with the configured relayer key and address", () => {
    expect(service.getSponsorAddress()).toBe(relayerKey.publicKey());
    expect(service.getNetworkPassphrase()).toBe(networkPassphrase);
  });

  it("wraps a signed student transaction envelope in a Fee Bump transaction sponsored by relayer", () => {
    const result = service.wrapWithFeeBump({
      innerTxXdr: testSignedInnerXdr,
    });

    expect(result.isSponsored).toBe(true);
    expect(result.sponsorAddress).toBe(relayerKey.publicKey());
    expect(result.feeBumpXdr).toBeDefined();

    // Parse the generated Fee Bump XDR to verify structure
    const parsed = TransactionBuilder.fromXDR(result.feeBumpXdr, networkPassphrase);
    expect(parsed).toBeInstanceOf(FeeBumpTransaction);
    const feeBump = parsed as FeeBumpTransaction;
    expect(feeBump.feeSource).toBe(relayerKey.publicKey());
    expect(Number(feeBump.fee)).toBeGreaterThanOrEqual(200);
    expect(feeBump.innerTransaction.source).toBe(studentKey.publicKey());
  });

  it("calculates fee breakdown correctly showing sponsor address, max fee limits, and 0 fee for student", () => {
    const breakdown = service.calculateFeeBreakdown(testSignedInnerXdr, true);

    expect(breakdown.isSponsored).toBe(true);
    expect(breakdown.sponsorAddress).toBe(relayerKey.publicKey());
    expect(breakdown.studentFeeStroops).toBe("0");
    expect(breakdown.studentFeeXlm).toBe("0.0000000 XLM");
    expect(breakdown.maxFeeStroops).toBeDefined();
    expect(breakdown.maxFeeXlm).toBeDefined();
    expect(breakdown.innerFeeStroops).toBe("100");
  });

  it("calculates fee breakdown for self-pay when sponsorship is disabled", () => {
    const breakdown = service.calculateFeeBreakdown(testSignedInnerXdr, false);

    expect(breakdown.isSponsored).toBe(false);
    expect(breakdown.sponsorAddress).toBeUndefined();
    expect(breakdown.studentFeeStroops).toBe("100");
    expect(breakdown.studentFeeXlm).toBe("0.0000100 XLM");
  });

  it("tracks budget usage when wrapping transactions", () => {
    const initialBudget = service.getRemainingBudget();
    const result = service.wrapWithFeeBump({
      innerTxXdr: testSignedInnerXdr,
    });

    const feeCharged = BigInt(result.maxFeeStroops);
    expect(service.getRemainingBudget()).toBe(initialBudget - feeCharged);
  });

  it("throws RelayerBudgetExhaustedError when relayer budget is exhausted", () => {
    service.exhaustBudget();
    expect(service.isBudgetExhausted()).toBe(true);

    expect(() => {
      service.wrapWithFeeBump({
        innerTxXdr: testSignedInnerXdr,
      });
    }).toThrow(RelayerBudgetExhaustedError);
  });

  it("gracefully falls back to self-pay in prepareTransaction if relayer budget is exhausted", () => {
    service.exhaustBudget();

    const result = service.prepareTransaction(testSignedInnerXdr, true);

    expect(result.isSponsored).toBe(false);
    expect(result.fellBack).toBe(true);
    expect(result.xdr).toBe(testSignedInnerXdr);
    expect(result.fallbackReason).toContain("Relayer sponsor budget is exhausted");
  });

  it("resets budget correctly", () => {
    service.exhaustBudget();
    expect(service.isBudgetExhausted()).toBe(true);

    service.resetBudget();
    expect(service.isBudgetExhausted()).toBe(false);
    expect(service.getRemainingBudget()).toBe(BigInt(5000));
  });
});
