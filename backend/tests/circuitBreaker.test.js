import { CircuitBreaker, CIRCUIT_STATES, createCircuitBreakerMiddleware } from '../src/middleware/circuitBreaker.js';

describe('CircuitBreaker Middleware', () => {
  let breaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      failureThreshold: 2,
      resetTimeoutMs: 100,
      halfOpenMaxRequests: 2,
      successThreshold: 2,
    });
  });

  test('starts in CLOSED state and allows execution', async () => {
    expect(breaker.getState()).toBe(CIRCUIT_STATES.CLOSED);
    const result = await breaker.execute(async () => 'ok');
    expect(result).toBe('ok');
  });

  test('trips to OPEN after failure threshold', async () => {
    try {
      await breaker.execute(async () => { throw new Error('fail 1'); });
    } catch {}

    try {
      await breaker.execute(async () => { throw new Error('fail 2'); });
    } catch {}

    expect(breaker.getState()).toBe(CIRCUIT_STATES.OPEN);
    await expect(breaker.execute(async () => 'ok')).rejects.toThrow('Circuit breaker');
  });

  test('transitions to HALF_OPEN after reset timeout', async () => {
    breaker.trip();
    expect(breaker.getState()).toBe(CIRCUIT_STATES.OPEN);

    await new Promise((r) => setTimeout(r, 120));
    expect(breaker.getState()).toBe(CIRCUIT_STATES.HALF_OPEN);
  });

  test('express middleware returns 503 when circuit is open', () => {
    const middleware = createCircuitBreakerMiddleware({ failureThreshold: 1 });
    middleware.breaker.trip();

    const req = {};
    const res = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    expect(next).not.toHaveBeenCalled();
  });
});
