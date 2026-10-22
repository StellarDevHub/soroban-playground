// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT
//
// gRPC client for the Soroban Playground backend.
//
// Wraps the generated stub for IndexerService with retry logic, connection
// health-checking, and promise-based helpers.  The client is designed to be
// used by backend route handlers that need to communicate with the indexer
// microservice over gRPC.
//
// Usage:
//   import { GrpcClient } from './grpc/client.js';
//   const client = new GrpcClient({ host: 'localhost', port: 50051 });
//   const status = await client.getCompileStatus('job-123');

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { context, propagation } from '@opentelemetry/api';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROTO_PATH = join(__dirname, 'soroban_indexer.proto');

const packageDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const protoDescriptor = grpc.loadPackageDefinition(packageDef);
const { soroban_playground: proto } = /** @type {any} */ (protoDescriptor);

// ─── Retry helper ─────────────────────────────────────────────────────────────

/**
 * Wraps a unary gRPC call in exponential-backoff retry logic.
 *
 * @param {Function} fn           - () => Promise<T>
 * @param {number}   maxRetries
 * @param {number}   baseDelayMs
 * @returns {Promise<any>}
 */
async function withRetry(fn, maxRetries = 3, baseDelayMs = 200) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable =
        err.code === grpc.status.UNAVAILABLE ||
        err.code === grpc.status.DEADLINE_EXCEEDED;
      if (!retryable || attempt === maxRetries) throw err;
      await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** attempt));
    }
  }
  throw lastErr;
}

// ─── Client class ─────────────────────────────────────────────────────────────

export class GrpcClient {
  /**
   * @param {object} [opts]
   * @param {string} [opts.host]        - Indexer host (default: localhost)
   * @param {number} [opts.port]        - gRPC port (default: 50051)
   * @param {boolean}[opts.tls]         - Use TLS (default: false)
   * @param {number} [opts.deadlineMs]  - Per-call deadline in ms (default: 10000)
   * @param {number} [opts.maxRetries]  - Retry limit for transient errors
   * @param {string} [opts.authorizationToken] - Access token for authenticated RPCs
   */
  constructor(opts = {}) {
    const {
      host = process.env.GRPC_INDEXER_HOST ?? 'localhost',
      port = Number(process.env.GRPC_INDEXER_PORT ?? 50051),
      tls = false,
      deadlineMs = 10_000,
      maxRetries = 3,
      authorizationToken = process.env.GRPC_AUTH_TOKEN,
    } = opts;

    this._address = `${host}:${port}`;
    this._deadlineMs = deadlineMs;
    this._maxRetries = maxRetries;
    this._authorizationToken = authorizationToken;

    const credentials = tls
      ? grpc.credentials.createSsl()
      : grpc.credentials.createInsecure();

    // Channel options matching server config
    const channelOptions = {
      'grpc.keepalive_time_ms': 10_000,
      'grpc.keepalive_timeout_ms': 5_000,
      'grpc.keepalive_permit_without_calls': 1,
      'grpc.http2.max_pings_without_data': 0,
      'grpc.max_send_message_length': 64 * 1024 * 1024,
      'grpc.max_receive_message_length': 64 * 1024 * 1024,
    };

    this._stub = new proto.IndexerService(
      this._address,
      credentials,
      channelOptions
    );
  }

  // ── Deadline helper ─────────────────────────────────────────────────────────

  _deadline() {
    return new Date(Date.now() + this._deadlineMs);
  }

  _metadata() {
    const metadata = new grpc.Metadata();
    if (this._authorizationToken) {
      metadata.set(
        'authorization',
        ['Bearer', this._authorizationToken].join(' ')
      );
    }
    const traceHeaders = {};
    propagation.inject(context.active(), traceHeaders);
    for (const key of ['traceparent', 'tracestate']) {
      if (traceHeaders[key]) metadata.set(key, traceHeaders[key]);
    }
    return metadata;
  }

  // ── Unary wrappers ──────────────────────────────────────────────────────────

  /**
   * Poll the compilation status of a job.
   *
   * @param {string} jobId
   * @returns {Promise<{job_id: string, status: string, wasm_base64: string, error_log: string}>}
   */
  getCompileStatus(jobId) {
    return withRetry(
      () =>
        new Promise((resolve, reject) => {
          this._stub.GetCompileStatus(
            { job_id: jobId },
            this._metadata(),
            { deadline: this._deadline() },
            (err, response) => (err ? reject(err) : resolve(response))
          );
        }),
      this._maxRetries
    );
  }

  /**
   * Enqueue a WASM deployment on the indexer.
   *
   * @param {object} params
   * @param {string} params.jobId
   * @param {string} params.wasmBase64
   * @param {string} params.sourceKey
   * @param {string} params.network
   * @returns {Promise<{job_id: string, status: string, contract_id: string, tx_hash: string, error: string}>}
   */
  deploy({ jobId, wasmBase64, sourceKey, network }) {
    return withRetry(
      () =>
        new Promise((resolve, reject) => {
          this._stub.Deploy(
            {
              job_id: jobId,
              wasm_base64: wasmBase64,
              source_key: sourceKey,
              network,
            },
            this._metadata(),
            { deadline: this._deadline() },
            (err, response) => (err ? reject(err) : resolve(response))
          );
        }),
      this._maxRetries
    );
  }

  /**
   * Liveness probe.
   *
   * @returns {Promise<{status: string, version: string, uptime: number}>}
   */
  healthCheck() {
    return withRetry(
      () =>
        new Promise((resolve, reject) => {
          this._stub.HealthCheck(
            {},
            this._metadata(),
            { deadline: this._deadline() },
            (err, response) => (err ? reject(err) : resolve(response))
          );
        }),
      1 // only one retry for health checks
    );
  }

  // ── Server-streaming ────────────────────────────────────────────────────────

  /**
   * Subscribe to a live stream of contract events.
   *
   * Returns a Node.js Readable (gRPC ClientReadableStream).  The caller is
   * responsible for attaching 'data', 'error', and 'end' listeners.
   *
   * @param {object} [params]
   * @param {string} [params.contractId]  - Filter by contract (empty = all)
   * @param {number} [params.sinceTs]     - Only events after this timestamp
   * @returns {grpc.ClientReadableStream<any>}
   */
  streamEvents({ contractId = '', sinceTs = 0 } = {}) {
    return this._stub.StreamEvents(
      {
        contract_id: contractId,
        since_ts: sinceTs,
      },
      this._metadata()
    );
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  /**
   * Cleanly close the underlying channel.
   */
  close() {
    this._stub.close();
  }

  /**
   * Wait for the channel to be ready (useful in integration tests).
   *
   * @param {number} [timeoutMs]
   * @returns {Promise<void>}
   */
  waitForReady(timeoutMs = 5_000) {
    return new Promise((resolve, reject) => {
      this._stub.waitForReady(new Date(Date.now() + timeoutMs), (err) =>
        err ? reject(err) : resolve()
      );
    });
  }
}
