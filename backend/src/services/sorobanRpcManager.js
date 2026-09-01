import config from '../config/index.js';
import { createSpan, getTraceId } from '../utils/tracing.js';

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

class SorobanRpcManager {
  constructor() {
    const rawFallbacks = process.env.SOROBAN_RPC_FALLBACK_URLS
      ? process.env.SOROBAN_RPC_FALLBACK_URLS.split(',').map((u) => u.trim())
      : DEFAULT_FALLBACK_ENDPOINTS;

    this.endpoints = Array.from(new Set(rawFallbacks)).map((url) => ({
      url,
      state: CIRCUIT_STATES.CLOSED,
      failCount: 0,
      lastFailureTime: null,
      isHealthy: true,
    }));

    this.failureThreshold = Number.parseInt(
      process.env.RPC_FAILURE_THRESHOLD || '3',
      10
    );
    this.resetTimeoutMs = Number.parseInt(
      process.env.RPC_RESET_TIMEOUT_MS || '30000',
      10
    );
    this.activeEndpointIndex = 0;
    this.healthTimer = null;
    if (process.env.NODE_ENV !== 'test') this.startHealthChecks();
  }

  get activeEndpoint() {
    return this.endpoints[this.activeEndpointIndex] || this.endpoints[0];
  }

  checkCircuitStates() {
    const now = Date.now();
    for (const ep of this.endpoints) {
      if (
        ep.state === CIRCUIT_STATES.OPEN &&
        ep.lastFailureTime &&
        now - ep.lastFailureTime > this.resetTimeoutMs
      ) {
        ep.state = CIRCUIT_STATES.HALF_OPEN;
      }
    }
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
    try {
      const request = (method) =>
        fetch(ep.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params: [] }),
          signal: controller.signal,
        }).then(async (response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const payload = await response.json();
          if (payload.error) throw new Error(payload.error.message || `${method} failed`);
          return payload.result;
        });

      const [health, latestLedger] = await Promise.all([
        request('getHealth'),
        request('getLatestLedger'),
      ]);
      if (health?.status && health.status !== 'healthy') {
        throw new Error(`RPC health status: ${health.status}`);
      }
      ep.isHealthy = true;
      ep.failCount = 0;
      ep.state = CIRCUIT_STATES.CLOSED;
      ep.lastHealthyAt = Date.now();
      ep.latestLedger = latestLedger?.sequence ?? latestLedger;
      return true;
    } catch {
      ep.isHealthy = false;
      ep.lastFailureTime = Date.now();
      if (ep.state === CIRCUIT_STATES.CLOSED) ep.state = CIRCUIT_STATES.OPEN;
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  startHealthChecks() {
    if (this.healthTimer || this.endpoints.length === 0) return;
    const poll = () => {
      Promise.all(this.endpoints.map((endpoint) => this.checkEndpointHealth(endpoint))).catch(() => {});
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

    const activeTraceId = getTraceId();
    const span = activeTraceId
      ? createSpan('soroban_rpc_call', {
          'rpc.active_endpoint': this.activeEndpoint.url,
          'rpc.circuit_state': this.activeEndpoint.state,
        })
      : null;

    const traceHeaders = activeTraceId
      ? {
          'x-trace-id': activeTraceId,
          traceparent: `00-${activeTraceId}-${span?.spanContext()?.spanId || '0000000000000000'}-01`,
        }
      : {};

    let lastError = null;
    const startIndex = this.activeEndpointIndex;

    for (let i = 0; i < this.endpoints.length; i++) {
      const idx = (startIndex + i) % this.endpoints.length;
      const ep = this.endpoints[idx];

      if (ep.state === CIRCUIT_STATES.OPEN) {
        continue;
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);

        try {
          const result = await callFn(ep.url, {
            ...traceHeaders,
            signal: controller.signal,
          });

          ep.failCount = 0;
          ep.state = CIRCUIT_STATES.CLOSED;
          ep.isHealthy = true;
          this.activeEndpointIndex = idx;

          span?.setStatus({ code: 1 });
          return result;
        } finally {
          clearTimeout(timeout);
        }
      } catch (err) {
        lastError = err;
        ep.failCount += 1;
        ep.lastFailureTime = Date.now();

        if (
          ep.failCount >= this.failureThreshold ||
          ep.state === CIRCUIT_STATES.HALF_OPEN
        ) {
          this.tripCircuitBreaker(ep);
        }
      }
    }

    const errorMsg = `All Soroban RPC endpoints failed or are circuit breaker OPEN. Last error: ${
      lastError?.message || 'Unknown error'
    }`;
    span?.setStatus({ code: 2, message: errorMsg });
    span?.recordException(lastError || new Error(errorMsg));
    span?.end();
    throw new Error(errorMsg);
  }

  getStatus() {
    this.checkCircuitStates();
    return {
      activeEndpoint: this.activeEndpoint.url,
      circuitBreakerState: this.activeEndpoint.state,
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
      })),
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
    }
    this.activeEndpointIndex = 0;
  }
}

export const sorobanRpcManager = new SorobanRpcManager();
export default sorobanRpcManager;
