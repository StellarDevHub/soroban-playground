import {
  ConsensusCoordinator,
  LockManager,
  MemoryBackend,
  MemoryVoteStore,
  VoteSigner,
} from '../../src/services/oracle/index.js';

function makeCoordinator(backend, nodeId, { voteStore, voteSigner, weights } = {}) {
  const lockManager = new LockManager({ backend, nodeId });
  return new ConsensusCoordinator({ lockManager, voteStore, voteSigner, weights });
}

describe('ConsensusCoordinator', () => {
  it('counts votes and detects quorum', async () => {
    const co = makeCoordinator(new MemoryBackend(), 'n1');
    await co.registerVote('proof1', 'n1', { hash: 'AAA' });
    await co.registerVote('proof1', 'n2', { hash: 'AAA' });
    await co.registerVote('proof1', 'n3', { hash: 'BBB' });
    const q = await co.checkQuorum('proof1', 2);
    expect(q.reached).toBe(true);
    expect(q.vote).toEqual({ hash: 'AAA' });
    expect(q.count).toBe(2);
  });

  it('reports pending when quorum is not reached', async () => {
    const co = makeCoordinator(new MemoryBackend(), 'n1');
    await co.registerVote('proof1', 'n1', { v: 1 });
    expect((await co.checkQuorum('proof1', 3)).reached).toBe(false);
  });

  it('shares vote state across coordinators that share a VoteStore', async () => {
    const sharedStore = new MemoryVoteStore();
    const backend = new MemoryBackend();
    const a = makeCoordinator(backend, 'A', { voteStore: sharedStore });
    const b = makeCoordinator(backend, 'B', { voteStore: sharedStore });

    await a.registerVote('proofX', 'A', { v: 'yes' });
    await b.registerVote('proofX', 'B', { v: 'yes' });

    // Either coordinator should observe the shared tally.
    const tallyFromA = await a.tally('proofX');
    const tallyFromB = await b.tally('proofX');
    expect(tallyFromA.totalVotes).toBe(2);
    expect(tallyFromB.totalVotes).toBe(2);
  });

  it('elects exactly one leader across competing nodes', async () => {
    const backend = new MemoryBackend();
    const a = makeCoordinator(backend, 'A');
    const b = makeCoordinator(backend, 'B');
    const c = makeCoordinator(backend, 'C');

    const results = await Promise.all([
      a.electLeader('proofX'),
      b.electLeader('proofX'),
      c.electLeader('proofX'),
    ]);

    const leaders = results.filter((r) => r.isLeader);
    expect(leaders).toHaveLength(1);
    expect(results.filter((r) => !r.isLeader)).toHaveLength(2);
    await leaders[0].handle.release();
  });

  it('submitVoteAndMaybeLead returns leader once quorum is hit', async () => {
    const sharedStore = new MemoryVoteStore();
    const backend = new MemoryBackend();
    const a = makeCoordinator(backend, 'A', { voteStore: sharedStore });
    const b = makeCoordinator(backend, 'B', { voteStore: sharedStore });

    const r1 = await a.submitVoteAndMaybeLead({
      proofId: 'p',
      nodeId: 'A',
      vote: 'X',
      threshold: 2,
    });
    expect(r1.phase).toBe('pending');

    const r2 = await b.submitVoteAndMaybeLead({
      proofId: 'p',
      nodeId: 'B',
      vote: 'X',
      threshold: 2,
    });
    expect(r2.phase).toBe('leader');
    expect(r2.vote).toBe('X');
    await r2.handle.release();
  });

  it('rejects unsigned votes when signer is required', async () => {
    const signer = new VoteSigner({ keys: { A: 'secret-a' }, required: true });
    const co = makeCoordinator(new MemoryBackend(), 'A', { voteSigner: signer });
    await expect(co.registerVote('p', 'A', { v: 1 })).rejects.toThrow(/signature_required/);
  });

  it('accepts signed votes and rejects forgeries', async () => {
    const signer = new VoteSigner({ keys: { A: 'secret-a', B: 'secret-b' }, required: true });
    const co = makeCoordinator(new MemoryBackend(), 'A', { voteSigner: signer });
    const goodSig = signer.sign({ proofId: 'p', nodeId: 'A', vote: { v: 1 } });
    await expect(co.registerVote('p', 'A', { v: 1 }, goodSig)).resolves.toBeDefined();

    // Wrong vote (signature for { v:1 } applied to { v:2 })
    await expect(co.registerVote('p', 'A', { v: 2 }, goodSig)).rejects.toThrow(/bad_signature/);

    // Vote attributed to a node we have no key for
    await expect(co.registerVote('p', 'C', { v: 1 }, goodSig)).rejects.toThrow(/unknown_node/);
  });

  it('honors per-node weights when computing tallies', async () => {
    const co = makeCoordinator(new MemoryBackend(), 'A', {
      weights: { A: 5, B: 1, C: 1 },
    });
    await co.registerVote('p', 'A', 'YES');
    await co.registerVote('p', 'B', 'NO');
    await co.registerVote('p', 'C', 'NO');
    const q = await co.checkQuorum('p', 3);
    expect(q.reached).toBe(true);
    expect(q.vote).toBe('YES');
    expect(q.count).toBe(5);
  });

  it('forget() clears stored votes for a proof', async () => {
    const co = makeCoordinator(new MemoryBackend(), 'A');
    await co.registerVote('p', 'A', 'X');
    await co.forget('p');
    const tally = await co.tally('p');
    expect(tally.totalVotes).toBe(0);
  });
});
