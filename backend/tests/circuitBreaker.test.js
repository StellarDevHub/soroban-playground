import {
  CircuitBreaker,
  CIRCUIT_STATES,
  createCircuitBreakerMiddleware,
  createMemoryCircuitStore,
  createRedisCircuitStore,
  createCachedReadReplica,
  routeReadCall,
  REDIS_CAS_MISSING,
} from '../src/services/circuitBreaker.js';
import {
  CircuitBreaker as MiddlewareCircuitBreaker,
  CIRCUIT_STATES as MiddlewareStates,
} from '../src/middleware/circuitBreaker.js';
import redisService from '../src/services/redisService.js';

jest.mock('../src/services/redisService.js', () => {
  const cache = new Map();
  return {
    __esModule: true,
    default: {
      client: null,
      isFallbackMode: true,
      get: jest.fn(async (key) => cache.get(key) ?? null),
      set: jest.fn(async (key, value) => {
        cache.set(key, value);
        return 'OK';
      }),
    },
  };
});

const optionsFor = (store, now, overrides = {}) => ({
  name: 'rpc-reads',
  store,
  now,
  failureThreshold: 2,
  resetTimeoutMs: 100,
  successThreshold: 2,
  halfOpenMaxRequests: 2,
  minSamples: 5,
  ...overrides,
});

describe('Shared RPC CircuitBreaker', () => {
  let clock;

  beforeEach(() => {
    clock = 1000;
    redisService.client = null;
    redisService.isFallbackMode = true;
  });

  test('middleware path re-exports the shared breaker', () => {
    expect(MiddlewareCircuitBreaker).toBe(CircuitBreaker);
    expect(MiddlewareStates).toBe(CIRCUIT_STATES);
  });

  test('starts CLOSED and uses the in-memory store when Redis is unavailable', async () => {
    const breaker = new CircuitBreaker(
      optionsFor(
        createMemoryCircuitStore({ prefix: 'starts-closed' }),
        () => clock
      )
    );

    expect(breaker.store.mode).toBe('memory');
    expect(await breaker.getState()).toBe(CIRCUIT_STATES.CLOSED);
    await expect(breaker.execute(async () => 'ok')).resolves.toBe('ok');
    expect(await breaker.getState()).toBe(CIRCUIT_STATES.CLOSED);
  });

  test('a trip is globally visible to sibling workers sharing one store', async () => {
    const store = createMemoryCircuitStore({ prefix: 'shared-trip' });
    const options = optionsFor(store, () => clock);
    const workerA = new CircuitBreaker(options);
    const workerB = new CircuitBreaker(options);

    for (let i = 0; i < 2; i += 1) {
      await expect(
        workerA.execute(async () => {
          throw new Error('upstream failure');
        })
      ).rejects.toThrow('upstream failure');
    }

    expect(await workerA.getState()).toBe(CIRCUIT_STATES.OPEN);
    expect(await workerB.getState()).toBe(CIRCUIT_STATES.OPEN);
    await expect(workerB.execute(async () => 'ok')).rejects.toMatchObject({
      status: 503,
      circuitBreakerOpen: true,
    });
  });

  test('trips globally when aggregate error rate exceeds 50% in the window', async () => {
    clock = 10_000;
    const store = createMemoryCircuitStore({ prefix: 'aggregate-rate' });
    const options = optionsFor(store, () => clock, { failureThreshold: 100 });
    const workerA = new CircuitBreaker(options);
    const workerB = new CircuitBreaker(options);

    await workerA.execute(async () => 'ok');
    await workerA.execute(async () => 'ok');
    await workerB.execute(async () => 'ok');
    for (let i = 0; i < 3; i += 1) {
      await expect(
        workerB.execute(async () => {
          throw new Error('upstream failure');
        })
      ).rejects.toThrow('upstream failure');
    }

    expect((await workerA.getStatus()).failureRate).toBeCloseTo(0.5);
    expect(await workerA.getState()).toBe(CIRCUIT_STATES.CLOSED);

    await expect(
      workerA.execute(async () => {
        throw new Error('upstream failure');
      })
    ).rejects.toThrow('upstream failure');

    expect((await workerB.getStatus()).failureRate).toBeGreaterThan(0.5);
    expect(await workerA.getState()).toBe(CIRCUIT_STATES.OPEN);
    expect(await workerB.getState()).toBe(CIRCUIT_STATES.OPEN);
  });

  test('samples older than the 30-second sliding window are excluded', async () => {
    const breaker = new CircuitBreaker(
      optionsFor(
        createMemoryCircuitStore({ prefix: 'sliding-window' }),
        () => clock,
        {
          failureThreshold: 100,
        }
      )
    );

    for (let i = 0; i < 4; i += 1) {
      await expect(
        breaker.execute(async () => {
          throw new Error('old failure');
        })
      ).rejects.toThrow('old failure');
    }
    clock += 31_000;
    for (let i = 0; i < 4; i += 1) {
      await breaker.execute(async () => 'fresh success');
    }
    await expect(
      breaker.execute(async () => {
        throw new Error('fresh failure');
      })
    ).rejects.toThrow('fresh failure');

    const status = await breaker.getStatus();
    expect(status.totalRequests).toBe(5);
    expect(status.failureRate).toBeCloseTo(0.2);
    expect(status.state).toBe(CIRCUIT_STATES.CLOSED);
  });

  test('transitions OPEN -> HALF_OPEN -> CLOSED after successful probes', async () => {
    const breaker = new CircuitBreaker(
      optionsFor(
        createMemoryCircuitStore({ prefix: 'open-half-closed' }),
        () => clock
      )
    );

    await breaker.trip();
    expect(await breaker.getState()).toBe(CIRCUIT_STATES.OPEN);

    clock += 100;
    const decision = await breaker.canExecute();
    expect(decision).toMatchObject({
      allowed: true,
      state: CIRCUIT_STATES.HALF_OPEN,
    });

    await breaker.recordSuccess();
    expect(await breaker.getState()).toBe(CIRCUIT_STATES.HALF_OPEN);

    await breaker.recordSuccess();
    expect(await breaker.getState()).toBe(CIRCUIT_STATES.CLOSED);
    await expect(breaker.execute(async () => 'ok')).resolves.toBe('ok');
  });

  test('a failed probe re-opens the circuit and restarts the timeout', async () => {
    const breaker = new CircuitBreaker(
      optionsFor(
        createMemoryCircuitStore({ prefix: 'failed-probe' }),
        () => clock
      )
    );

    await breaker.trip();
    clock += 100;
    await breaker.canExecute();
    await breaker.recordFailure();

    expect(await breaker.getState()).toBe(CIRCUIT_STATES.OPEN);
    expect((await breaker.getStatus()).retryAfterMs).toBe(100);
  });

  test('limits concurrent HALF_OPEN probes', async () => {
    const breaker = new CircuitBreaker(
      optionsFor(
        createMemoryCircuitStore({ prefix: 'probe-limit' }),
        () => clock,
        {
          halfOpenMaxRequests: 1,
        }
      )
    );

    await breaker.trip();
    clock += 100;

    expect((await breaker.canExecute()).allowed).toBe(true);
    const second = await breaker.canExecute();
    expect(second).toMatchObject({
      allowed: false,
      state: CIRCUIT_STATES.HALF_OPEN,
      reason: 'half-open probe limit reached',
    });
  });

  test('the Redis store shares state across instances via atomic CAS', async () => {
    const data = new Map();
    const client = {
      async get(key) {
        return data.has(key) ? data.get(key) : null;
      },
      async eval(_script, _numKeys, key, previous, next) {
        const current = data.has(key) ? data.get(key) : null;
        if (previous === REDIS_CAS_MISSING) {
          if (current !== null) return 0;
        } else if (current !== previous) {
          return 0;
        }
        data.set(key, next);
        return 1;
      },
    };
    const store = createRedisCircuitStore({ client });
    const options = optionsFor(store, () => clock);
    const workerA = new CircuitBreaker(options);
    const workerB = new CircuitBreaker(options);

    expect(workerA.store.mode).toBe('redis');
    await workerA.trip();
    expect(await workerB.getState()).toBe(CIRCUIT_STATES.OPEN);

    clock += 100;
    await workerB.canExecute();
    await workerB.recordSuccess();
    await workerB.recordSuccess();

    expect(await workerA.getState()).toBe(CIRCUIT_STATES.CLOSED);
    expect(data.size).toBe(1);
  });

  test('non-critical reads use the fallback while critical reads are rejected', async () => {
    const breaker = new CircuitBreaker(
      optionsFor(
        createMemoryCircuitStore({ prefix: 'read-routing' }),
        () => clock
      )
    );
    await breaker.trip();

    const fallback = jest.fn().mockResolvedValue({ cached: true });
    await expect(
      breaker.execute(async () => 'primary', { fallback })
    ).resolves.toEqual({ cached: true });
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(breaker.routeStats.replica).toBe(1);

    await expect(
      breaker.execute(async () => 'primary', { fallback, critical: true })
    ).rejects.toMatchObject({ status: 503, circuitBreakerOpen: true });

    await expect(
      routeReadCall(breaker, {
        primary: async () => 'primary',
        fallback: 'cached-value',
      })
    ).resolves.toBe('cached-value');
  });

  test('cached replica serves stale non-critical reads when the circuit is open', async () => {
    const replica = createCachedReadReplica({
      cache: redisService,
      now: () => clock,
      freshTtlMs: 1000,
      staleTtlMs: 5000,
    });
    await replica.set('ledger', { sequence: 42 });

    const breaker = new CircuitBreaker(
      optionsFor(
        createMemoryCircuitStore({ prefix: 'replica-reads' }),
        () => clock,
        {
          resetTimeoutMs: 5000,
        }
      )
    );
    await breaker.trip();
    clock += 2500;

    const fetchFn = jest.fn(async () => ({ sequence: 99 }));
    await expect(
      replica.readWithBreaker(breaker, 'ledger', fetchFn)
    ).resolves.toMatchObject({
      source: 'replica',
      stale: true,
      value: { sequence: 42 },
    });
    expect(fetchFn).not.toHaveBeenCalled();

    await expect(
      replica.readWithBreaker(breaker, 'ledger', fetchFn, { critical: true })
    ).rejects.toMatchObject({ status: 503, circuitBreakerOpen: true });
  });

  test('cached replica falls back to stale data when a primary read fails', async () => {
    const replica = createCachedReadReplica({
      cache: redisService,
      now: () => clock,
      freshTtlMs: 100_000,
    });
    await replica.set('ledger', { sequence: 7 });

    const breaker = new CircuitBreaker(
      optionsFor(
        createMemoryCircuitStore({ prefix: 'replica-error' }),
        () => clock
      )
    );
    const failingRead = jest.fn(async () => {
      throw new Error('rpc unavailable');
    });

    await expect(
      replica.readWithBreaker(breaker, 'ledger', failingRead)
    ).resolves.toMatchObject({
      source: 'replica',
      value: { sequence: 7 },
    });
  });

  test('middleware returns 503 when the circuit is open', async () => {
    const middleware = createCircuitBreakerMiddleware(
      optionsFor(
        createMemoryCircuitStore({ prefix: 'middleware-503' }),
        () => clock
      )
    );
    await middleware.breaker.trip();

    const req = { method: 'GET', url: '/api/rpc/ledger' };
    const res = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
    expect(res.setHeader).toHaveBeenCalledWith('X-Circuit-Breaker', 'OPEN');
    expect(next).not.toHaveBeenCalled();
  });

  test('middleware routes non-critical GETs to the fallback while open', async () => {
    const middleware = createCircuitBreakerMiddleware(
      optionsFor(
        createMemoryCircuitStore({ prefix: 'middleware-fallback' }),
        () => clock,
        {
          fallback: async () => ({ sequence: 1 }),
        }
      )
    );
    await middleware.breaker.trip();

    const res = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    await middleware({ method: 'GET', url: '/api/rpc/ledger' }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.setHeader).toHaveBeenCalledWith('X-Data-Source', 'replica');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        degraded: true,
        data: { sequence: 1 },
      })
    );
  });

  test('middleware keeps rejecting non-GET traffic while open', async () => {
    const middleware = createCircuitBreakerMiddleware(
      optionsFor(
        createMemoryCircuitStore({ prefix: 'middleware-post' }),
        () => clock,
        {
          fallback: async () => ({ sequence: 1 }),
        }
      )
    );
    await middleware.breaker.trip();

    const res = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    await middleware({ method: 'POST', url: '/api/rpc/tx' }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(503);
  });

  test('middleware records finished responses into the shared breaker', async () => {
    const middleware = createCircuitBreakerMiddleware(
      optionsFor(
        createMemoryCircuitStore({ prefix: 'middleware-finish' }),
        () => clock,
        {
          failureThreshold: 1,
        }
      )
    );
    const listeners = {};
    const res = {
      statusCode: 500,
      setHeader: jest.fn(),
      on: jest.fn((event, callback) => {
        listeners[event] = callback;
      }),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    await middleware({ method: 'GET', url: '/api/rpc/ledger' }, res, next);
    expect(next).toHaveBeenCalled();

    listeners.finish();
    await new Promise((resolve) => setImmediate(resolve));
    expect(await middleware.breaker.getState()).toBe(CIRCUIT_STATES.OPEN);
  });
});
