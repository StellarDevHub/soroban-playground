import { MemoryVoteStore } from '../../src/services/oracle/voteStore.js';

describe('MemoryVoteStore', () => {
  it('stores and tallies votes per proof', async () => {
    const s = new MemoryVoteStore();
    await s.put('p1', 'A', { v: 1 });
    await s.put('p1', 'B', { v: 1 });
    await s.put('p1', 'C', { v: 2 });
    const tally = await s.tally('p1');
    expect(tally.totalVotes).toBe(3);
    expect(tally.results[0]).toEqual({ vote: { v: 1 }, count: 2 });
    expect(tally.results[1]).toEqual({ vote: { v: 2 }, count: 1 });
  });

  it('overwrites a node revoting on the same proof', async () => {
    const s = new MemoryVoteStore();
    await s.put('p1', 'A', { v: 1 });
    await s.put('p1', 'A', { v: 2 });
    const tally = await s.tally('p1');
    expect(tally.totalVotes).toBe(1);
    expect(tally.results[0].vote).toEqual({ v: 2 });
  });

  it('expires votes after the configured TTL', async () => {
    let now = 0;
    const s = new MemoryVoteStore({ defaultTtlMs: 1000, now: () => now });
    await s.put('p1', 'A', { v: 1 });
    expect((await s.tally('p1')).totalVotes).toBe(1);
    now = 2000;
    expect((await s.tally('p1')).totalVotes).toBe(0);
  });

  it('forget() drops a single proof without affecting others', async () => {
    const s = new MemoryVoteStore();
    await s.put('p1', 'A', 1);
    await s.put('p2', 'A', 1);
    await s.forget('p1');
    expect((await s.tally('p1')).totalVotes).toBe(0);
    expect((await s.tally('p2')).totalVotes).toBe(1);
  });

  it('listProofs() returns active (non-expired) proof ids', async () => {
    const s = new MemoryVoteStore();
    await s.put('p1', 'A', 1);
    await s.put('p2', 'B', 1);
    const ids = await s.listProofs();
    expect(ids.sort()).toEqual(['p1', 'p2']);
  });
});
