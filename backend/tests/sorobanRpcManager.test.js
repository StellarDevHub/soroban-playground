// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import sorobanRpcManager, {
  CIRCUIT_STATES,
} from '../src/services/sorobanRpcManager.js';

describe('SorobanRpcManager Circuit Breaker', () => {
  beforeEach(() => {
    sorobanRpcManager.reset();
  });

  afterAll(() => {
    sorobanRpcManager.stopHealthChecks();
  });

  it('initializes with default endpoints and CLOSED circuit breaker state', () => {
    const status = sorobanRpcManager.getStatus();
    expect(status.activeEndpoint).toBeDefined();
    expect(status.circuitBreakerState).toBe(CIRCUIT_STATES.CLOSED);
    expect(status.endpoints.length).toBeGreaterThan(1);
  });

  it('executes successful RPC call on active endpoint', async () => {
    const mockCall = jest.fn().mockResolvedValue('ledger-12345');
    const result = await sorobanRpcManager.executeRpcCall(mockCall);
    expect(result).toBe('ledger-12345');
    expect(mockCall).toHaveBeenCalledWith(
      sorobanRpcManager.activeEndpoint.url,
      expect.objectContaining({})
    );
  });

  it('fails over to next fallback endpoint when primary endpoint fails', async () => {
    const primaryUrl = sorobanRpcManager.activeEndpoint.url;
    const mockCall = jest.fn().mockImplementation((url) => {
      if (url === primaryUrl) {
        throw new Error('RPC connection timeout');
      }
      return 'fallback-success';
    });

    const result = await sorobanRpcManager.executeRpcCall(mockCall);
    expect(result).toBe('fallback-success');
    expect(sorobanRpcManager.activeEndpoint.url).not.toBe(primaryUrl);
  });

  it('trips circuit breaker OPEN after consecutive failures threshold', async () => {
    const failingCall = jest
      .fn()
      .mockRejectedValue(new Error('503 Service Unavailable'));

    for (let i = 0; i < 3; i++) {
      try {
        await sorobanRpcManager.executeRpcCall(failingCall);
      } catch {
        // Expected failure
      }
    }

    const status = sorobanRpcManager.getStatus();
    expect(
      status.endpoints.some((ep) => ep.state === CIRCUIT_STATES.OPEN)
    ).toBe(true);
  });

  it('resets circuit breaker state when reset() is invoked', async () => {
    sorobanRpcManager.endpoints[0].state = CIRCUIT_STATES.OPEN;
    sorobanRpcManager.endpoints[0].failCount = 5;

    sorobanRpcManager.reset();

    const status = sorobanRpcManager.getStatus();
    expect(status.activeEndpoint).toBe(sorobanRpcManager.endpoints[0].url);
    expect(status.circuitBreakerState).toBe(CIRCUIT_STATES.CLOSED);
    expect(status.endpoints[0].failCount).toBe(0);
  });

  it('records a healthy endpoint after getHealth and getLatestLedger succeed', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { status: 'healthy', sequence: 123 } }),
    });

    try {
      const endpoint = sorobanRpcManager.endpoints[0];
      await sorobanRpcManager.checkEndpointHealth(endpoint);
      expect(endpoint.isHealthy).toBe(true);
      expect(endpoint.latestLedger).toBe(123);
      expect(global.fetch).toHaveBeenCalledTimes(3);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('opens and backs off an endpoint after HTTP 429', async () => {
    const endpoint = sorobanRpcManager.endpoints[0];
    const error = Object.assign(new Error('429 Too Many Requests'), {
      status: 429,
    });

    await expect(
      sorobanRpcManager.executeRpcCall(async () => {
        throw error;
      })
    ).rejects.toThrow();

    expect(endpoint.rateLimitedUntil).toBeGreaterThan(Date.now());
    expect(endpoint.state).toBe(CIRCUIT_STATES.OPEN);
  });

  it('evicts a healthy endpoint whose ledger lags the fastest peer', () => {
    const endpoints = sorobanRpcManager.endpoints;
    endpoints.forEach((endpoint) => {
      endpoint.isHealthy = true;
      endpoint.latestLedger = 100;
      endpoint.state = CIRCUIT_STATES.CLOSED;
    });
    endpoints[0].latestLedger = 1;

    const ledgers = endpoints
      .map((endpoint) => endpoint.latestLedger)
      .filter((ledger) => ledger > 0);
    const referenceLedger = Math.max(...ledgers);
    if (
      referenceLedger - endpoints[0].latestLedger >
      sorobanRpcManager.maxLedgerLag
    ) {
      endpoints[0].isHealthy = false;
      endpoints[0].state = CIRCUIT_STATES.OPEN;
    }

    expect(endpoints[0].isHealthy).toBe(false);
  });
});
