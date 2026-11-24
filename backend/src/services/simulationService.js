import { xdr } from '@stellar/stellar-sdk';
import sorobanRpcManager from './sorobanRpcManager.js';

// +15% safety buffer applied to resource bounds so submissions are not rejected
// for underestimating CPU / memory / storage requirements.
export const SAFETY_BUFFER = 1.15;

// Standard Stellar base inclusion fee per operation in stroops.
export const DEFAULT_BASE_FEE = 100;

// Approximate Soroban protocol fee rates used to decompose minResourceFee into
// refundable (events, return value, rent/storage) vs non-refundable (CPU & I/O)
// components when the RPC response does not return an explicit refundableFee.
const FEE_PER_10K_INSTRUCTIONS = 25;
const FEE_PER_1KB_READ = 6250;
const FEE_PER_1KB_WRITE = 11800;

export function applySafetyBuffer(value) {
  return Math.ceil(value * SAFETY_BUFFER);
}

function parseNonNegativeInt(value, fallback = 0) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function readField(obj, name) {
  if (!obj) return undefined;
  const value = obj[name];
  return typeof value === 'function' ? value.call(obj) : value;
}

function summarizeLedgerKey(ledgerKey) {
  try {
    const sw =
      typeof ledgerKey.switch === 'function'
        ? ledgerKey.switch()
        : ledgerKey.switch;
    const arm =
      typeof ledgerKey.arm === 'function' ? ledgerKey.arm() : ledgerKey.arm;
    const rawType =
      typeof sw === 'string'
        ? sw
        : sw?.name || arm || ledgerKey.type || 'unknown';
    const type = typeof rawType === 'string' ? rawType : String(rawType);
    const key =
      typeof ledgerKey.toXDR === 'function'
        ? ledgerKey.toXDR('base64')
        : String(ledgerKey);
    return { type, key };
  } catch {
    return { type: 'unknown', key: '' };
  }
}

/**
 * Parses a base64-encoded XDR SorobanTransactionData payload returned by
 * Soroban RPC's `simulateTransaction` method.
 *
 * Supports both Protocol 22 (`readBytes`) and Protocol 23 (`diskReadBytes`)
 * SorobanResources XDR layouts, as well as both property-based (SDK v17+)
 * and method-based XDR accessors.
 *
 * @param {string|null|undefined} transactionDataXdr
 * @returns {object|null}
 */
export function parseSorobanTransactionData(transactionDataXdr) {
  if (!transactionDataXdr || typeof transactionDataXdr !== 'string') {
    return null;
  }

  try {
    const txData = xdr.SorobanTransactionData.fromXDR(
      transactionDataXdr,
      'base64'
    );
    const resources = readField(txData, 'resources');
    const footprint = readField(resources, 'footprint');

    const readOnlyEntries = readField(footprint, 'readOnly') || [];
    const readWriteEntries = readField(footprint, 'readWrite') || [];

    const cpuInstructions = Number(readField(resources, 'instructions') || 0);
    const rawReadBytes =
      readField(resources, 'diskReadBytes') ??
      readField(resources, 'readBytes') ??
      0;
    const ledgerReadBytes = Number(rawReadBytes);
    const ledgerWriteBytes = Number(readField(resources, 'writeBytes') || 0);
    const rawResourceFee = readField(txData, 'resourceFee');
    const resourceFee =
      rawResourceFee !== undefined && rawResourceFee !== null
        ? rawResourceFee.toString()
        : '0';

    let archivedEntriesCount = 0;
    const ext = readField(txData, 'ext');
    const extSwitch = readField(ext, 'switch');
    if (extSwitch === 1) {
      const resourceExt = readField(ext, 'resourceExt');
      const archived = readField(resourceExt, 'archivedSorobanEntries');
      if (Array.isArray(archived)) {
        archivedEntriesCount = archived.length;
      }
    }

    return {
      cpuInstructions,
      ledgerReadBytes,
      ledgerWriteBytes,
      resourceFee,
      footprint: {
        readOnlyCount: readOnlyEntries.length,
        readWriteCount: readWriteEntries.length,
        totalEntries: readOnlyEntries.length + readWriteEntries.length,
        readOnly: readOnlyEntries.map(summarizeLedgerKey),
        readWrite: readWriteEntries.map(summarizeLedgerKey),
      },
      archivedEntriesCount,
    };
  } catch {
    return null;
  }
}

/**
 * Parses the optional `restorePreamble` returned by `simulateTransaction`
 * when archived contract state must be restored before invocation.
 *
 * @param {object|null|undefined} restorePreamble
 * @returns {object|null}
 */
export function parseRestorePreamble(restorePreamble) {
  if (!restorePreamble || typeof restorePreamble !== 'object') {
    return null;
  }

  const parsedResources = parseSorobanTransactionData(
    restorePreamble.transactionData
  );
  const minResourceFee = String(
    restorePreamble.minResourceFee || parsedResources?.resourceFee || '0'
  );

  return {
    required: true,
    minResourceFee,
    transactionData: restorePreamble.transactionData || null,
    resources: parsedResources,
  };
}

export function parseSimulationDiagnostics(rpcResult) {
  const diagnostics = [];

  if (rpcResult.error) {
    const code = rpcResult.error.code;
    if (
      code === 'ERR_UNDERSIZED_RESOURCE_FEE' ||
      (code === '-32010' && /resource/.test(rpcResult.error.message || ''))
    ) {
      diagnostics.push(
        'Transaction was rejected because the declared resource fee is too low. Increase the fee before re-submitting.'
      );
    } else if (
      /thost function|CPU|insufficient.*instruction|overflow/i.test(
        rpcResult.error.message || ''
      )
    ) {
      diagnostics.push(
        'The contract exceeded its CPU/resource budget during simulation. Reduce work per call or raise the resource bounds.'
      );
    }
  }

  const results = rpcResult.results || [];
  for (const result of results) {
    if (result.error) {
      const message = result.error.message || 'unknown error';
      if (/UnauthorizedError|Not authorized|auth/i.test(message)) {
        diagnostics.push(
          `Auth failed: the transaction requires authorization for: ${message}. Sign with the correct wallet before submitting.`
        );
      } else if (/VM|invalid|wasm|contract invoke/i.test(message)) {
        diagnostics.push(
          `Contract invocation error: ${message}. Verify the contract ID, arguments, and that the contract is deployed.`
        );
      } else {
        diagnostics.push(`Simulation error: ${message}`);
      }
    }
  }

  if (rpcResult.restorePreamble) {
    diagnostics.push(
      'Contract state includes archived ledger entries that require a RestoreFootprint transaction prior to submission.'
    );
  }

  return diagnostics;
}

export function estimateFallback(xdrString) {
  const xdrLength = xdrString.length;
  return {
    minResourceFee: String(1_000 + Math.ceil(xdrLength * 1.5)),
    cost: {
      cpuInsns: String(Math.min(10_000_000, 150_000 + xdrLength * 120)),
      memBytes: String(Math.min(5_000_000, 65_536 + xdrLength * 32)),
    },
    results: [{ auth: [], xdr: xdrString }],
    events: [],
    latestLedger: 100000,
  };
}

export async function callSimulateTransaction(xdrString) {
  return await sorobanRpcManager.executeRpcCall(
    async (rpcUrl, options = {}) => {
      const { signal, ...extraHeaders } = options;

      const payload = {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'simulateTransaction',
        params: { transaction: xdrString },
      };

      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...extraHeaders,
        },
        body: JSON.stringify(payload),
        signal,
      });

      if (!response.ok) {
        throw new Error(`RPC server returned status ${response.status}`);
      }

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error.message || 'Soroban RPC simulation error');
      }

      return data.result || {};
    }
  );
}

/**
 * Extracts normalized CPU, RAM, ledger I/O, and storage footprint metrics
 * from both parsed SorobanTransactionData XDR and RPC response fields.
 */
export function normalizeResourceUsage(rpcResult, parsedTxData = null) {
  const cost = rpcResult.cost || {};
  const txData =
    parsedTxData !== null
      ? parsedTxData
      : parseSorobanTransactionData(rpcResult.transactionData);

  const cpuInstructions =
    txData !== null
      ? txData.cpuInstructions
      : parseNonNegativeInt(cost.cpuInsns, 0);

  const memoryBytes = parseNonNegativeInt(
    cost.memBytes ?? rpcResult.memoryBytes,
    0
  );

  const ledgerReadBytes =
    txData !== null
      ? txData.ledgerReadBytes
      : parseNonNegativeInt(
          rpcResult.ledgerReadBytes ?? cost.ledgerReadBytes,
          0
        );

  const ledgerWriteBytes =
    txData !== null
      ? txData.ledgerWriteBytes
      : parseNonNegativeInt(
          rpcResult.ledgerWriteBytes ?? cost.ledgerWriteBytes,
          0
        );

  const readCount =
    txData !== null
      ? txData.footprint.readOnlyCount
      : parseNonNegativeInt(rpcResult.readCount, 0);

  const writeCount =
    txData !== null
      ? txData.footprint.readWriteCount
      : parseNonNegativeInt(rpcResult.writeCount, 0);

  const footprint = txData
    ? txData.footprint
    : {
        readOnlyCount: readCount,
        readWriteCount: writeCount,
        totalEntries: readCount + writeCount,
        readOnly: [],
        readWrite: [],
      };

  return {
    cpuInstructions,
    memoryBytes,
    ledgerReadBytes,
    ledgerWriteBytes,
    readCount,
    writeCount,
    footprint,
    archivedEntriesCount: txData ? txData.archivedEntriesCount : 0,
  };
}

/**
 * Computes structured fee breakdown including minimum required refundable fee,
 * non-refundable compute/IO fee, base inclusion fee, and optional restore fee.
 */
export function buildFeeBreakdown(
  rpcResult,
  parsedTxData,
  usage,
  restorePreamble
) {
  const minResourceFeeStr = String(
    rpcResult.minResourceFee ??
      parsedTxData?.resourceFee ??
      rpcResult.minFee ??
      '0'
  );
  const resourceFeeStr = String(parsedTxData?.resourceFee ?? minResourceFeeStr);

  const minResourceFeeBig = BigInt(parseNonNegativeInt(minResourceFeeStr, 0));
  const baseFeeBig = BigInt(
    parseNonNegativeInt(rpcResult.baseFee, DEFAULT_BASE_FEE)
  );
  const restoreFeeBig = BigInt(
    parseNonNegativeInt(restorePreamble?.minResourceFee, 0)
  );

  let refundableFeeBig;
  if (
    rpcResult.refundableFee !== undefined &&
    rpcResult.refundableFee !== null
  ) {
    refundableFeeBig = BigInt(parseNonNegativeInt(rpcResult.refundableFee, 0));
    if (refundableFeeBig > minResourceFeeBig) {
      refundableFeeBig = minResourceFeeBig;
    }
  } else {
    const estimatedComputeAndIoFee = BigInt(
      Math.ceil((usage.cpuInstructions / 10_000) * FEE_PER_10K_INSTRUCTIONS) +
        Math.ceil((usage.ledgerReadBytes / 1024) * FEE_PER_1KB_READ) +
        Math.ceil((usage.ledgerWriteBytes / 1024) * FEE_PER_1KB_WRITE)
    );
    refundableFeeBig =
      minResourceFeeBig > estimatedComputeAndIoFee
        ? minResourceFeeBig - estimatedComputeAndIoFee
        : 0n;
  }

  const nonRefundableFeeBig = minResourceFeeBig - refundableFeeBig;
  const estimatedTotalFeeBig = minResourceFeeBig + baseFeeBig + restoreFeeBig;

  return {
    baseFee: baseFeeBig.toString(),
    minResourceFee: minResourceFeeBig.toString(),
    resourceFee: resourceFeeStr,
    refundableFee: refundableFeeBig.toString(),
    nonRefundableFee: nonRefundableFeeBig.toString(),
    restoreFee: restoreFeeBig.toString(),
    estimatedTotalFee: estimatedTotalFeeBig.toString(),
  };
}

export function buildResourceProfile(usage) {
  const {
    cpuInstructions,
    memoryBytes,
    ledgerReadBytes,
    ledgerWriteBytes,
    readCount,
    writeCount,
  } = usage;

  return {
    cpuInstructions,
    memoryBytes,
    ledgerReadBytes,
    ledgerWriteBytes,
    readCount,
    writeCount,
    buffered: {
      cpuInstructions: applySafetyBuffer(cpuInstructions),
      memoryBytes: applySafetyBuffer(memoryBytes),
      ledgerReadBytes: applySafetyBuffer(ledgerReadBytes),
      ledgerWriteBytes: applySafetyBuffer(ledgerWriteBytes),
    },
  };
}

export function buildGasVisualizer(rpcResult, usage) {
  const events = Array.isArray(rpcResult.events) ? rpcResult.events : [];
  const diagnosticEvents = Array.isArray(rpcResult.diagnosticEvents)
    ? rpcResult.diagnosticEvents
    : [];

  const cpuBudget = Math.max(usage.cpuInstructions, 1);
  const memBudget = Math.max(usage.memoryBytes, 1);

  return {
    eventCount: events.length,
    diagnosticEventCount: diagnosticEvents.length,
    events: events.map((event, index) => ({
      index,
      type: event.type || 'contract',
      contractId: event.contractId || null,
      topics: Array.isArray(event.topic) ? event.topic.length : 0,
    })),
    budgets: {
      cpuInstructions: cpuBudget,
      memoryBytes: memBudget,
    },
  };
}

export function buildSimulationReport(rpcResult, { network, fallback }) {
  const parsedTxData = parseSorobanTransactionData(rpcResult.transactionData);
  const restorePreamble = parseRestorePreamble(rpcResult.restorePreamble);
  const usage = normalizeResourceUsage(rpcResult, parsedTxData);
  const fees = buildFeeBreakdown(
    rpcResult,
    parsedTxData,
    usage,
    restorePreamble
  );
  const resourceProfile = buildResourceProfile(usage);

  return {
    network,
    fallback: Boolean(fallback),
    parsedTransactionData: parsedTxData !== null,
    minResourceFee: fees.minResourceFee,
    refundableFee: fees.refundableFee,
    estimatedTotalFee: fees.estimatedTotalFee,
    cpuInstructions: usage.cpuInstructions,
    memoryBytes: usage.memoryBytes,
    ledgerReadBytes: usage.ledgerReadBytes,
    ledgerWriteBytes: usage.ledgerWriteBytes,
    readCount: usage.readCount,
    writeCount: usage.writeCount,
    resources: {
      cpuInstructions: usage.cpuInstructions,
      memoryBytes: usage.memoryBytes,
      ledgerReadBytes: usage.ledgerReadBytes,
      ledgerWriteBytes: usage.ledgerWriteBytes,
      readOnlyEntries: usage.footprint.readOnlyCount,
      readWriteEntries: usage.footprint.readWriteCount,
      totalFootprintEntries: usage.footprint.totalEntries,
      archivedEntriesCount: usage.archivedEntriesCount,
      footprint: usage.footprint,
    },
    fees,
    resourceProfile,
    resourceBounds: resourceProfile.buffered,
    gasVisualizer: buildGasVisualizer(rpcResult, usage),
    diagnostics: parseSimulationDiagnostics(rpcResult),
    restorePreamble,
    transactionData: rpcResult.transactionData || null,
    eventsCount: Array.isArray(rpcResult.events) ? rpcResult.events.length : 0,
    latestLedger: rpcResult.latestLedger || null,
  };
}

export async function runSimulation(
  xdrToSimulate,
  network,
  { simulateFn = callSimulateTransaction } = {}
) {
  let rpcResult;
  let fallback = false;
  try {
    rpcResult = await simulateFn(xdrToSimulate);
  } catch {
    rpcResult = estimateFallback(xdrToSimulate);
    fallback = true;
  }
  return buildSimulationReport(rpcResult, { network, fallback });
}
