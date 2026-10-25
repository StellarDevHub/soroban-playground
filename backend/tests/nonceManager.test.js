import {
  NonceManager,
  createNonceManager,
  ADVANCE_KEY_LUA,
} from '../src/services/stellar/nonceManager.ts';
import { nonceManagerRegistry } from '../src/services/stellar/nonceMetrics.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const RELAYERS = Array.from({ length: 10 }, (_, i) => `GRELAYER${i}TESTNET`);

/** Minimal in-memory Redis implementing exactly what the manager uses. */
function createFakeRedis({ latencyMs = 0, failures = 0 } = {}) {
  const store = new Map();
  let calls = 0;

  async function guard() {
    calls += 1;
    if (latencyMs > 0) await sleep(latencyMs);
    if (calls <= failures) throw new Error('redis unavailable');
  }

  return {
    store,
    get calls() {
      return calls;
    },
    async incr(key) {
      await guard();
      const next = BigInt(store.get(key) ?? '0') + 1n;
      store.set(key, next.toString());
      return Number(next);
    },
    async eval(script, numberOfKeys, ...args) {
      await guard();
      if (script !== ADVANCE_KEY_LUA || numberOfKeys !== 1) {
        throw new Error('unexpected redis script');
      }
      const [key, wanted] = args;
      const current = store.has(key) ? BigInt(store.get(key)) : null;
      const target = BigInt(wanted);
      if (current === null || target > current) {
        store.set(key, target.toString());
      }
      return Number(store.get(key));
    },
  };
}

async function poll(check, timeoutMs = 500, stepMs = 10) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await sleep(stepMs);
  }
  return check();
}

describe('NonceManager', () => {
  let manager = null;

  afterEach(() => {
    if (manager) manager.close();
    manager = null;
  });

  test('seeds every relayer account from the chain on init', async () => {
    manager = createNonceManager({
      accounts: RELAYERS,
      fetchSequence: async (accountId) =>
        BigInt(RELAYERS.indexOf(accountId)) + 1000n,
    });
    await manager.init();

    const stats = manager.stats();
    expect(stats).toHaveLength(10);
    expect(stats.every((s) => s.initialized)).toBe(true);
    expect(stats.map((s) => s.onChainSequence)).toEqual(
      RELAYERS.map((_, i) => String(1000n + BigInt(i)))
    );
    expect(stats.every((s) => s.activeReservations === 0)).toBe(true);
  });

  test('rejects an empty pool or a missing fetch function', () => {
    expect(
      () => new NonceManager({ accounts: [], fetchSequence: async () => 0 })
    ).toThrow();
    expect(
      () => new NonceManager({ accounts: RELAYERS, fetchSequence: null })
    ).toThrow();
  });

  test('rotates reservations round-robin across the 10-account pool', async () => {
    manager = new NonceManager({
      accounts: RELAYERS,
      fetchSequence: async () => 100n,
    });
    await manager.init();

    const reservations = [];
    for (let i = 0; i < 30; i += 1) {
      reservations.push(await manager.reserve());
    }

    const order = reservations.map((r) => r.accountId);
    RELAYERS.forEach((accountId, i) => {
      const used = order.filter((id) => id === accountId);
      expect(used).toHaveLength(3);
      expect(order[i]).toBe(accountId);
    });
  });

  test('1000 parallel reservations produce zero duplicates and zero gaps', async () => {
    manager = new NonceManager({
      accounts: RELAYERS,
      fetchSequence: async () => 1000,
    });
    await manager.init();

    const reservations = await Promise.all(
      Array.from({ length: 1000 }, () => manager.reserve())
    );

    const sequences = reservations.map((r) => r.sequence);
    expect(sequences).toHaveLength(1000);

    // Sequence numbers are per account: each account hands out a contiguous
    // block starting at 1001 with no duplicates and no gaps.
    const byAccount = new Map();
    reservations.forEach((r) => {
      const list = byAccount.get(r.accountId) ?? [];
      list.push(r.sequence);
      byAccount.set(r.accountId, list);
    });
    expect(byAccount.size).toBe(10);
    byAccount.forEach((list) => {
      expect(new Set(list.map(String)).size).toBe(100);
      const sorted = [...list].sort((a, b) => (a < b ? -1 : 1));
      expect(sorted).toHaveLength(100);
      sorted.forEach((sequence, index) => {
        expect(sequence).toBe(1001n + BigInt(index));
      });
    });

    reservations.forEach((r) => r.commit());
    const stats = manager.stats();
    expect(stats.every((s) => s.activeReservations === 0)).toBe(true);
    expect(stats.every((s) => s.freeSequences === 0)).toBe(true);
  });

  test('reuses released sequences so bursts leave no permanent gaps', async () => {
    manager = new NonceManager({
      accounts: RELAYERS,
      fetchSequence: async () => 500,
    });
    await manager.init();

    const first = await Promise.all(
      Array.from({ length: 100 }, () => manager.reserve())
    );
    const released = new Set();
    const releasedPerAccount = new Map();
    first.forEach((r) => {
      const held = releasedPerAccount.get(r.accountId) ?? 0;
      if (held < 5) {
        // Return half of every account's sequences to its free list.
        r.release();
        released.add(`${r.accountId}:${r.sequence}`);
        releasedPerAccount.set(r.accountId, held + 1);
      } else {
        r.commit();
      }
    });

    expect(manager.stats().reduce((sum, s) => sum + s.freeSequences, 0)).toBe(
      50
    );

    const reused = await Promise.all(
      Array.from({ length: 50 }, () => manager.reserve())
    );
    const reusedPairs = reused.map((r) => `${r.accountId}:${r.sequence}`);
    expect(new Set(reusedPairs).size).toBe(50);
    reusedPairs.forEach((pair) => expect(released.has(pair)).toBe(true));
    expect(manager.stats().reduce((sum, s) => sum + s.freeSequences, 0)).toBe(
      0
    );
    expect(
      manager.stats().reduce((sum, s) => sum + s.activeReservations, 0)
    ).toBe(50);
  });

  test('benchmark: >250 tx/s across the pool for 1000 parallel signings', async () => {
    const redis = createFakeRedis({ latencyMs: 1 });
    manager = new NonceManager({
      accounts: RELAYERS,
      fetchSequence: async () => {
        await sleep(2);
        return 5000;
      },
      redis,
      reservationTtlMs: 60_000,
    });
    await manager.init();

    const started = Date.now();
    const reservations = await Promise.all(
      Array.from({ length: 1000 }, async () => {
        const reservation = await manager.reserve();
        await sleep(2); // simulated signing latency
        reservation.commit();
        return reservation;
      })
    );
    const elapsedMs = Date.now() - started;
    const throughput = (reservations.length / elapsedMs) * 1000;

    const perAccount = new Map();
    reservations.forEach((r) => {
      const set = perAccount.get(r.accountId) ?? new Set();
      set.add(String(r.sequence));
      perAccount.set(r.accountId, set);
    });
    expect(perAccount.size).toBe(10);
    perAccount.forEach((set) => expect(set.size).toBe(100));
    expect(throughput).toBeGreaterThan(250);
    expect(elapsedMs).toBeLessThan(4000);
  });

  test('auto-releases a reservation after its timeout and reuses it', async () => {
    manager = new NonceManager({
      accounts: ['GSOLOTESTNET'],
      fetchSequence: async () => 42n,
      reservationTtlMs: 40,
    });

    const first = await manager.reserve();
    expect(first.sequence).toBe(43n);

    await sleep(80);

    const stats = manager.stats()[0];
    expect(stats.activeReservations).toBe(0);
    expect(stats.freeSequences).toBe(1);

    const second = await manager.reserve();
    expect(second.sequence).toBe(43n);
    expect(manager.stats()[0].freeSequences).toBe(0);
  });

  test('returns the sequence to the free list when submission fails', async () => {
    manager = new NonceManager({
      accounts: ['GSOLOTESTNET'],
      fetchSequence: async () => 10,
    });

    const first = await manager.reserve();
    expect(first.sequence).toBe(11n);
    first.fail(new Error('connection reset while submitting'));

    const stats = manager.stats()[0];
    expect(stats.activeReservations).toBe(0);
    expect(stats.freeSequences).toBe(1);

    const second = await manager.reserve();
    expect(second.sequence).toBe(11n);
  });

  test('txBAD_SEQ triggers a non-blocking resync that lands within 500ms', async () => {
    let chainSequence = 100n;
    manager = new NonceManager({
      accounts: ['GSOLOTESTNET'],
      fetchSequence: async () => {
        await sleep(200); // simulated high network latency
        return chainSequence;
      },
      redis: null,
    });
    await manager.init();

    const stale = await manager.reserve();
    expect(stale.sequence).toBe(101n);

    // Another actor advanced the on-chain sequence while we held ours.
    chainSequence = 150n;
    stale.fail(new Error('txBAD_SEQ: sequence number is too low'));

    const started = Date.now();
    const during = await manager.reserve();
    const reserveMs = Date.now() - started;
    during.release();

    // Reservations must not wait for the slow resync.
    expect(during.sequence).toBeDefined();
    expect(reserveMs).toBeLessThan(150);

    const recovered = await poll(() => {
      const stats = manager.stats()[0];
      return stats.onChainSequence === '150' && stats.lastAllocated === '150';
    }, 500);
    expect(recovered).toBe(true);

    const stats = manager.stats()[0];
    expect(stats.freeSequences).toBe(0);
    expect(stats.activeReservations).toBe(0);
  });

  test('falls back to the memory mirror on Redis failure and recovers', async () => {
    const redis = createFakeRedis({ failures: 2 });
    manager = new NonceManager({
      accounts: ['GSOLOTESTNET'],
      fetchSequence: async () => 700,
      redis,
      redisRetryIntervalMs: 40,
    });
    await manager.init();

    const first = await manager.reserve();
    expect(first.sequence).toBe(701n);
    first.commit();

    const degraded = manager.stats()[0];
    expect(degraded.degraded).toBe(true);
    expect(degraded.lastAllocated).toBe('701');

    const recovered = await poll(() => {
      const stats = manager.stats()[0];
      const key = 'stellar:nonce:GSOLOTESTNET';
      const remote = redis.store.has(key) ? BigInt(redis.store.get(key)) : 0n;
      return stats.degraded === false && remote >= BigInt(stats.lastAllocated);
    }, 500);
    expect(recovered).toBe(true);

    const after = await manager.reserve();
    expect(after.sequence).toBe(702n);
    expect(redis.store.get('stellar:nonce:GSOLOTESTNET')).toBe('702');
  });

  test('exposes Prometheus metrics for depths, reservations and errors', async () => {
    const redis = createFakeRedis({ failures: 1 });
    manager = new NonceManager({
      accounts: RELAYERS,
      fetchSequence: async () => 10,
      redis,
      redisRetryIntervalMs: 20,
    });
    await manager.init();

    const reserved = await Promise.all(
      Array.from({ length: 20 }, () => manager.reserve())
    );
    reserved.forEach((r, i) => {
      if (i % 3 === 0) r.release();
      else r.commit();
    });
    await manager.resyncAccount(RELAYERS[0]);

    const text = await nonceManagerRegistry.metrics();
    [
      'stellar_nonce_reservations_total',
      'stellar_nonce_sequence_depth',
      'stellar_nonce_active_reservations',
      'stellar_nonce_free_sequences',
      'stellar_nonce_errors_total',
      'stellar_nonce_resync_total',
      'stellar_nonce_reserve_latency_seconds',
    ].forEach((metric) => {
      expect(text).toContain(metric);
    });
    expect(text).toContain('outcome="committed"');
    expect(text).toContain('outcome="released"');
    expect(text).toMatch(
      /stellar_nonce_resync_total\{account="[^"]+",outcome="success"/
    );
  });
});
