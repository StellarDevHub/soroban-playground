import { TieredCache } from '../src/services/multiLevelCache.js';

function createRedis() {
  const values = new Map();
  const subscribers = new Map();
  return {
    values,
    isFallbackMode: true,
    subscribe: jest.fn(async (channel, callback) => {
      if (!subscribers.has(channel)) subscribers.set(channel, new Set());
      subscribers.get(channel).add(callback);
    }),
    unsubscribe: jest.fn(async (channel, callback) => {
      subscribers.get(channel)?.delete(callback);
    }),
    publish: jest.fn(async (channel, message) => {
      for (const callback of subscribers.get(channel) || []) {
        callback(JSON.stringify(message));
      }
    }),
    get: jest.fn(async (key) => values.get(key) ?? null),
    set: jest.fn(async (key, value) => {
      values.set(key, value);
      return 'OK';
    }),
    delete: jest.fn(async (key) => values.delete(key)),
  };
}

describe('TieredCache', () => {
  it('uses LRU-2 to protect repeatedly accessed entries from one-time scans', async () => {
    const cache = new TieredCache({ redis: createRedis(), maxL1: 2 });
    const fetchValue = (value) => jest.fn(async () => value);

    await cache.get('popular', fetchValue('popular'));
    await cache.get('popular', fetchValue('unused'));
    await cache.get('scan-1', fetchValue('scan-1'));
    await cache.get('scan-2', fetchValue('scan-2'));

    expect(cache.l1.has('popular')).toBe(true);
    expect(cache.l1.has('scan-1')).toBe(false);
    expect(cache.l1.has('scan-2')).toBe(true);
    await cache.close();
  });

  it('deduplicates concurrent L2 misses and database fetches by key', async () => {
    const redis = createRedis();
    let releaseFetch;
    const fetchFn = jest.fn(
      () =>
        new Promise((resolve) => {
          releaseFetch = resolve;
        })
    );
    const cache = new TieredCache({ redis });

    const first = cache.get('shared', fetchFn);
    const second = cache.get('shared', fetchFn);
    await Promise.resolve();
    await Promise.resolve();
    releaseFetch('result');

    await expect(Promise.all([first, second])).resolves.toEqual([
      'result',
      'result',
    ]);
    expect(redis.get).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await cache.close();
  });

  it('broadcasts invalidations so other cache instances drop their L1 copy', async () => {
    const redis = createRedis();
    const first = new TieredCache({ redis });
    const second = new TieredCache({ redis });
    await first.get('shared', async () => 'value');
    await second.get('shared', async () => 'unused');

    await first.invalidate('shared');

    expect(first.l1.has('shared')).toBe(false);
    expect(second.l1.has('shared')).toBe(false);
    expect(redis.values.has('shared')).toBe(false);
    await Promise.all([first.close(), second.close()]);
  });

  it('keeps L1 entry count and calculated bytes within configured limits', async () => {
    const cache = new TieredCache({
      redis: createRedis(),
      maxL1: 2,
      maxL1Bytes: 10,
      sizeCalculation: () => 6,
    });

    await cache.get('one', async () => 'one');
    await cache.get('two', async () => 'two');

    expect(cache.l1.size).toBeLessThanOrEqual(2);
    expect(cache.l1.calculatedSize).toBeLessThanOrEqual(10);
    await cache.close();
  });
});
