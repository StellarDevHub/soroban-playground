import {
  createChaosInjector,
  isChaosAllowed,
  parseChaosHeaders,
  parseDuration,
} from '../src/middleware/chaosInjector.js';

const ENABLED = { CHAOS_ENABLED: 'true', NODE_ENV: 'staging' };

function run(headers, { env = ENABLED, random = () => 0 } = {}) {
  const delay = jest.fn(() => Promise.resolve());
  const log = { warn: jest.fn() };
  const req = {
    headers,
    method: 'GET',
    url: '/api/compile',
    socket: { destroy: jest.fn() },
  };
  const res = { setHeader: jest.fn() };
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  const next = jest.fn();
  return createChaosInjector({ env, random, delay, log })(req, res, next).then(
    () => ({
      req,
      res,
      next,
      delay,
      log,
    })
  );
}

describe('chaosInjector header parsing', () => {
  it('parses durations, rates and status, ignoring invalid values', () => {
    expect(parseDuration('500ms')).toBe(500);
    expect(parseDuration('1.5s')).toBe(1500);
    expect(parseDuration('abc')).toBe(0);
    expect(parseDuration('999s')).toBe(30_000);
    expect(
      parseChaosHeaders({
        'x-chaos-drop-rate': '0.1',
        'x-chaos-error-rate': '2',
        'x-chaos-error-status': '418',
      })
    ).toMatchObject({ dropRate: 0.1, errorRate: 0, errorStatus: 503 });
  });
});

describe('chaosInjector production guard', () => {
  it.each([
    [{ CHAOS_ENABLED: 'true', NODE_ENV: 'production' }],
    [{ CHAOS_ENABLED: 'true', APP_ENV: 'Production' }],
    [{ NODE_ENV: 'staging' }],
  ])('is disabled for %j', async (env) => {
    expect(isChaosAllowed(env)).toBe(false);
    const { next, res, delay } = await run(
      { 'x-chaos-error-rate': '1' },
      { env }
    );
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(delay).not.toHaveBeenCalled();
  });
});

describe('chaosInjector faults', () => {
  it('injects latency, logs it, then continues', async () => {
    const { next, delay, log, res } = await run({ 'x-chaos-latency': '500ms' });
    expect(delay).toHaveBeenCalledWith(500);
    expect(log.warn).toHaveBeenCalledWith(
      'chaos fault injected',
      expect.objectContaining({ chaos: true, fault: 'latency', latencyMs: 500 })
    );
    expect(res.setHeader).toHaveBeenCalledWith('X-Chaos-Injected', 'latency');
    expect(next).toHaveBeenCalled();
  });

  it('drops the connection when the drop roll hits', async () => {
    const { req, next } = await run(
      { 'x-chaos-drop-rate': '0.5' },
      { random: () => 0.1 }
    );
    expect(req.socket.destroy).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('returns the configured 5xx and a simulated RPC timeout', async () => {
    const http = await run({
      'x-chaos-error-rate': '1',
      'x-chaos-error-status': '500',
    });
    expect(http.res.status).toHaveBeenCalledWith(500);

    const rpc = await run({ 'x-chaos-rpc-timeout': '1' });
    expect(rpc.res.status).toHaveBeenCalledWith(504);
    expect(rpc.res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'STELLAR_RPC_TIMEOUT' })
    );
  });

  it('passes through when no roll hits', async () => {
    const { next, res } = await run(
      { 'x-chaos-error-rate': '0.2' },
      { random: () => 0.9 }
    );
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
