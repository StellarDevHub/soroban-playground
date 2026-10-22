import express from 'express';
import {
  asyncHandler,
  createHttpError,
} from '../../middleware/errorHandler.js';
import sorobanRpcManager from '../../services/sorobanRpcManager.js';
import { rateLimitMiddleware } from '../../middleware/rateLimiter.js';

const router = express.Router();

// +15% safety buffer applied to resource bounds so submissions are not rejected
// for underestimating CPU / memory / storage requirements.
const SAFETY_BUFFER = 1.15;

function applySafetyBuffer(value) {
  return Math.ceil(value * SAFETY_BUFFER);
}

function parseSimulationDiagnostics(rpcResult) {
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

  return diagnostics;
}

function estimateFallback(xdr) {
  const xdrLength = xdr.length;
  return {
    minResourceFee: String(1_000 + Math.ceil(xdrLength * 1.5)),
    cost: {
      cpuInsns: String(Math.min(10_000_000, 150_000 + xdrLength * 120)),
      memBytes: String(Math.min(5_000_000, 65_536 + xdrLength * 32)),
    },
    results: [{ auth: [], xdr }],
    events: [],
    latestLedger: 100000,
  };
}

async function callSimulateTransaction(xdr) {
  return await sorobanRpcManager.executeRpcCall(
    async (rpcUrl, options = {}) => {
      const { signal, ...extraHeaders } = options;

      const payload = {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'simulateTransaction',
        params: { transaction: xdr },
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

function normalizeResourceUsage(rpcResult) {
  const cost = rpcResult.cost || {};
  const cpuInstructions = parseInt(cost.cpuInsns || '150000', 10);
  const memoryBytes = parseInt(cost.memBytes || '65536', 10);

  // Soroban RPC reports ledger read/write bytes as discrete fields on the
  // simulation result when available; fall back to deriving from cost.
  const ledgerReadBytes = parseInt(
    rpcResult.ledgerReadBytes || cost.ledgerReadBytes || '1024',
    10
  );
  const ledgerWriteBytes = parseInt(
    rpcResult.ledgerWriteBytes || cost.ledgeWriteBytes || '512',
    10
  );

  // Read/write entry counts are derived from the simulation result when
  // present, otherwise defaulted to the minimum ledger entry footprint.
  const readCount = parseInt(rpcResult.readCount || '2', 10);
  const writeCount = parseInt(rpcResult.writeCount || '1', 10);

  return {
    cpuInstructions,
    memoryBytes,
    ledgerReadBytes,
    ledgerWriteBytes,
    readCount,
    writeCount,
  };
}

function buildResourceProfile(usage) {
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

function buildGasVisualizer(rpcResult, usage) {
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

function buildSimulationReport(rpcResult, { network, fallback }) {
  const usage = normalizeResourceUsage(rpcResult);
  const minResourceFee = String(
    rpcResult.minResourceFee || rpcResult.minFee || '1000'
  );
  const baseFee = 100;
  const estimatedTotalFee = String(parseInt(minResourceFee, 10) + baseFee);

  return {
    network,
    fallback: Boolean(fallback),
    minResourceFee,
    estimatedTotalFee,
    cpuInstructions: usage.cpuInstructions,
    memoryBytes: usage.memoryBytes,
    ledgerReadBytes: usage.ledgerReadBytes,
    ledgerWriteBytes: usage.ledgerWriteBytes,
    readCount: usage.readCount,
    writeCount: usage.writeCount,
    resourceProfile: buildResourceProfile(usage),
    resourceBounds: buildResourceProfile(usage).buffered,
    gasVisualizer: buildGasVisualizer(rpcResult, usage),
    diagnostics: parseSimulationDiagnostics(rpcResult),
    transactionData: rpcResult.transactionData || null,
    eventsCount: Array.isArray(rpcResult.events) ? rpcResult.events.length : 0,
    latestLedger: rpcResult.latestLedger || null,
  };
}

export async function runSimulation(xdrToSimulate, network) {
  let rpcResult;
  let fallback = false;
  try {
    rpcResult = await callSimulateTransaction(xdrToSimulate);
  } catch {
    rpcResult = estimateFallback(xdrToSimulate);
    fallback = true;
  }
  return buildSimulationReport(rpcResult, { network, fallback });
}

function extractXdr() {
  return (args) => {
    const { transactionXdr, transaction } = args || {};
    return transactionXdr || transaction;
  };
}

router.post(
  '/fee',
  rateLimitMiddleware('read'),
  asyncHandler(async (req, res, next) => {
    const { transactionXdr, transaction, network = 'testnet' } = req.body || {};
    const xdrToSimulate = transactionXdr || transaction;

    if (!xdrToSimulate || typeof xdrToSimulate !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'transactionXdr or transaction (base64 string) is required',
      });
    }

    try {
      const report = await runSimulation(xdrToSimulate, network);
      return res.json({
        success: true,
        status: 'success',
        data: report,
      });
    } catch (error) {
      return next(
        createHttpError(500, 'Fee simulation failed', {
          details: error.message,
        })
      );
    }
  })
);

// Pre-flight simulation endpoint - returns the full resource profile,
// gas visualizer breakdown and diagnostics for a transaction.
router.post(
  '/pre-flight',
  rateLimitMiddleware('read'),
  asyncHandler(async (req, res, next) => {
    const { transactionXdr, transaction, network = 'testnet' } = req.body || {};
    const xdrToSimulate = transactionXdr || transaction;

    if (!xdrToSimulate || typeof xdrToSimulate !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'transactionXdr or transaction (base64 string) is required',
      });
    }

    try {
      const report = await runSimulation(xdrToSimulate, network);
      return res.json({
        success: true,
        status: 'success',
        data: report,
      });
    } catch (error) {
      return next(
        createHttpError(500, 'Pre-flight simulation failed', {
          details: error.message,
        })
      );
    }
  })
);

export default router;
