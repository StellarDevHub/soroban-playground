import {
  CacheInvalidator,
  CONTRACT_CACHE_PREFIXES,
} from '../src/services/cacheInvalidator.js';

function createInvalidator() {
  const deleted = [];
  const published = [];
  const l1 = new Map();
  const store = new Map();
  const sets = new Map();

  const client = {
    pipeline() {
      const ops = [];
      return {
        sadd(key, ...members) {
          ops.push(() => {
            if (!sets.has(key)) sets.set(key, new Set());
            for (const member of members) sets.get(key).add(member);
          });
        },
        expire() {
          ops.push(() => {});
        },
        async exec() {
          ops.forEach((op) => op());
          return [];
        },
      };
    },
    async smembers(key) {
      return [...(sets.get(key) || [])];
    },
    async del(...keys) {
      for (const key of keys) {
        store.delete(key);
        sets.delete(key);
        deleted.push(key);
      }
      return keys.length;
    },
    async publish(channel, payload) {
      published.push({ channel, payload: JSON.parse(payload) });
      return 1;
    },
  };

  const redis = { isFallbackMode: false, client };
  const localCache = {
    l1,
    async invalidate(key) {
      l1.delete(key);
    },
    async invalidatePattern(prefix) {
      deleted.push(`pattern:${prefix}`);
    },
  };

  const invalidator = new CacheInvalidator({ redis, localCache });
  return { invalidator, deleted, published, l1, client };
}

describe('CacheInvalidator', () => {
  it('indexes keys under tags and purges them together', async () => {
    const { invalidator, l1 } = createInvalidator();
    l1.set('events:C1', { ok: true });
    await invalidator.remember('events:C1', ['contract:C1', 'ledger']);

    const result = await invalidator.invalidateTags(['contract:C1'], {
      broadcast: false,
    });

    expect(result.keys).toContain('events:C1');
    expect(l1.has('events:C1')).toBe(false);
  });

  it('maps a Soroban ledger event onto contract, ledger, and market tags', () => {
    const { invalidator } = createInvalidator();
    const tags = invalidator.tagsForLedgerEvent({
      contractId: 'CABC',
      ledgerSequence: 123,
      topics: ['resolved', 7],
    });

    expect(tags).toEqual(
      expect.arrayContaining([
        'ledger',
        'contract',
        'contract:CABC',
        'ledger:123',
        'event:resolved',
        'market:7',
      ])
    );
  });

  it('invalidates contract cache prefixes when a ledger event is published', async () => {
    const { invalidator, deleted, published } = createInvalidator();
    await invalidator.remember('prediction:9', ['market:9']);

    const result = await invalidator.invalidateForLedgerEvent({
      contractId: 'CABC',
      ledger: 50,
      topics: ['mkt_crt', 9],
    });

    expect(result.tags).toContain('contract:CABC');
    expect(CONTRACT_CACHE_PREFIXES.every((prefix) =>
      deleted.includes(`pattern:${prefix}`)
    )).toBe(true);
    expect(published[0].payload.reason).toBe('ledger-event');
  });

  it('batches ledger events and publishes a single invalidation message', async () => {
    const { invalidator, published } = createInvalidator();
    const summary = await invalidator.invalidateForLedgerEvents([
      { contractId: 'CA', ledger: 1, topics: ['bet', 1] },
      { contractId: 'CB', ledger: 2, topics: ['resolved', 2] },
    ]);

    expect(summary.count).toBe(2);
    expect(summary.tags).toEqual(
      expect.arrayContaining(['contract:CA', 'contract:CB'])
    );
    expect(published).toHaveLength(1);
    expect(published[0].payload.reason).toBe('ledger-batch');
  });

  it('drops local L1 entries when a remote pub/sub purge arrives', () => {
    const { invalidator, l1 } = createInvalidator();
    l1.set('contract:CABC:state', 1);
    invalidator.localKeyTags.set(
      'contract:CABC:state',
      new Set(['contract:CABC'])
    );
    invalidator.localTags.set(
      'contract:CABC',
      new Set(['contract:CABC:state'])
    );

    invalidator.applyRemoteInvalidation(
      JSON.stringify({
        tags: ['contract:CABC'],
        keys: ['contract:CABC:state'],
      })
    );

    expect(l1.has('contract:CABC:state')).toBe(false);
    expect(invalidator.stats.pubsubReceived).toBe(1);
  });
});
