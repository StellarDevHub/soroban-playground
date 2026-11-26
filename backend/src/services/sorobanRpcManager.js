import config from '../config/index.js';
import crypto from 'node:crypto';
import { createSpan, getTraceId } from '../utils/tracing.js';
import {
  sorobanRpcCallDuration,
  sorobanRpcCallsTotal,
} from '../routes/metrics.js';

const DEFAULT_FALLBACK_ENDPOINTS = [
  process.env.SOROBAN_RPC_URL ||
    config?.soroban?.rpcUrl ||
    'https://soroban-testnet.stellar.org',
  'https://rpc-futurenet.stellar.org',
  'https://stellar-community.org/rpc',
];

export const CIRCUIT_STATES = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
};

const RPC_TIMEOUT_MS = Number.parseInt(
  process.env.RPC_TIMEOUT_MS || '15000',
  10
);
const HEALTH_CHECK_INTERVAL_MS = Number.parseInt(
  process.env.RPC_HEALTH_CHECK_INTERVAL_MS || '10000',
  10
);

// Latency tracking: EMA (exponential moving average) smoothing factor.
// A value closer to 1 reacts quickly; closer to 0 smooths out spikes.
const LATENCY_EMA_ALPHA = 0.25;

// Bounded ring buffer size for recent RPC call records used by the
// interactive transaction call-graph / stack-trace canvas (FE-EPIC-19).
const RPC_CALL_HISTORY_LIMIT = Number.parseInt(
  process.env.RPC_CALL_HISTORY_LIMIT || '500',
  10
);

// ─── Endpoint selection heuristics ───────────────────────────────────────────

/**
 * Select the next endpoint using latency-weighted round-robin (#1575).
 *
 * Strategy:
 *   1. Skip OPEN (circuit-broken) endpoints.
 *   2. Among healthy endpoints prefer the one with the lowest p50 (EMA) latency.
 *   3. Fall back to pure round-robin if no latency data is available.
 */
function selectBestEndpoint(endpoints, preferredIndex) {
  const healthy = endpoints.filter((ep) => ep.state !== CIRCUIT_STATES.OPEN);
  if (healthy.length === 0) return null;

  // If none have latency data yet, fall back to the simple round-robin candidate
  const withData = healthy.filter((ep) => ep.latencyEmaMs !== null);
  if (withData.length === 0) {
    // Return the next healthy endpoint in round-robin order
    for (let i = 0; i < endpoints.length; i++) {
      const idx = (preferredIndex + i) % endpoints.length;
      if (endpoints[idx].state !== CIRCUIT_STATES.OPEN) return endpoints[idx];
    }
    return healthy[0];
  }

  // Pick the endpoint with the lowest EMA latency
  return withData.reduce((best, ep) =>
    ep.latencyEmaMs < best.latencyEmaMs ? ep : best
  );
}

/**
 * Update the exponential moving average (EMA) for a given endpoint's latency.
 */
function updateLatencyEma(ep, observedMs) {
  if (ep.latencyEmaMs === null) {
    ep.latencyEmaMs = observedMs;
  } else {
    ep.latencyEmaMs =
      LATENCY_EMA_ALPHA * observedMs +
      (1 - LATENCY_EMA_ALPHA) * ep.latencyEmaMs;
  }
  ep.latencySamples += 1;
  ep.lastLatencyMs = observedMs;
}

// ─────────────────────────────────────────────────────────────────────────────

export class SorobanRpcManager {
  constructor() {
    const configured = [
      [
        'Public RPC',
        process.env.SOROBAN_RPC_PUBLIC_URL || process.env.SOROBAN_RPC_URL,
      ],
      ['QuickNode', process.env.QUICKNODE_RPC_URL],
      ['Blockdaemon', process.env.BLOCKDAEMON_RPC_URL],
      ...(process.env.SOROBAN_RPC_FALLBACK_URLS
        ? process.env.SOROBAN_RPC_FALLBACK_URLS.split(',').map((url) => [
            null,
            url.trim(),
          ])
        : []),
    ].filter(([, url]) => Boolean(url));

    const rawEndpoints =
      configured.length > 0
        ? configured
        : DEFAULT_FALLBACK_ENDPOINTS.map((url) => [null, url]);

    this.endpoints = Array.from(
      new Map(
        rawEndpoints.map(([name, url]) => [
          url.trim(),
          name || url.trim().replace(/^https?:\/\//, ''),
        ])
      )
    ).map(([url, name]) => ({
      url,
      name,
      state: CIRCUIT_STATES.CLOSED,
      failCount: 0,
      lastFailureTime: null,
      isHealthy: true,
      latencyEmaMs: null,
      latencySamples: 0,
      lastLatencyMs: null,
      lastHealthyAt: null,
      latestLedger: null,
      rateLimitedUntil: null,
      backoffAttempt: 0,
    }));

    this.failureThreshold = Number.parseInt(
      process.env.RPC_FAILURE_THRESHOLD || '3',
      10
    );
    this.resetTimeoutMs = Number.parseInt(
      process.env.RPC_RESET_TIMEOUT_MS || '30000',
      10
    );
    this.maxLedgerLag = Number.parseInt(
      process.env.RPC_MAX_LEDGER_LAG || '50',
      10
    );
    this.activeEndpointIndex = 0;
    this.healthTimer = null;
    // Running totals for aggregate metrics
    this._totalRequests = 0;
    this._totalFailures = 0;

    // Bounded history of RPC call frames for the interactive call-graph
    // canvas (FE-EPIC-19). Each entry is a normalized "frame" describing
    // a single RPC invocation, its parent, gas/ledger metadata, and error.
    this._callHistory = [];
    this._callHistoryLimit = RPC_CALL_HISTORY_LIMIT;

    if (process.env.NODE_ENV !== 'test') this.startHealthChecks();
  }

  get activeEndpoint() {
    return this.endpoints[this.activeEndpointIndex] || this.endpoints[0];
  }

  checkCircuitStates() {
    const now = Date.now();
    for (const ep of this.endpoints) {
      if (
        ep.rateLimitedUntil &&
        now >= ep.rateLimitedUntil &&
        ep.state === CIRCUIT_STATES.OPEN
      ) {
        ep.rateLimitedUntil = null;
        ep.state = CIRCUIT_STATES.HALF_OPEN;
        ep.isHealthy = false;
      }
      if (
        ep.state === CIRCUIT_STATES.OPEN &&
        ep.lastFailureTime &&
        now - ep.lastFailureTime > this.resetTimeoutMs
      ) {
        ep.state = CIRCUIT_STATES.HALF_OPEN;
      }
    }
  }

  /**
   * Record a single RPC call frame into the bounded call history.
   * Frames are consumed by the frontend call-graph canvas to render
   * hierarchical execution flows and pinpoint error causes.
   */
  _recordCallFrame(frame) {
    if (!frame || typeof frame !== 'object') return;
    this._callHistory.push(frame);
    if (this._callHistory.length > this._callHistoryLimit) {
      this._callHistory.splice(
        0,
        this._callHistory.length - this._callHistoryLimit
      );
    }
  }

  /**
   * Build a normalized call frame from an RPC invocation result/error.
   * Extracts Soroban-specific metadata (ledger, gas, contract id, method)
   * when present so the canvas can render gas consumption per frame.
   */
  _buildCallFrame({
    id,
    parentId,
    endpoint,
    method,
    status,
    durationMs,
    error,
    result,
    traceId,
  }) {
    const meta =
      (result && result.meta) || (result && result.diagnosticEvents) || {};
    const contractId =
      meta.contractId ||
      (result && result.contractId) ||
      (result && result.resultMeta && result.resultMeta.contractId) ||
      null;
    const gasUsed =
      (meta && typeof meta.gasUsed === 'number' && meta.gasUsed) ||
      (result && typeof result.gasUsed === 'number' && result.gasUsed) ||
      (result && result.cost && typeof result.cost.cpuInsns === 'number'
        ? result.cost.cpuInsns
        : null);
    const ledger =
      (result && result.latestLedger) ||
      (result && result.ledger) ||
      (meta && meta.ledger) ||
      null;

    return {
      id,
      parentId: parentId || null,
      endpoint,
      method: method || 'unknown',
      status,
      durationMs,
      contractId,
      gasUsed,
      ledger,
      traceId: traceId || null,
      error: error
        ? {
            message: error.message || String(error),
            name: error.name || 'Error',
            code: error.code || null,
          }
        : null,
      timestamp: Date.now(),
    };
  }

  /**
   * Return a snapshot of the recorded call frames for the call-graph canvas.
   * Optionally filter by traceId to isolate a single transaction's flow.
   */
  getCallGraph(traceId) {
    const frames = traceId
      ? this._callHistory.filter((f) => f.traceId === traceId)
      : this._callHistory.slice();
    return {
      traceId: traceId || null,
      frameCount: frames.length,
      frames,
    };
  }

  clearCallGraph() {
    this._callHistory = [];
  }

  tripCircuitBreaker(ep) {
    ep.state = CIRCUIT_STATES.OPEN;
    ep.isHealthy = false;
    console.warn(
      `[RPC Circuit Breaker] Tripped OPEN for endpoint ${ep.url} (failures: ${ep.failCount})`
    );
  }

  async checkEndpointHealth(ep) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
    const start = Date.now();
    try {
      const url = new URL(ep.url);
      url.pathname =
        url.pathname.replace(/\/(?:soroban\/)?rpc\/?$/, '').replace(/\/$/, '') +
        '/health';
      const healthResponse = await fetch(url.toString(), {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });

      if (healthResponse.status === 429) {
        const error = new Error('HTTP 429 Too Many Requests');
        error.status = 429;
        throw error;
      }
      if (!healthResponse.ok) {
        throw new Error(`HTTP ${healthResponse.status}`);
      }

      const request = (method) =>
        fetch(ep.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method,
            params: [],
          }),
          signal: controller.signal,
        }).then(async (response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const payload = await response.json();
          if (payload.error)
            throw new Error(payload.error.message || `${method} failed`);
          return payload.result;
        });

      const [health, latestLedger] = await Promise.all([
        request('getHealth'),
        request('getLatestLedger'),
      ]);
      if (health?.status && health.status !== 'healthy') {
        throw new Error(`RPC health status: ${health.status}`);
      }

      // Update latency from the health-check round-trip
      const elapsed = Date.now() - start;
      updateLatencyEma(ep, elapsed);

      ep.isHealthy = true;
      ep.failCount = 0;
      ep.state = CIRCUIT_STATES.CLOSED;
      ep.lastHealthyAt = Date.now();
      ep.latestLedger = latestLedger?.sequence ?? latestLedger;
      return true;
    } catch (err) {
      ep.isHealthy = false;
      ep.lastFailureTime = Date.now();
      if (err?.status === 429) {
        ep.backoffAttempt = Math.min(ep.backoffAttempt + 1, 6);
        ep.rateLimitedUntil =
          Date.now() +
          Math.min(1000 * Math.pow(2, ep.backoffAttempt - 1), 60000);
        ep.state = CIRCUIT_STATES.OPEN;
      } else if (ep.state === CIRCUIT_STATES.CLOSED) {
        ep.state = CIRCUIT_STATES.OPEN;
      }
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  startHealthChecks() {
    if (this.healthTimer || this.endpoints.length === 0) return;
    const poll = async () => {
      await Promise.all(
        this.endpoints.map((endpoint) => this.checkEndpointHealth(endpoint))
      ).catch(() => {});
      const ledgers = this.endpoints
        .map((endpoint) => Number(endpoint.latestLedger))
        .filter((ledger) => Number.isFinite(ledger) && ledger > 0);
      if (ledgers.length === 0) return;
      const referenceLedger = Math.max(...ledgers);
      for (const endpoint of this.endpoints) {
        const ledger = Number(endpoint.latestLedger);
        if (
          endpoint.isHealthy &&
          ledger > 0 &&
          referenceLedger - ledger > this.maxLedgerLag
        ) {
          endpoint.isHealthy = false;
          endpoint.state = CIRCUIT_STATES.OPEN;
          endpoint.lastFailureTime = Date.now();
          console.warn(
            `[RPC Health] Evicted lagging endpoint ${endpoint.url}: ledger ${ledger}, reference ${referenceLedger}`
          );
        }
      }
    };
    poll();
    this.healthTimer = setInterval(poll, HEALTH_CHECK_INTERVAL_MS);
    this.healthTimer.unref?.();
  }

  stopHealthChecks() {
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = null;
  }

  async executeRpcCall(callFn) {
    this.checkCircuitStates();
    this._totalRequests += 1;

    const activeTraceId = getTraceId();
    const span = createSpan('soroban_rpc_call', {
      'rpc.system': 'soroban_rpc',
      'rpc.active_endpoint': this.activeEndpoint.url,
      'rpc.circuit_state': this.activeEndpoint.state,
    });

    const traceHeaders = activeTraceId
      ? {
          'x-trace-id': activeTraceId,
          traceparent: `00-${activeTraceId}-${span?.spanContext()?.spanId || '0000000000000000'}-01`,
        }
      : {};

    let lastError = null;

    // Use latency-weighted endpoint selection (#1575)
    const best = selectBestEndpoint(this.endpoints, this.activeEndpointIndex);
    const preferredIndex = best
      ? this.endpoints.indexOf(best)
      : this.activeEndpointIndex;

    for (let i = 0; i < this.endpoints.length; i++) {
      const idx = (preferredIndex + i) % this.endpoints.length;
      const ep = this.endpoints[idx];

      if (ep.state === CIRCUIT_STATES.OPEN) {
        continue;
      }
      if (ep.rateLimitedUntil && ep.rateLimitedUntil > Date.now()) {
        continue;
      }

      const callStartHr = process.hrtime();
      const callStart = Date.now();
      const frameId = crypto.randomUUID();
      const frameMethod = 'executeRpcCall';
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);

        try {
          const result = await callFn(ep.url, {
            ...traceHeaders,
            signal: controller.signal,
          });

          // Record latency on success
          const elapsed = Date.now() - callStart;
          updateLatencyEma(ep, elapsed);

          const [secs, nanos] = process.hrtime(callStartHr);
          const durationSec = secs + nanos / 1e9;
          try {
            sorobanRpcCallDuration?.observe?.(
              { endpoint: ep.url, status: 'success' },
              durationSec
            );
            sorobanRpcCallsTotal?.inc?.({
              endpoint: ep.url,
              status: 'success',
            });
          } catch (_) {}

          ep.failCount = 0;
          ep.backoffAttempt = 0;
          ep.rateLimitedUntil = null;
          ep.state = CIRCUIT_STATES.CLOSED;
          ep.isHealthy = true;
          this.activeEndpointIndex = idx;

          this._recordCallFrame(
            this._buildCallFrame({
              id: frameId,
              parentId: null,
              endpoint: ep.url,
              method: frameMethod,
              status: 'success',
              durationMs: elapsed,
              error: null,
              result,
              traceId: activeTraceId,
            })
          );

          span?.setStatus?.({ code: 1 });
          span?.end?.();
          return result;
        } finally {
          clearTimeout(timeout);
        }
      } catch (err) {
        lastError = err;
        const [secs, nanos] = process.hrtime(callStartHr);
        const durationSec = secs + nanos / 1e9;
        try {
          sorobanRpcCallDuration?.observe?.(
            { endpoint: ep.url, status: 'error' },
            durationSec
          );
          sorobanRpcCallsTotal?.inc?.({ endpoint: ep.url, status: 'error' });
        } catch (_) {}

        ep.failCount += 1;
        ep.lastFailureTime = Date.now();
        this._totalFailures += 1;

        const status =
          err?.status ||
          err?.statusCode ||
          err?.response?.status ||
          err?.cause?.status;
        if (Number(status) === 429) {
          ep.backoffAttempt = Math.min(ep.backoffAttempt + 1, 6);
          ep.rateLimitedUntil =
            Date.now() +
            Math.min(1000 * Math.pow(2, ep.backoffAttempt - 1), 60000);
          ep.state = CIRCUIT_STATES.OPEN;
          ep.isHealthy = false;
        }

        if (
          ep.failCount >= this.failureThreshold ||
          ep.state === CIRCUIT_STATES.HALF_OPEN
        ) {
          this.tripCircuitBreaker(ep);
        }

        this._recordCallFrame(
          this._buildCallFrame({
            id: frameId,
            parentId: null,
            endpoint: ep.url,
            method: frameMethod,
            status: 'error',
            durationMs: Math.round(durationSec * 1000),
            error: err,
            result: null,
            traceId: activeTraceId,
          })
        );
      }
    }

    const errorMsg = `All Soroban RPC endpoints failed or are circuit breaker OPEN. Last error: ${
      lastError?.message || 'Unknown error'
    }`;
    span?.setStatus?.({ code: 2, message: errorMsg });
    span?.recordException?.(lastError || new Error(errorMsg));
    span?.end?.();
    throw new Error(errorMsg);
  }

  getStatus() {
    this.checkCircuitStates();
    const totalReq = this._totalRequests;
    const totalFail = this._totalFailures;
    return {
      activeEndpoint: this.activeEndpoint.url,
      circuitBreakerState: this.activeEndpoint.state,
      // Aggregate metrics (#1575)
      metrics: {
        totalRequests: totalReq,
        totalFailures: totalFail,
        successRate:
          totalReq > 0
            ? Number(((totalReq - totalFail) / totalReq).toFixed(4))
            : 1,
      },
      endpoints: this.endpoints.map((ep) => ({
        url: ep.url,
        state: ep.state,
        isHealthy: ep.isHealthy,
        failCount: ep.failCount,
        lastFailureTime: ep.lastFailureTime
          ? new Date(ep.lastFailureTime).toISOString()
          : null,
        lastHealthyAt: ep.lastHealthyAt
          ? new Date(ep.lastHealthyAt).toISOString()
          : null,
        latestLedger: ep.latestLedger ?? null,
        // Latency tracking (#1575)
        latencyEmaMs:
          ep.latencyEmaMs !== null ? Math.round(ep.latencyEmaMs) : null,
        latencySamples: ep.latencySamples,
        lastLatencyMs: ep.lastLatencyMs,
        name: ep.name,
        rateLimitedUntil: ep.rateLimitedUntil
          ? new Date(ep.rateLimitedUntil).toISOString()
          : null,
        backoffAttempt: ep.backoffAttempt,
      })),
      callGraph: {
        frameCount: this._callHistory.length,
        limit: this._callHistoryLimit,
      },
    };
  }

  reset() {
    for (const ep of this.endpoints) {
      ep.state = CIRCUIT_STATES.CLOSED;
      ep.failCount = 0;
      ep.lastFailureTime = null;
      ep.isHealthy = true;
      ep.lastHealthyAt = null;
      ep.latestLedger = null;
      ep.latencyEmaMs = null;
      ep.latencySamples = 0;
      ep.lastLatencyMs = null;
      ep.rateLimitedUntil = null;
      ep.backoffAttempt = 0;
    }
    this.activeEndpointIndex = 0;
    this._totalRequests = 0;
    this._totalFailures = 0;
    this._callHistory = [];
  }
}

export const sorobanRpcManager = new SorobanRpcManager();
export default sorobanRpcManager;
