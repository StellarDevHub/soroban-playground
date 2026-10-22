// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Unit tests for the dynamic RPC load balancer (#1773).
 *
 * Covers EWMA latency scoring, circuit-breaker transitions, lowest-latency
 * routing, transient 5xx failover and telemetry exposure.
 */

import {
  CircuitBreaker,
  CIRCUIT_STATES,
  Ewma,
  NoHealthyRpcProviderError,
  RpcLoadBalancer,
} from '../src/services/rpc/loadBalancer.ts';

function createClock(start = 1_000) {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
  };
}

describe('Ewma', () => {
  it('seeds on the first sample and blends subsequent samples', () => {
    const ewma = new Ewma(0.5);

    expect(ewma.update(100)).toBe(100);
    expect(ewma.update(200)).toBe(150);
    expect(ewma.update(50)).toBe(100);
    expect(ewma.samples).toBe(3);
  });

  it('rejects invalid smoothing factors', () => {
    expect(() => new Ewma(0)).toThrow(RangeError);
    expect(() => new Ewma(1.5)).toThrow(RangeError);
  });
});

describe('CircuitBreaker', () => {
  it('opens when the EWMA error rate exceeds 5%', () => {
    const clock = createClock();
    const breaker = new CircuitBreaker({
      errorRateThreshold: 0.05,
      minimumRequests: 5,
      consecutiveFailureThreshold: 100,
      openTimeoutMs: 1_000,
      now: clock.now,
    });

    for (let i = 0; i < 5; i += 1) breaker.recordSuccess();
    breaker.recordFailure();

    // One failure from a healthy baseline yields exactly 5%, not > 5%.
    expect(breaker.state).toBe(CIRCUIT_STATES.CLOSED);

    breaker.recordFailure();
    expect(breaker.state).toBe(CIRCUIT_STATES.OPEN);
    expect(breaker.isAvailable()).toBe(false);
  });

  it('transitions OPEN -> HALF_OPEN -> CLOSED after the cool-down', () => {
    const clock = createClock();
    const breaker = new CircuitBreaker({
      consecutiveFailureThreshold: 1,
      openTimeoutMs: 1_000,
      halfOpenSuccessesToClose: 1,
      now: clock.now,
    });

    breaker.recordFailure();
    expect(breaker.state).toBe(CIRCUIT_STATES.OPEN);

    clock.advance(1_000);
    expect(breaker.isAvailable()).toBe(true);
    expect(breaker.acquire()).toBe(true);
    expect(breaker.state).toBe(CIRCUIT_STATES.HALF_OPEN);

    breaker.recordSuccess();
    expect(breaker.state).toBe(CIRCUIT_STATES.CLOSED);
  });

  it('re-opens when a HALF_OPEN probe fails', () => {
    const clock = createClock();
    const breaker = new CircuitBreaker({
      consecutiveFailureThreshold: 1,
      openTimeoutMs: 500,
      now: clock.now,
    });

    breaker.recordFailure();
    clock.advance(500);
    expect(breaker.acquire()).toBe(true);
    expect(breaker.state).toBe(CIRCUIT_STATES.HALF_OPEN);

    breaker.recordFailure();
    expect(breaker.state).toBe(CIRCUIT_STATES.OPEN);
  });

  it('opens immediately after consecutive failures', () => {
    const clock = createClock();
    const breaker = new CircuitBreaker({
      consecutiveFailureThreshold: 3,
      minimumRequests: 100,
      now: clock.now,
    });

    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.state).toBe(CIRCUIT_STATES.CLOSED);

    breaker.recordFailure();
    expect(breaker.state).toBe(CIRCUIT_STATES.OPEN);
  });
});

describe('RpcLoadBalancer', () => {
  const slow = { url: 'https://rpc-slow.example', name: 'slow' };
  const fast = { url: 'https://rpc-fast.example', name: 'fast' };

  it('routes to the lowest EWMA-latency healthy provider', async () => {
    const clock = createClock();
    const balancer = new RpcLoadBalancer([slow, fast], { now: clock.now });

    balancer.recordSuccess(slow.url, 250);
    balancer.recordSuccess(fast.url, 25);

    const execution = await balancer.executeWithMetadata(() =>
      Promise.resolve('ok')
    );

    expect(execution.url).toBe(fast.url);
    expect(execution.result).toBe('ok');
    expect(execution.attempts).toBe(1);
  });

  it('retries a transient 5xx on a secondary provider', async () => {
    const clock = createClock();
    const balancer = new RpcLoadBalancer([slow, fast], { now: clock.now });
    const error = Object.assign(new Error('Service Unavailable'), {
      status: 503,
    });

    const request = jest.fn().mockImplementation((url) => {
      if (url === slow.url) return Promise.reject(error);
      return Promise.resolve('from-secondary');
    });

    const result = await balancer.execute(request);

    expect(result).toBe('from-secondary');
    expect(request).toHaveBeenCalledTimes(2);
    expect(balancer.getStatus().metrics.totalRetries).toBe(1);
    expect(
      balancer
        .getStatus()
        .providers.find((provider) => provider.url === slow.url).failures
    ).toBe(1);
  });

  it('does not retry non-transient errors', async () => {
    const balancer = new RpcLoadBalancer([slow, fast], {
      now: createClock().now,
    });
    const error = Object.assign(new Error('Bad Request'), { status: 400 });
    const request = jest.fn().mockRejectedValue(error);

    await expect(balancer.execute(request)).rejects.toThrow('Bad Request');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('steers traffic away from open circuits', async () => {
    const clock = createClock();
    const balancer = new RpcLoadBalancer([slow, fast], {
      now: clock.now,
      minimumRequests: 2,
      consecutiveFailureThreshold: 100,
      openTimeoutMs: 1_000,
    });

    balancer.recordFailure(slow.url, { status: 503 });
    balancer.recordFailure(slow.url, { status: 503 });

    const status = balancer.getStatus();
    expect(status.providers[0].state).toBe(CIRCUIT_STATES.OPEN);

    const execution = await balancer.executeWithMetadata(() =>
      Promise.resolve('healthy')
    );
    expect(execution.url).toBe(fast.url);
  });

  it('restores traffic when a degraded provider recovers', async () => {
    const clock = createClock();
    const balancer = new RpcLoadBalancer([slow, fast], {
      now: clock.now,
      minimumRequests: 2,
      consecutiveFailureThreshold: 100,
      openTimeoutMs: 1_000,
      halfOpenSuccessesToClose: 1,
    });

    balancer.recordLatency(slow.url, 10);
    balancer.recordLatency(fast.url, 500);
    balancer.recordFailure(slow.url, { status: 503 });
    balancer.recordFailure(slow.url, { status: 503 });

    expect(balancer.getStatus().providers[0].state).toBe(CIRCUIT_STATES.OPEN);

    clock.advance(1_000);

    const execution = await balancer.executeWithMetadata(() =>
      Promise.resolve('recovered')
    );

    expect(execution.url).toBe(slow.url);
    expect(execution.circuitState).toBe(CIRCUIT_STATES.CLOSED);
    expect(balancer.getStatus().providers[0].state).toBe(CIRCUIT_STATES.CLOSED);
  });

  it('throws when every provider is circuit-broken', async () => {
    const clock = createClock();
    const balancer = new RpcLoadBalancer([slow, fast], {
      now: clock.now,
      consecutiveFailureThreshold: 1,
    });

    balancer.recordFailure(slow.url);
    balancer.recordFailure(fast.url);

    await expect(
      balancer.execute(() => Promise.resolve('unreachable'))
    ).rejects.toBeInstanceOf(NoHealthyRpcProviderError);
  });

  it('emits live telemetry snapshots', () => {
    const balancer = new RpcLoadBalancer([slow, fast], {
      now: createClock().now,
    });
    const listener = jest.fn();
    const unsubscribe = balancer.onTelemetry(listener);

    balancer.recordSuccess(slow.url, 40);

    expect(listener).toHaveBeenCalled();
    const snapshot = listener.mock.calls.at(-1)[0];
    expect(snapshot.providerCount).toBe(2);
    expect(snapshot.providers[0].latencyEmaMs).toBe(40);
    expect(snapshot.metrics.totalSuccesses).toBe(1);

    unsubscribe();
    listener.mockClear();
    balancer.recordSuccess(slow.url, 40);
    expect(listener).not.toHaveBeenCalled();
  });

  it('supports adding and removing providers at runtime', () => {
    const balancer = new RpcLoadBalancer([slow], {
      now: createClock().now,
    });

    expect(balancer.addProvider(fast)).toBe(true);
    expect(balancer.addProvider(fast)).toBe(false);
    expect(balancer.getProviderConfigs()).toHaveLength(2);

    expect(balancer.removeProvider(fast.url)).toBe(true);
    expect(balancer.getProviderConfigs()).toHaveLength(1);
  });
});
