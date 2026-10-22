import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileQueued } from '../services/compileService.js';
import { sanitizeDependenciesInput } from '../routes/compile_utils.js';
import { runSimulation } from '../routes/v1/simulate.js';
import { deployContract } from '../services/deployService.js';
import authService from '../services/authService.js';
import { createProtoLoaderOptions } from './protoLoaderOptions.js';
import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageDefinition = protoLoader.loadSync(
  join(__dirname, 'soroban.proto'),
  createProtoLoaderOptions(__dirname)
);
const grpcPackage = grpc.loadPackageDefinition(packageDefinition);
const sorobanPackage = grpcPackage.soroban_playground;

export const sorobanServiceDefinition = sorobanPackage.SorobanService.service;

function grpcError(code, message) {
  return Object.assign(new Error(message), {
    code,
    grpcStatus: true,
  });
}

function metadataValue(metadata, key) {
  const value = metadata.get(key)[0];
  return typeof value === 'string' ? value : undefined;
}

export async function authenticateGrpcCall(call) {
  const authorization = metadataValue(call.metadata, 'authorization');
  const token = authorization?.startsWith('Bearer ')
    ? authorization.slice(7).trim()
    : undefined;

  if (!token) {
    throw grpcError(grpc.status.UNAUTHENTICATED, 'Authentication required');
  }

  try {
    return await authService.verifyAccessToken(token);
  } catch (error) {
    const invalidToken =
      ['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'].includes(
        error?.name
      ) ||
      /token (is blacklisted|family is blacklisted)|invalid token type/i.test(
        error?.message || ''
      );
    if (invalidToken) {
      throw grpcError(grpc.status.UNAUTHENTICATED, 'Invalid or expired token');
    }
    throw error;
  }
}

export function toGrpcError(error) {
  if (error?.grpcStatus) return error;

  const statusCode = Number(error?.statusCode);
  let code = grpc.status.INTERNAL;
  switch (statusCode) {
    case 400:
    case 422:
      code = grpc.status.INVALID_ARGUMENT;
      break;
    case 401:
      code = grpc.status.UNAUTHENTICATED;
      break;
    case 403:
      code = grpc.status.PERMISSION_DENIED;
      break;
    case 404:
      code = grpc.status.NOT_FOUND;
      break;
    case 408:
      code = grpc.status.DEADLINE_EXCEEDED;
      break;
    case 409:
      code = grpc.status.ABORTED;
      break;
    case 429:
      code = grpc.status.RESOURCE_EXHAUSTED;
      break;
    case 502:
    case 503:
      code = grpc.status.UNAVAILABLE;
      break;
    default:
      break;
  }

  return grpcError(code, error?.message || 'Internal server error');
}

async function compile(request) {
  const code = request.code || request.source || request.source_code;
  if (typeof code !== 'string' || !code.trim()) {
    throw grpcError(grpc.status.INVALID_ARGUMENT, 'No code provided');
  }

  const dependencyValidation = sanitizeDependenciesInput(
    request.dependencies || {}
  );
  if (!dependencyValidation.ok) {
    throw grpcError(grpc.status.INVALID_ARGUMENT, dependencyValidation.error);
  }

  const result = await compileQueued({
    requestId: `grpc-compile-${Date.now()}`,
    code,
    dependencies: dependencyValidation.deps,
    contractName: request.contract_name || 'soroban_contract',
  });

  return {
    success: Boolean(result.success),
    status: result.success ? 'success' : 'error',
    hash: result.hash || '',
    message: result.success
      ? result.cached
        ? 'Contract compiled from cache'
        : 'Contract compiled successfully'
      : result.logs?.join('\n') || 'Contract compilation failed',
    cached: Boolean(result.cached),
    duration_ms: String(result.durationMs || 0),
    logs: result.logs || [],
    artifact_name: result.artifact?.name || '',
    artifact_size_bytes: String(result.artifact?.sizeBytes || 0),
    artifact_path: result.artifact?.path || '',
  };
}

function resourceValues(values = {}) {
  return {
    cpu_instructions: String(values.cpuInstructions || 0),
    memory_bytes: String(values.memoryBytes || 0),
    ledger_read_bytes: String(values.ledgerReadBytes || 0),
    ledger_write_bytes: String(values.ledgerWriteBytes || 0),
  };
}

function simulationReport(report) {
  const resourceProfile = report.resourceProfile || {};
  const gasVisualizer = report.gasVisualizer || {};
  return {
    network: report.network || '',
    fallback: Boolean(report.fallback),
    min_resource_fee: String(report.minResourceFee || ''),
    estimated_total_fee: String(report.estimatedTotalFee || ''),
    cpu_instructions: String(report.cpuInstructions || 0),
    memory_bytes: String(report.memoryBytes || 0),
    ledger_read_bytes: String(report.ledgerReadBytes || 0),
    ledger_write_bytes: String(report.ledgerWriteBytes || 0),
    read_count: report.readCount || 0,
    write_count: report.writeCount || 0,
    resource_profile: {
      ...resourceValues(resourceProfile),
      read_count: resourceProfile.readCount || 0,
      write_count: resourceProfile.writeCount || 0,
      buffered: resourceValues(resourceProfile.buffered),
    },
    resource_bounds: resourceValues(report.resourceBounds),
    gas_visualizer: {
      event_count: gasVisualizer.eventCount || 0,
      diagnostic_event_count: gasVisualizer.diagnosticEventCount || 0,
      events: (gasVisualizer.events || []).map((event) => ({
        index: event.index || 0,
        type: event.type || '',
        contract_id: event.contractId || '',
        topics: event.topics || 0,
      })),
      budgets: resourceValues(gasVisualizer.budgets),
    },
    diagnostics: report.diagnostics || [],
    events_count: report.eventsCount || 0,
    latest_ledger: String(report.latestLedger || 0),
    has_latest_ledger: report.latestLedger !== null,
    transaction_data_json:
      report.transactionData === null || report.transactionData === undefined
        ? ''
        : JSON.stringify(report.transactionData),
    has_transaction_data:
      report.transactionData !== null &&
      report.transactionData !== undefined,
  };
}

function withTracing(method, fn) {
  return async (call, callback) => {
    const parentContext = propagation.extract(
      context.active(),
      call.metadata.getMap()
    );
    const tracer = trace.getTracer('soroban-playground.grpc');
    void tracer.startActiveSpan(
      `grpc.soroban.${method}`,
      {
        kind: SpanKind.SERVER,
        attributes: {
          'rpc.system': 'grpc',
          'rpc.service': 'soroban_playground.SorobanService',
          'rpc.method': method,
          'http.request_id':
            metadataValue(call.metadata, 'x-request-id') || '',
        },
      },
      parentContext,
      async (span) => {
        try {
          await authenticateGrpcCall(call);
          const response = await fn(call.request);
          span.setStatus({ code: SpanStatusCode.OK });
          callback(null, response);
        } catch (error) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error?.message || 'Internal server error',
          });
          span.recordException(error);
          callback(toGrpcError(error));
        } finally {
          span.end();
        }
      }
    );
  };
}

function compileStream(call) {
  let pending = Promise.resolve();
  let closed = false;
  let spanEnded = false;

  const parentContext = propagation.extract(
    context.active(),
    call.metadata.getMap()
  );
  const tracer = trace.getTracer('soroban-playground.grpc');
  const span = tracer.startSpan(
    'grpc.soroban.CompileStream',
    {
      kind: SpanKind.SERVER,
      attributes: {
        'rpc.system': 'grpc',
        'rpc.service': 'soroban_playground.SorobanService',
        'rpc.method': 'CompileStream',
        'http.request_id':
          metadataValue(call.metadata, 'x-request-id') || '',
      },
    },
    parentContext
  );
  const endSpan = () => {
    if (spanEnded) return;
    spanEnded = true;
    span.end();
  };

  context.with(trace.setSpan(parentContext, span), () => {
    authenticateGrpcCall(call)
      .then(() => {
        call.on('data', (request) => {
          pending = pending
            .then(async () => {
              if (closed) return;
              const response = await compile(request);
              if (!closed && !call.write(response)) {
                call.pause();
                call.once('drain', () => call.resume());
              }
            })
            .catch((error) => {
              closed = true;
              span.setStatus({
                code: SpanStatusCode.ERROR,
                message: error?.message || 'Internal server error',
              });
              call.destroy(toGrpcError(error));
            });
        });

        call.on('end', () => {
          void pending.then(() => {
            if (!closed) call.end();
            endSpan();
          });
        });
      })
      .catch((error) => {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error?.message || 'Authentication failed',
        });
        call.destroy(toGrpcError(error));
        endSpan();
      });
  });

  call.on('cancelled', () => {
    closed = true;
    endSpan();
  });
  call.on('error', () => {
    closed = true;
    endSpan();
  });
}

export function createSorobanServiceHandlers() {
  return {
    Compile: withTracing('Compile', compile),
    CompileStream: compileStream,
    Simulate: withTracing('Simulate', async (request) => {
      const transactionXdr =
        request.transaction_xdr || request.transaction;
      if (typeof transactionXdr !== 'string' || !transactionXdr.trim()) {
        throw grpcError(
          grpc.status.INVALID_ARGUMENT,
          'transaction_xdr is required'
        );
      }

      const report = await runSimulation(
        transactionXdr,
        request.network || 'testnet'
      );
      return {
        success: true,
        status: 'success',
        data: simulationReport(report),
      };
    }),
    Deploy: withTracing('Deploy', async (request) => {
      const { wasm_path, contract_name, source_account } = request;
      if (!wasm_path || !contract_name || !source_account) {
        throw grpcError(
          grpc.status.INVALID_ARGUMENT,
          'wasm_path, contract_name, and source_account are required'
        );
      }

      const network = request.network || 'testnet';
      let result;
      try {
        result = await deployContract({
          id: contract_name,
          contractName: contract_name,
          wasmPath: wasm_path,
          network,
          sourceAccount: source_account,
        });
      } catch (error) {
        throw grpcError(grpc.status.UNAVAILABLE, error.message);
      }
      const deployedAt = new Date().toISOString();

      return {
        success: true,
        status: 'success',
        contract_id: result.contractId,
        contract_name,
        network,
        wasm_path,
        deployed_at: deployedAt,
        message: `Contract "${contract_name}" deployed successfully to ${network}`,
      };
    }),
  };
}
