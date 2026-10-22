// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT
//
// gRPC server implementation for the Soroban Playground backend.
//
// Implements the IndexerService defined in soroban_indexer.proto:
//   • StreamEvents   — server-streaming live contract events
//   • GetCompileStatus — compilation job polling
//   • Deploy         — trigger WASM deployment
//   • HealthCheck    — liveness probe
//
// Usage (integrate with server.js):
//   import { startGrpcServer } from './grpc/server.js';
//   await startGrpcServer(compileJobStore, deployJobStore);

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { EventEmitter } from 'events';
import os from 'os';
import {
  authenticateGrpcCall,
  createSorobanServiceHandlers,
  sorobanServiceDefinition,
  toGrpcError,
} from './sorobanService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROTO_PATH = join(__dirname, 'soroban_indexer.proto');

// ─── Proto loading ────────────────────────────────────────────────────────────

const packageDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const protoDescriptor = grpc.loadPackageDefinition(packageDef);
const { soroban_playground: proto } = /** @type {any} */ (protoDescriptor);

// ─── In-process event bus ─────────────────────────────────────────────────────
//
// Other modules (compile pipeline, deploy pipeline, contract event indexer)
// emit events on this bus; the gRPC stream handler forwards them to connected
// gRPC clients.

export const grpcEventBus = new EventEmitter();
grpcEventBus.setMaxListeners(256);

const SERVER_START_TS = Date.now();

// ─── Service handlers ─────────────────────────────────────────────────────────

/**
 * StreamEvents — server-streaming RPC.
 *
 * Subscribes to the in-process event bus and forwards matching ContractEvents
 * to the calling client. The stream stays open until the client cancels or the
 * server shuts down.
 *
 * @param {grpc.ServerWritableStream<any, any>} call
 */
function streamEvents(call) {
  const { contract_id: filterContractId, since_ts: sinceTs = 0 } = call.request;

  /**
   * @param {object} event
   */
  function onEvent(event) {
    if (filterContractId && event.contract_id !== filterContractId) return;
    if (event.timestamp < sinceTs) return;

    call.write({ event });
  }

  grpcEventBus.on('contract_event', onEvent);

  call.on('cancelled', () => {
    grpcEventBus.off('contract_event', onEvent);
  });

  call.on('error', () => {
    grpcEventBus.off('contract_event', onEvent);
  });
}

/**
 * GetCompileStatus — unary RPC.
 *
 * @param {grpc.ServerUnaryCall<any, any>} call
 * @param {grpc.sendUnaryData<any>} callback
 * @param {Map<string, object>} compileJobStore
 */
function makeGetCompileStatus(compileJobStore) {
  return function getCompileStatus(call, callback) {
    const { job_id } = call.request;
    const job = compileJobStore.get(job_id);

    if (!job) {
      return callback({
        code: grpc.status.NOT_FOUND,
        message: `compile job ${job_id} not found`,
      });
    }

    callback(null, {
      job_id,
      status: job.status ?? 'pending',
      wasm_base64: job.wasmBase64 ?? '',
      error_log: job.errorLog ?? '',
    });
  };
}

/**
 * Deploy — unary RPC.
 *
 * @param {grpc.ServerUnaryCall<any, any>} call
 * @param {grpc.sendUnaryData<any>} callback
 * @param {Map<string, object>} deployJobStore
 */
function makeDeployHandler(deployJobStore) {
  return function deploy(call, callback) {
    const { job_id, wasm_base64, source_key, network } = call.request;

    if (!wasm_base64 || !source_key || !network) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: 'wasm_base64, source_key, and network are required',
      });
    }

    // Enqueue the deploy job — actual execution happens in the deploy pipeline.
    deployJobStore.set(job_id, {
      status: 'pending',
      wasmBase64: wasm_base64,
      sourceKey: source_key,
      network,
      contractId: '',
      txHash: '',
      error: '',
    });

    grpcEventBus.emit('deploy_job_enqueued', { job_id, network });

    callback(null, {
      job_id,
      contract_id: '',
      tx_hash: '',
      status: 'pending',
      error: '',
    });
  };
}

/**
 * HealthCheck — unary RPC.
 *
 * @param {grpc.ServerUnaryCall<any, any>} _call
 * @param {grpc.sendUnaryData<any>} callback
 */
function healthCheck(_call, callback) {
  callback(null, {
    status: 'ok',
    version: process.env.npm_package_version ?? '1.0.0',
    uptime: Math.floor((Date.now() - SERVER_START_TS) / 1000),
  });
}

function authenticatedUnary(handler) {
  return (call, callback) => {
    authenticateGrpcCall(call)
      .then(() => handler(call, callback))
      .catch((error) => callback(toGrpcError(error)));
  };
}

function authenticatedStream(handler) {
  return (call) => {
    authenticateGrpcCall(call)
      .then(() => handler(call))
      .catch((error) => call.destroy(toGrpcError(error)));
  };
}

// ─── Server factory ───────────────────────────────────────────────────────────

/**
 * Creates and starts the gRPC server.
 *
 * @param {Map<string, object>} compileJobStore - Shared compile-job state map
 * @param {Map<string, object>} deployJobStore  - Shared deploy-job state map
 * @param {object}              [opts]
 * @param {string}              [opts.host]     - Bind address (default: 0.0.0.0)
 * @param {number}              [opts.port]     - Port (default: 50051)
 * @param {boolean}             [opts.tls]      - Enable TLS (default: false)
 * @param {Buffer}              [opts.certChain]
 * @param {Buffer}              [opts.privateKey]
 * @returns {Promise<grpc.Server>}
 */
export async function startGrpcServer(
  compileJobStore = new Map(),
  deployJobStore = new Map(),
  opts = {}
) {
  const {
    host = '0.0.0.0',
    port = 50051,
    tls = false,
    certChain,
    privateKey,
  } = opts;

  const server = new grpc.Server({
    'grpc.max_send_message_length': 64 * 1024 * 1024, // 64 MB
    'grpc.max_receive_message_length': 64 * 1024 * 1024,
    'grpc.keepalive_time_ms': 10_000,
    'grpc.keepalive_timeout_ms': 5_000,
    'grpc.keepalive_permit_without_calls': 1,
    'grpc.http2.max_pings_without_data': 0,
  });

  server.addService(proto.IndexerService.service, {
    StreamEvents: authenticatedStream(streamEvents),
    GetCompileStatus: authenticatedUnary(
      makeGetCompileStatus(compileJobStore)
    ),
    Deploy: authenticatedUnary(makeDeployHandler(deployJobStore)),
    HealthCheck: healthCheck,
  });
  server.addService(sorobanServiceDefinition, createSorobanServiceHandlers());

  const credentials = tls
    ? grpc.ServerCredentials.createSsl(null, [
        { cert_chain: certChain, private_key: privateKey },
      ])
    : grpc.ServerCredentials.createInsecure();

  await new Promise((resolve, reject) => {
    server.bindAsync(`${host}:${port}`, credentials, (err, boundPort) => {
      if (err) return reject(err);
      console.log(`[gRPC] IndexerService listening on ${host}:${boundPort}`);
      resolve(boundPort);
    });
  });

  return server;
}

// ─── Graceful shutdown helper ─────────────────────────────────────────────────

/**
 * Gracefully drains and shuts down a running gRPC server.
 *
 * @param {grpc.Server} server
 * @param {number} [timeoutMs=5000]
 */
export function shutdownGrpcServer(server, timeoutMs = 5_000) {
  return new Promise((resolve) => {
    server.tryShutdown((err) => {
      if (err) {
        console.error(
          '[gRPC] Forced shutdown after drain timeout:',
          err.message
        );
        server.forceShutdown();
      }
      resolve();
    });

    setTimeout(() => {
      console.warn('[gRPC] Drain timeout reached — forcing shutdown.');
      server.forceShutdown();
      resolve();
    }, timeoutMs).unref();
  });
}
