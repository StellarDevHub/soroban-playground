import { Address, xdr, hash } from '@stellar/stellar-sdk';
import {
  applySafetyBuffer,
  buildSimulationReport,
  normalizeResourceUsage,
  parseRestorePreamble,
  parseSorobanTransactionData,
  runSimulation,
} from '../src/services/simulationService.js';

function makeContractCodeKey(seed) {
  return xdr.LedgerKey.contractCode(
    new xdr.LedgerKeyContractCode({
      hash: hash(Buffer.from(seed)),
    })
  );
}

function makeContractDataKey(contractSeed, symbolName, persistent = true) {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.contract(hash(Buffer.from(contractSeed))).toScAddress(),
      key: xdr.ScVal.scvSymbol(symbolName),
      durability: persistent
        ? xdr.ContractDataDurability.persistent
        : xdr.ContractDataDurability.temporary,
    })
  );
}

function buildSorobanTransactionDataXdr({
  instructions,
  readBytes,
  writeBytes,
  resourceFee,
  readOnly = [],
  readWrite = [],
}) {
  const footprint = new xdr.LedgerFootprint({
    readOnly,
    readWrite,
  });

  const resources = new xdr.SorobanResources({
    footprint,
    instructions,
    diskReadBytes: readBytes,
    writeBytes,
  });
  const txData = new xdr.SorobanTransactionData({
    ext: xdr.SorobanTransactionDataExt.v0(),
    resources,
    resourceFee: xdr.Int64.fromString(String(resourceFee)),
  });

  return txData.toXDR('base64');
}

describe('simulationService - Soroban RPC CPU, memory, and footprint accounting', () => {
  describe('parseSorobanTransactionData', () => {
    test('extracts CPU instructions, read/write bytes, resourceFee, and footprint keys from XDR', () => {
      const readOnly = [
        makeContractCodeKey('hello-wasm'),
        makeContractDataKey('hello-contract', 'INSTANCE'),
      ];
      const readWrite = [makeContractDataKey('hello-contract', 'COUNTER')];

      const txDataXdr = buildSorobanTransactionDataXdr({
        instructions: 425_000,
        readBytes: 4096,
        writeBytes: 1024,
        resourceFee: '85000',
        readOnly,
        readWrite,
      });

      const parsed = parseSorobanTransactionData(txDataXdr);

      expect(parsed).not.toBeNull();
      expect(parsed.cpuInstructions).toBe(425_000);
      expect(parsed.ledgerReadBytes).toBe(4096);
      expect(parsed.ledgerWriteBytes).toBe(1024);
      expect(parsed.resourceFee).toBe('85000');
      expect(parsed.footprint.readOnlyCount).toBe(2);
      expect(parsed.footprint.readWriteCount).toBe(1);
      expect(parsed.footprint.totalEntries).toBe(3);
      expect(parsed.footprint.readOnly[0].type).toBe('contractCode');
      expect(parsed.footprint.readOnly[1].type).toBe('contractData');
      expect(parsed.footprint.readWrite[0].type).toBe('contractData');
    });

    test('returns null for missing or malformed XDR without throwing', () => {
      expect(parseSorobanTransactionData(null)).toBeNull();
      expect(parseSorobanTransactionData('')).toBeNull();
      expect(parseSorobanTransactionData('not-valid-xdr!!!')).toBeNull();
    });
  });

  describe('reference contract simulations', () => {
    test('accurately accounts for a stateless hello_world reference contract', async () => {
      const txDataXdr = buildSorobanTransactionDataXdr({
        instructions: 185_420,
        readBytes: 2048,
        writeBytes: 0,
        resourceFee: '31200',
        readOnly: [makeContractCodeKey('hello-world-v1')],
        readWrite: [],
      });

      const rpcResponse = {
        minResourceFee: '31200',
        cost: {
          cpuInsns: '185420',
          memBytes: '524288',
        },
        transactionData: txDataXdr,
        events: [],
        latestLedger: 512345,
      };

      const report = await runSimulation('AAAA_HELLO_XDR', 'testnet', {
        simulateFn: async () => rpcResponse,
      });

      expect(report.fallback).toBe(false);
      expect(report.parsedTransactionData).toBe(true);
      expect(report.cpuInstructions).toBe(185_420);
      expect(report.memoryBytes).toBe(524_288);
      expect(report.ledgerReadBytes).toBe(2048);
      expect(report.ledgerWriteBytes).toBe(0);
      expect(report.readCount).toBe(1);
      expect(report.writeCount).toBe(0);

      expect(report.resources).toMatchObject({
        cpuInstructions: 185_420,
        memoryBytes: 524_288,
        ledgerReadBytes: 2048,
        ledgerWriteBytes: 0,
        readOnlyEntries: 1,
        readWriteEntries: 0,
        totalFootprintEntries: 1,
      });

      expect(report.fees.minResourceFee).toBe('31200');
      expect(report.fees.resourceFee).toBe('31200');
      expect(report.fees.baseFee).toBe('100');
      expect(report.fees.estimatedTotalFee).toBe('31300');
      expect(
        BigInt(report.fees.refundableFee) + BigInt(report.fees.nonRefundableFee)
      ).toBe(31200n);
      expect(report.refundableFee).toBe(report.fees.refundableFee);

      expect(report.resourceBounds).toEqual({
        cpuInstructions: applySafetyBuffer(185_420),
        memoryBytes: applySafetyBuffer(524_288),
        ledgerReadBytes: applySafetyBuffer(2048),
        ledgerWriteBytes: 0,
      });
    });

    test('accurately accounts for a stateful token_transfer reference contract with explicit refundableFee', async () => {
      const txDataXdr = buildSorobanTransactionDataXdr({
        instructions: 2_850_000,
        readBytes: 12_288,
        writeBytes: 3_072,
        resourceFee: '245000',
        readOnly: [
          makeContractCodeKey('sac-token-wasm'),
          makeContractDataKey('sac-token', 'METADATA'),
        ],
        readWrite: [
          makeContractDataKey('sac-token', 'BAL_ALICE'),
          makeContractDataKey('sac-token', 'BAL_BOB'),
        ],
      });

      const rpcResponse = {
        minResourceFee: '245000',
        refundableFee: '110000',
        cost: {
          cpuInsns: '2800000', // slightly lower than XDR instructions; XDR should be authoritative
          memBytes: '2097152',
        },
        transactionData: txDataXdr,
        events: [
          { type: 'contract', contractId: 'CTOKEN123', topic: ['transfer'] },
        ],
        latestLedger: 512400,
      };

      const report = await runSimulation('AAAA_TRANSFER_XDR', 'mainnet', {
        simulateFn: async () => rpcResponse,
      });

      expect(report.network).toBe('mainnet');
      expect(report.parsedTransactionData).toBe(true);
      // Authoritative CPU instructions come from SorobanTransactionData XDR
      expect(report.cpuInstructions).toBe(2_850_000);
      expect(report.memoryBytes).toBe(2_097_152);
      expect(report.ledgerReadBytes).toBe(12_288);
      expect(report.ledgerWriteBytes).toBe(3_072);
      expect(report.readCount).toBe(2);
      expect(report.writeCount).toBe(2);
      expect(report.resources.totalFootprintEntries).toBe(4);

      expect(report.fees).toEqual({
        baseFee: '100',
        minResourceFee: '245000',
        resourceFee: '245000',
        refundableFee: '110000',
        nonRefundableFee: '135000',
        restoreFee: '0',
        estimatedTotalFee: '245100',
      });
      expect(report.eventsCount).toBe(1);
    });

    test('parses restorePreamble and includes restoreFee in total fee estimate', () => {
      const mainTxDataXdr = buildSorobanTransactionDataXdr({
        instructions: 500_000,
        readBytes: 4096,
        writeBytes: 512,
        resourceFee: '60000',
        readOnly: [makeContractCodeKey('archived-contract')],
        readWrite: [makeContractDataKey('archived-contract', 'STATE')],
      });

      const restoreTxDataXdr = buildSorobanTransactionDataXdr({
        instructions: 0,
        readBytes: 2048,
        writeBytes: 2048,
        resourceFee: '40000',
        readOnly: [],
        readWrite: [makeContractDataKey('archived-contract', 'STATE')],
      });

      const report = buildSimulationReport(
        {
          minResourceFee: '60000',
          cost: { cpuInsns: '500000', memBytes: '1048576' },
          transactionData: mainTxDataXdr,
          restorePreamble: {
            minResourceFee: '40000',
            transactionData: restoreTxDataXdr,
          },
          latestLedger: 512500,
        },
        { network: 'testnet', fallback: false }
      );

      expect(report.restorePreamble).not.toBeNull();
      expect(report.restorePreamble.required).toBe(true);
      expect(report.restorePreamble.minResourceFee).toBe('40000');
      expect(report.restorePreamble.resources.footprint.readWriteCount).toBe(1);
      expect(report.fees.restoreFee).toBe('40000');
      expect(report.fees.estimatedTotalFee).toBe('100100');
      expect(report.diagnostics.some((d) => /RestoreFootprint/i.test(d))).toBe(
        true
      );
    });

    test('falls back gracefully when RPC call fails', async () => {
      const report = await runSimulation('AAAA_FALLBACK_XDR', 'testnet', {
        simulateFn: async () => {
          throw new Error('RPC unavailable');
        },
      });

      expect(report.fallback).toBe(true);
      expect(report.parsedTransactionData).toBe(false);
      expect(report.cpuInstructions).toBeGreaterThan(0);
      expect(report.memoryBytes).toBeGreaterThan(0);
      expect(BigInt(report.fees.minResourceFee)).toBeGreaterThan(0n);
    });

    test('normalizeResourceUsage handles RPC responses without transactionData using cost fields', () => {
      const usage = normalizeResourceUsage({
        cost: {
          cpuInsns: '91000',
          memBytes: '131072',
          ledgerReadBytes: '512',
          ledgerWriteBytes: '256',
        },
        readCount: '3',
        writeCount: '1',
      });

      expect(usage.cpuInstructions).toBe(91_000);
      expect(usage.memoryBytes).toBe(131_072);
      expect(usage.ledgerReadBytes).toBe(512);
      expect(usage.ledgerWriteBytes).toBe(256);
      expect(usage.readCount).toBe(3);
      expect(usage.writeCount).toBe(1);
    });

    test('parseRestorePreamble returns null when absent', () => {
      expect(parseRestorePreamble(null)).toBeNull();
      expect(parseRestorePreamble(undefined)).toBeNull();
    });
  });
});
