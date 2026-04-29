import {
  RetryStrategy,
  normalizeRetry,
  nextDelay,
} from '../../src/services/oracle/retry.js';

describe('retry strategy', () => {
  it('normalizes input and clamps invalid values', () => {
    const opts = normalizeRetry({ maxAttempts: -3, jitter: 5 });
    expect(opts.maxAttempts).toBe(1);
    expect(opts.jitter).toBe(1);
  });

  it('produces fixed delays', () => {
    const opts = normalizeRetry({ strategy: RetryStrategy.FIXED, baseMs: 50, jitter: 0 });
    expect(nextDelay(opts, 1, () => 0.5)).toBe(50);
    expect(nextDelay(opts, 5, () => 0.5)).toBe(50);
  });

  it('produces exponential delays bounded by maxMs', () => {
    const opts = normalizeRetry({
      strategy: RetryStrategy.EXPONENTIAL,
      baseMs: 10,
      maxMs: 100,
      jitter: 0,
    });
    expect(nextDelay(opts, 1, () => 0.5)).toBe(10);
    expect(nextDelay(opts, 2, () => 0.5)).toBe(20);
    expect(nextDelay(opts, 3, () => 0.5)).toBe(40);
    expect(nextDelay(opts, 4, () => 0.5)).toBe(80);
    expect(nextDelay(opts, 5, () => 0.5)).toBe(100); // capped
    expect(nextDelay(opts, 6, () => 0.5)).toBe(100); // still capped
  });

  it('applies jitter symmetrically around the base delay', () => {
    const opts = normalizeRetry({
      strategy: RetryStrategy.FIXED,
      baseMs: 100,
      jitter: 0.5,
    });
    // jitter window: [75, 125]
    expect(nextDelay(opts, 1, () => 0)).toBe(75);
    expect(nextDelay(opts, 1, () => 1)).toBeLessThanOrEqual(125);
    expect(nextDelay(opts, 1, () => 0.5)).toBe(100);
  });
});
