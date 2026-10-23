// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import {
  Keypair,
  Networks,
  Transaction,
  TransactionBuilder,
  FeeBumpTransaction,
} from "@stellar/stellar-sdk";

export class RelayerBudgetExhaustedError extends Error {
  constructor(message = "Relayer sponsor budget is exhausted") {
    super(message);
    this.name = "RelayerBudgetExhaustedError";
  }
}

export interface FeeBreakdown {
  isSponsored: boolean;
  sponsorAddress?: string;
  innerFeeStroops: string;
  innerFeeXlm: string;
  maxFeeStroops?: string;
  maxFeeXlm?: string;
  studentFeeStroops: string;
  studentFeeXlm: string;
  sponsorBudgetRemainingStroops?: string;
  sponsorBudgetRemainingXlm?: string;
}

export interface RelayerConfig {
  secretKey?: string;
  publicKey?: string;
  maxBaseFeeStroops?: number;
  budgetLimitStroops?: bigint;
  remainingBudgetStroops?: bigint;
  networkPassphrase?: string;
}

export interface WrapFeeBumpOptions {
  innerTxXdr: string;
  sponsorKeypair?: Keypair | string;
  maxBaseFee?: number | string;
  networkPassphrase?: string;
}

export interface FeeBumpResult {
  feeBumpXdr: string;
  sponsorAddress: string;
  maxFeeStroops: string;
  maxFeeXlm: string;
  innerFeeStroops: string;
  isSponsored: true;
}

export interface PreparedTransactionResult {
  xdr: string;
  isSponsored: boolean;
  fellBack: boolean;
  fallbackReason?: string;
  sponsorAddress?: string;
  maxFeeStroops?: string;
  maxFeeXlm?: string;
}

// Deterministic fallback lab relayer keypair for testnet student exercises
const DEFAULT_LAB_RELAYER_SEED = "soroban-playground-lab-relayer!!";
const DEFAULT_NETWORK_PASSPHRASE = Networks.TESTNET;
const DEFAULT_BASE_FEE_STROOPS = 200;
// Default initial budget: 100 XLM (1,000,000,000 stroops)
const DEFAULT_BUDGET_LIMIT_STROOPS = BigInt(1_000_000_000);

export class FeeBumpService {
  private relayerKeypair: Keypair;
  private networkPassphrase: string;
  private maxBaseFeeStroops: number;
  private budgetLimitStroops: bigint;
  private remainingBudgetStroops: bigint;
  private isForceExhausted = false;

  constructor(config?: Partial<RelayerConfig>) {
    this.networkPassphrase =
      config?.networkPassphrase ??
      (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_STELLAR_NETWORK === "mainnet"
        ? Networks.PUBLIC
        : DEFAULT_NETWORK_PASSPHRASE);

    this.relayerKeypair = this.resolveKeypair(config?.secretKey);
    this.maxBaseFeeStroops = config?.maxBaseFeeStroops ?? DEFAULT_BASE_FEE_STROOPS;
    this.budgetLimitStroops = config?.budgetLimitStroops ?? DEFAULT_BUDGET_LIMIT_STROOPS;
    this.remainingBudgetStroops =
      config?.remainingBudgetStroops ?? this.budgetLimitStroops;
  }

  private resolveKeypair(customSecret?: string): Keypair {
    const envSecret =
      typeof process !== "undefined"
        ? process.env?.NEXT_PUBLIC_LAB_RELAYER_SECRET_KEY ||
          process.env?.LAB_RELAYER_SECRET_KEY
        : undefined;

    const secret = customSecret || envSecret;
    if (secret) {
      try {
        return Keypair.fromSecret(secret);
      } catch (err) {
        console.warn("Invalid relayer secret key provided, falling back to default lab relayer", err);
      }
    }

    return Keypair.fromRawEd25519Seed(Buffer.from(DEFAULT_LAB_RELAYER_SEED, "utf-8"));
  }

  public getSponsorAddress(): string {
    return this.relayerKeypair.publicKey();
  }

  public getSponsorKeypair(): Keypair {
    return this.relayerKeypair;
  }

  public setRelayerKeypair(keypairOrSecret: Keypair | string): void {
    if (typeof keypairOrSecret === "string") {
      this.relayerKeypair = Keypair.fromSecret(keypairOrSecret);
    } else {
      this.relayerKeypair = keypairOrSecret;
    }
  }

  public getNetworkPassphrase(): string {
    return this.networkPassphrase;
  }

  public setNetworkPassphrase(networkPassphrase: string): void {
    this.networkPassphrase = networkPassphrase;
  }

  // --- Budget Management ---

  public getRemainingBudget(): bigint {
    return this.isForceExhausted ? BigInt(0) : this.remainingBudgetStroops;
  }

  public getBudgetLimit(): bigint {
    return this.budgetLimitStroops;
  }

  public setBudgetLimit(stroops: bigint | number): void {
    this.budgetLimitStroops = BigInt(stroops);
    this.remainingBudgetStroops = BigInt(stroops);
    this.isForceExhausted = false;
  }

  public setRemainingBudget(stroops: bigint | number): void {
    this.remainingBudgetStroops = BigInt(stroops);
    if (this.remainingBudgetStroops <= BigInt(0)) {
      this.isForceExhausted = true;
    } else {
      this.isForceExhausted = false;
    }
  }

  public exhaustBudget(): void {
    this.isForceExhausted = true;
    this.remainingBudgetStroops = BigInt(0);
  }

  public resetBudget(): void {
    this.isForceExhausted = false;
    this.remainingBudgetStroops = this.budgetLimitStroops;
  }

  public isBudgetExhausted(requiredFeeStroops: number | bigint | string = 0): boolean {
    if (this.isForceExhausted) return true;
    const required = BigInt(requiredFeeStroops);
    return this.remainingBudgetStroops <= BigInt(0) || this.remainingBudgetStroops < required;
  }

  public recordFeeUsage(feeStroops: number | bigint | string): void {
    const fee = BigInt(feeStroops);
    if (this.remainingBudgetStroops >= fee) {
      this.remainingBudgetStroops -= fee;
    } else {
      this.remainingBudgetStroops = BigInt(0);
      this.isForceExhausted = true;
    }
  }

  // --- Fee Calculations ---

  public calculateFeeBreakdown(
    innerTxXdr: string,
    isSponsored: boolean,
    networkPassphrase?: string
  ): FeeBreakdown {
    const netPassphrase = networkPassphrase ?? this.networkPassphrase;
    let innerFeeStroops = "100";
    let operationCount = 1;
    let resourceFee = 0;

    try {
      const parsed = TransactionBuilder.fromXDR(innerTxXdr, netPassphrase) as unknown as {
        fee?: string;
        operations?: unknown[];
        innerTransaction?: { fee?: string; operations?: unknown[] };
        toEnvelope?: () => { type: string; value: { tx: { ext: { type: string; value: { resourceFee: number } } } } };
      };

      const tx = parsed.innerTransaction ?? parsed;
      if (parsed.fee) {
        innerFeeStroops = parsed.fee;
      }
      if (Array.isArray(tx.operations)) {
        operationCount = Math.max(1, tx.operations.length);
      }

      if (typeof parsed.toEnvelope === "function") {
        const env = parsed.toEnvelope();
        if (env?.type === "envelopeTypeTx" && env.value?.tx?.ext?.type === "sorobanData") {
          resourceFee = Number(env.value.tx.ext.value.resourceFee) || 0;
        }
      }
    } catch {
      // If parsing fails, use defaults
    }

    const innerFeeNum = Number(innerFeeStroops) || 100;
    const innerFeeXlm = `${(innerFeeNum / 10_000_000).toFixed(7)} XLM`;
    const remainingBudget = this.getRemainingBudget();
    const remainingBudgetXlm = `${(Number(remainingBudget) / 10_000_000).toFixed(7)} XLM`;

    if (!isSponsored) {
      return {
        isSponsored: false,
        innerFeeStroops,
        innerFeeXlm,
        studentFeeStroops: innerFeeStroops,
        studentFeeXlm: innerFeeXlm,
        sponsorBudgetRemainingStroops: remainingBudget.toString(),
        sponsorBudgetRemainingXlm: remainingBudgetXlm,
      };
    }

    // Calculate sponsored max fee limit
    const innerInclusionFee = Math.ceil(
      Math.max(0, innerFeeNum - resourceFee) / operationCount
    );
    const minBaseFee = Math.max(100, innerInclusionFee);
    const effectiveBaseFee = Math.max(this.maxBaseFeeStroops, minBaseFee);
    // Total max fee = baseFee * (innerOps + 1) + resourceFee
    const totalMaxFeeStroops = effectiveBaseFee * (operationCount + 1) + resourceFee;
    const maxFeeXlm = `${(totalMaxFeeStroops / 10_000_000).toFixed(7)} XLM`;

    return {
      isSponsored: true,
      sponsorAddress: this.getSponsorAddress(),
      innerFeeStroops,
      innerFeeXlm,
      maxFeeStroops: totalMaxFeeStroops.toString(),
      maxFeeXlm,
      studentFeeStroops: "0",
      studentFeeXlm: "0.0000000 XLM",
      sponsorBudgetRemainingStroops: remainingBudget.toString(),
      sponsorBudgetRemainingXlm: remainingBudgetXlm,
    };
  }

  // --- Fee Bump Wrapping ---

  public wrapWithFeeBump(options: WrapFeeBumpOptions): FeeBumpResult {
    const { innerTxXdr, sponsorKeypair, maxBaseFee, networkPassphrase } = options;
    const netPassphrase = networkPassphrase ?? this.networkPassphrase;

    const sponsor =
      typeof sponsorKeypair === "string"
        ? Keypair.fromSecret(sponsorKeypair)
        : sponsorKeypair ?? this.relayerKeypair;

    // Decode inner transaction
    let parsed = TransactionBuilder.fromXDR(innerTxXdr, netPassphrase);

    if (parsed instanceof FeeBumpTransaction) {
      // Already a fee bump transaction, extract inner transaction
      parsed = (parsed as unknown as { innerTransaction: Transaction }).innerTransaction;
    }

    const innerTx = parsed as Transaction;
    const innerOps = Math.max(1, innerTx.operations?.length ?? 1);

    // Extract resource fee if present (Soroban contracts)
    let resourceFee = 0;
    try {
      const env = innerTx.toEnvelope() as any;
      if (env?.type === "envelopeTypeTx" && env?.value?.tx?.ext?.type === "sorobanData") {
        resourceFee = Number(env.value.tx.ext.value.resourceFee) || 0;
      }
    } catch {
      // Ignored
    }

    const innerInclusionFee = Math.ceil(
      Math.max(0, Number(innerTx.fee) - resourceFee) / innerOps
    );
    const minBaseFee = Math.max(100, innerInclusionFee);
    const configuredBaseFee = Number(maxBaseFee ?? this.maxBaseFeeStroops);
    const effectiveBaseFee = Math.max(configuredBaseFee, minBaseFee);

    // Estimate total max fee to verify against budget
    const estimatedTotalFee = effectiveBaseFee * (innerOps + 1) + resourceFee;

    if (this.isBudgetExhausted(estimatedTotalFee)) {
      throw new RelayerBudgetExhaustedError(
        `Relayer sponsor budget is exhausted. Required: ${estimatedTotalFee} stroops, Remaining: ${this.getRemainingBudget()} stroops`
      );
    }

    // Build the fee bump transaction
    const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
      sponsor,
      effectiveBaseFee.toString(),
      innerTx,
      netPassphrase
    );

    // Sign with sponsor keypair
    feeBumpTx.sign(sponsor);

    // Record usage
    this.recordFeeUsage(feeBumpTx.fee);

    const feeNum = Number(feeBumpTx.fee);
    const maxFeeXlm = `${(feeNum / 10_000_000).toFixed(7)} XLM`;

    return {
      feeBumpXdr: feeBumpTx.toXDR(),
      sponsorAddress: sponsor.publicKey(),
      maxFeeStroops: feeBumpTx.fee,
      maxFeeXlm,
      innerFeeStroops: innerTx.fee,
      isSponsored: true,
    };
  }

  // --- Prepare / Submit with Graceful Fallback ---

  public prepareTransaction(
    innerTxXdr: string,
    wantsSponsorship: boolean,
    options?: {
      sponsorKeypair?: Keypair | string;
      maxBaseFee?: number | string;
      networkPassphrase?: string;
    }
  ): PreparedTransactionResult {
    if (!wantsSponsorship) {
      return {
        xdr: innerTxXdr,
        isSponsored: false,
        fellBack: false,
      };
    }

    try {
      const result = this.wrapWithFeeBump({
        innerTxXdr,
        sponsorKeypair: options?.sponsorKeypair,
        maxBaseFee: options?.maxBaseFee,
        networkPassphrase: options?.networkPassphrase,
      });

      return {
        xdr: result.feeBumpXdr,
        isSponsored: true,
        fellBack: false,
        sponsorAddress: result.sponsorAddress,
        maxFeeStroops: result.maxFeeStroops,
        maxFeeXlm: result.maxFeeXlm,
      };
    } catch (err) {
      if (err instanceof RelayerBudgetExhaustedError) {
        // Fallback gracefully to self-pay
        return {
          xdr: innerTxXdr,
          isSponsored: false,
          fellBack: true,
          fallbackReason: err.message,
        };
      }
      throw err;
    }
  }
}

// Export singleton instance
export const feeBumpService = new FeeBumpService();
