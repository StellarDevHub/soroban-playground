import { jest } from '@jest/globals';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

const mockRedisService = {
  get: jest.fn(),
  set: jest.fn(),
};

jest.unstable_mockModule('../src/services/redisService.js', () => ({
  __esModule: true,
  default: mockRedisService,
}));

const {
  fetchFeeStats,
  calculateFee,
  isFeeError,
  submitWithEscalation,
  _clearCacheForTesting,
} = await import('../src/services/feeEngine.js');

function makeFeeStats(p90 = '200') {
  return {
    fee_charged: {
      min: '100',
      mode: '100',
      p10: '100',
      p20: '100',
      p30: '100',
      p40: '100',
      p50: '150',
      p60: '150',
      p70: '200',
      p80: '200',
      p90,
      p95: '250',
      p99: '300',
    },
    max_fee: { min: '100', mode: '100', p10: '100', p90: '1000' },
    ledger_capacity_usage: '0.05',
    last_ledger: '100',
    last_ledger_base_fee: '100',
  };
}

describe('fetchFeeStats', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _clearCacheForTesting();
    mockRedisService.get.mockResolvedValue(null);
    mockRedisService.set.mockResolvedValue('OK');
  });

  it('returns parsed fee stats from Horizon', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeFeeStats('500'),
    });
    const stats = await fetchFeeStats('mainnet');
    expect(stats.fee_charged.p90).toBe('500');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://horizon.stellar.org/fee_stats',
      expect.objectContaining({ signal: expect.anything() })
    );
  });

  it('caches fee stats in Redis and reuses the cached payload', async () => {
    const cachedStats = makeFeeStats('250');
    mockRedisService.get.mockResolvedValueOnce(JSON.stringify(cachedStats));

    const stats = await fetchFeeStats('testnet');

    expect(stats.fee_charged.p90).toBe('250');
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockRedisService.get).toHaveBeenCalledWith('fee_stats:testnet');
  });

  it('throws on non-ok Horizon response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });
    await expect(fetchFeeStats('mainnet')).rejects.toThrow('HTTP 503');
  });
});

describe('calculateFee', () => {
  const stats = makeFeeStats('200');

  it('returns p90 for attempt 1', () => {
    expect(calculateFee(stats, 1)).toBe(200);
  });

  it('escalates by factor for subsequent attempts', () => {
    const attempt2 = calculateFee(stats, 2, {
      escalationFactor: 1.5,
      maxFee: 10000,
    });
    expect(attempt2).toBe(Math.ceil(200 * 1.5));
  });

  it('does not exceed maxFee', () => {
    const fee = calculateFee(stats, 10, { escalationFactor: 2, maxFee: 500 });
    expect(fee).toBe(500);
  });

  it('returns at least BASE_FEE (100 stroops)', () => {
    const zeroStats = { fee_charged: { p90: '0' } };
    expect(calculateFee(zeroStats, 1)).toBe(100);
  });

  it('handles missing fee_charged gracefully', () => {
    expect(calculateFee({}, 1)).toBe(100);
  });
});

describe('isFeeError', () => {
  it('detects tx_insufficient_fee via result_codes', () => {
    expect(
      isFeeError({ result_codes: { transaction: 'tx_insufficient_fee' } })
    ).toBe(true);
  });

  it('detects tx_insufficient_fee via horizonResultCode', () => {
    expect(isFeeError({ horizonResultCode: 'tx_insufficient_fee' })).toBe(true);
  });

  it('detects fee error via message string', () => {
    expect(isFeeError(new Error('tx_insufficient_fee'))).toBe(true);
    expect(isFeeError(new Error('fee_too_low'))).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isFeeError({ result_codes: { transaction: 'tx_bad_auth' } })).toBe(
      false
    );
    expect(isFeeError(new Error('tx_bad_seq'))).toBe(false);
    expect(isFeeError(null)).toBe(false);
  });
});

describe('submitWithEscalation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _clearCacheForTesting();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeFeeStats('200'),
    });
  });

  it('succeeds on first attempt', async () => {
    const submitFn = jest.fn().mockResolvedValue({ hash: 'abc123' });
    const result = await submitWithEscalation(submitFn, {
      network: 'testnet',
      maxAttempts: 3,
    });
    expect(result).toEqual({ hash: 'abc123' });
    expect(submitFn).toHaveBeenCalledTimes(1);
    expect(submitFn).toHaveBeenCalledWith(200, 1);
  });

  it('retries with escalated fee on fee errors', async () => {
    const feeErr = Object.assign(new Error('tx_insufficient_fee'), {
      result_codes: { transaction: 'tx_insufficient_fee' },
    });
    const submitFn = jest
      .fn()
      .mockRejectedValueOnce(feeErr)
      .mockRejectedValueOnce(feeErr)
      .mockResolvedValueOnce({ hash: 'def456' });

    const result = await submitWithEscalation(submitFn, {
      network: 'testnet',
      maxAttempts: 5,
      escalationFactor: 1.5,
    });
    expect(result).toEqual({ hash: 'def456' });
    expect(submitFn).toHaveBeenCalledTimes(3);
    // Each attempt gets an escalated fee
    expect(submitFn.mock.calls[0][0]).toBe(200);
    expect(submitFn.mock.calls[1][0]).toBe(Math.ceil(200 * 1.5));
    expect(submitFn.mock.calls[2][0]).toBe(Math.ceil(200 * 1.5 * 1.5));
  });

  it('does not retry on non-fee errors', async () => {
    const authErr = Object.assign(new Error('tx_bad_auth'), {
      result_codes: { transaction: 'tx_bad_auth' },
    });
    const submitFn = jest.fn().mockRejectedValue(authErr);
    await expect(
      submitWithEscalation(submitFn, { network: 'testnet' })
    ).rejects.toThrow('tx_bad_auth');
    expect(submitFn).toHaveBeenCalledTimes(1);
  });

  it('throws after exhausting maxAttempts on repeated fee errors', async () => {
    const feeErr = Object.assign(new Error('tx_insufficient_fee'), {
      result_codes: { transaction: 'tx_insufficient_fee' },
    });
    const submitFn = jest.fn().mockRejectedValue(feeErr);
    await expect(
      submitWithEscalation(submitFn, { network: 'testnet', maxAttempts: 3 })
    ).rejects.toThrow('tx_insufficient_fee');
    expect(submitFn).toHaveBeenCalledTimes(3);
  });

  it('respects maxFee cap across all attempts', async () => {
    const feeErr = Object.assign(new Error('tx_insufficient_fee'), {
      result_codes: { transaction: 'tx_insufficient_fee' },
    });
    const submitFn = jest
      .fn()
      .mockRejectedValueOnce(feeErr)
      .mockRejectedValueOnce(feeErr)
      .mockResolvedValueOnce({ ok: true });

    await submitWithEscalation(submitFn, {
      network: 'testnet',
      maxAttempts: 5,
      maxFee: 250,
      escalationFactor: 2,
    });
    for (const [fee] of submitFn.mock.calls) {
      expect(fee).toBeLessThanOrEqual(250);
    }
  });
});
