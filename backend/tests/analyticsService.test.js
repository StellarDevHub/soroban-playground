import redisService, {
  getAnalyticsHourKey,
} from '../src/services/redisService.js';

describe('analytics logging', () => {
  beforeEach(() => {
    redisService.client = null;
    redisService.isFallbackMode = true;
    redisService.localAnalytics.hourly.clear();
    redisService.localAnalytics.endpoints.clear();
    redisService.localAnalytics.ips.clear();
  });

  it('formats hourly analytics keys with calendar-safe UTC values', () => {
    const key = getAnalyticsHourKey(new Date('2026-01-02T03:04:05Z'));
    expect(key).toBe('analytics:hr:2026-01-02:03');
  });

  it('records analytics in memory when Redis is unavailable', async () => {
    const result = await redisService.logAnalytics(
      '/api/compile',
      '127.0.0.1',
      'allowed'
    );
    const snapshot = redisService.getMemoryAnalyticsSnapshot();

    expect(result.stored).toBe('memory');
    expect(snapshot.endpoints['/api/compile']).toEqual({ allowed: 1 });
    expect(snapshot.ips['127.0.0.1']).toEqual({ allowed: 1 });
  });

  it('normalizes missing analytics dimensions', async () => {
    await redisService.logAnalytics('', null, '');
    const snapshot = redisService.getMemoryAnalyticsSnapshot();

    expect(snapshot.endpoints.unknown).toEqual({ unknown: 1 });
    expect(snapshot.ips.unknown).toEqual({ unknown: 1 });
  });
});
