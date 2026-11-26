import { jest } from '@jest/globals';
import {
  Account,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import {
  DEFAULT_BASE_FEE,
  DEFAULT_STALL_TIMEOUT_MS,
  calculateIncrementedFee,
  computeDynamicBaseFee,
  createFeeBumpTransaction,
  getDynamicBaseFee,
  submitWithAutoFeeBump,
} from '../src/services/stellar/feeBumpService.js';

function buildSignedInnerTx(sourceKeypair, fee = '100') {
  const account = new Account(sourceKeypair.publicKey(), '1000');
  const tx = new TransactionBuilder(account, {
    fee,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.manageData({
        name: 'deploy',
        value: 'wasm',
      })
    )
    .setTimeout(180)
    .build();
  tx.sign(sourceKeypair);
  return tx;
}

describe('feeBumpService', () => {
  it('computes dynamic P90 base fee from Horizon /fee_stats', () => {
    const feeStats = {
      last_ledger_base_fee: '100',
      fee_charged: {
        p50: '100',
        p90: '450',
        p99: '2000',
      },
      max_fee: {
        p50: '200',
        p90: '600',
        p99: '5000',
      },
    };

    expect(computeDynamicBaseFee(feeStats)).toBe(600);
    expect(computeDynamicBaseFee(feeStats, { maxFee: 500 })).toBe(500);
    expect(computeDynamicBaseFee(null)).toBe(DEFAULT_BASE_FEE);
  });

  it('polls Horizon /fee_stats and falls back gracefully on error', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        last_ledger_base_fee: '100',
        fee_charged: { p90: '750' },
        max_fee: { p90: '900' },
      }),
    });

    const dynamic = await getDynamicBaseFee({
      network: 'testnet',
      fetchImpl: mockFetch,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://horizon-testnet.stellar.org/fee_stats',
      expect.objectContaining({ method: 'GET' })
    );
    expect(dynamic).toMatchObject({ fee: 900, source: 'horizon' });

    const failingFetch = jest.fn().mockRejectedValue(new Error('network down'));
    const fallback = await getDynamicBaseFee({
      network: 'testnet',
      fetchImpl: failingFetch,
      fallbackBaseFee: 250,
    });
    expect(fallback).toMatchObject({ fee: 250, source: 'fallback' });
  });

  it('builds and signs a SEP-0029 fee-bump transaction with incremented fee', () => {
    const sourceKeypair = Keypair.random();
    const feeSponsorKeypair = Keypair.random();
    const innerTx = buildSignedInnerTx(sourceKeypair, '200');

    const bumped = createFeeBumpTransaction({
      innerTransaction: innerTx,
      feeSource: feeSponsorKeypair.publicKey(),
      newBaseFee: 1000,
      network: 'testnet',
      feeSourceKeypair: feeSponsorKeypair,
    });

    expect(bumped.fee).toBe(1000);
    expect(bumped.innerHash).toBe(innerTx.hash().toString('hex'));
    expect(bumped.hash).not.toBe(bumped.innerHash);
    expect(bumped.xdr).toBeTruthy();
    expect(bumped.feeBumpTransaction.feeSource).toBe(
      feeSponsorKeypair.publicKey()
    );
    expect(bumped.feeBumpTransaction.signatures).toHaveLength(1);
  });

  it('calculates incremented fees respecting multiplier and dynamic P90', () => {
    expect(calculateIncrementedFee(200, 150)).toBe(300);
    expect(calculateIncrementedFee(200, 800)).toBe(800);
    expect(calculateIncrementedFee(500, 1000, { maxFee: 700 })).toBe(700);
  });

  it('automatically bumps and resolves a stalled transaction after timeout', async () => {
    const sourceKeypair = Keypair.random();
    const innerTx = buildSignedInnerTx(sourceKeypair, '100');

    let feeStatsCall = 0;
    const mockFetch = jest.fn().mockImplementation(async () => {
      feeStatsCall += 1;
      return {
        ok: true,
        json: async () => ({
          last_ledger_base_fee: '100',
          fee_charged: { p90: feeStatsCall === 1 ? '200' : '600' },
          max_fee: { p90: feeStatsCall === 1 ? '250' : '800' },
        }),
      };
    });

    const submittedAttempts = [];
    const submitTransaction = jest.fn(async (tx, meta) => {
      submittedAttempts.push({
        attempt: meta.attempt,
        fee: meta.fee,
        isFeeBump: meta.isFeeBump,
        hash: tx.hash().toString('hex'),
      });
      return { status: 'pending', hash: tx.hash().toString('hex') };
    });

    const checkTransactionStatus = jest.fn(async (hash, meta) => {
      // Simulate mempool stall on initial attempt (attempt 0), confirm after fee bump (attempt 1)
      if (meta.attempt === 0) {
        return { status: 'pending' };
      }
      return {
        status: 'confirmed',
        result: { hash, successful: true, ledger: 12345 },
      };
    });

    const onFeeBump = jest.fn();

    const result = await submitWithAutoFeeBump({
      innerTransaction: innerTx,
      feeSource: sourceKeypair.publicKey(),
      feeSourceKeypair: sourceKeypair,
      network: 'testnet',
      fetchImpl: mockFetch,
      submitTransaction,
      checkTransactionStatus,
      stallTimeoutMs: 25,
      pollIntervalMs: 10,
      maxBumps: 3,
      onFeeBump,
    });

    expect(DEFAULT_STALL_TIMEOUT_MS).toBe(30_000);
    expect(result.status).toBe('confirmed');
    expect(result.bumps).toBe(1);
    expect(result.fee).toBe(800);
    expect(result.bumpHistory).toHaveLength(1);
    expect(result.bumpHistory[0]).toMatchObject({
      attempt: 1,
      previousFee: 250,
      newFee: 800,
    });
    expect(onFeeBump).toHaveBeenCalledTimes(1);
    expect(submittedAttempts).toHaveLength(2);
    expect(submittedAttempts[0].isFeeBump).toBe(false);
    expect(submittedAttempts[1].isFeeBump).toBe(true);
  });

  it('throws TX_STALLED_MAX_BUMPS when transaction remains stuck after maxBumps', async () => {
    const sourceKeypair = Keypair.random();
    const innerTx = buildSignedInnerTx(sourceKeypair, '100');

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        last_ledger_base_fee: '100',
        fee_charged: { p90: '200' },
        max_fee: { p90: '200' },
      }),
    });

    const submitTransaction = jest.fn(async (tx) => ({
      status: 'pending',
      hash: tx.hash().toString('hex'),
    }));

    const checkTransactionStatus = jest.fn(async () => ({
      status: 'pending',
    }));

    await expect(
      submitWithAutoFeeBump({
        innerTransaction: innerTx,
        feeSource: sourceKeypair.publicKey(),
        feeSourceKeypair: sourceKeypair,
        network: 'testnet',
        fetchImpl: mockFetch,
        submitTransaction,
        checkTransactionStatus,
        stallTimeoutMs: 15,
        pollIntervalMs: 5,
        maxBumps: 2,
      })
    ).rejects.toMatchObject({
      code: 'TX_STALLED_MAX_BUMPS',
      bumps: 2,
    });

    expect(submitTransaction).toHaveBeenCalledTimes(3);
  });
});
