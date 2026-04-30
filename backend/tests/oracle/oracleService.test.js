import {
  OracleService,
  OracleEvent,
} from '../../src/services/oracle/index.js';

describe('OracleService end-to-end', () => {
  it('reaches consensus and elects exactly one leader for a single proof', async () => {
    const svc = new OracleService({ nodeCount: 5, threshold: 3 });
    const proof = await svc.submitProofAndWait({ price: 100, asset: 'XLM' });
    expect(proof.status).toBe('submitted');
    expect(proof.leader).toBeTruthy();
    expect(proof.consensus.results[0].count).toBeGreaterThanOrEqual(3);
    // Exactly one node ended up as leader
    const leaderVotes = proof.votes.filter((v) => v.phase === 'leader');
    expect(leaderVotes).toHaveLength(1);
  });

  it('emits the full lifecycle event sequence', async () => {
    const svc = new OracleService({ nodeCount: 3, threshold: 2 });
    const events = [];
    svc.eventBus.on('*', (e) => events.push(e.event));

    await svc.submitProofAndWait({ msg: 'hello' });

    expect(events).toContain(OracleEvent.PROOF_RECEIVED);
    expect(events).toContain(OracleEvent.VOTE_CAST);
    expect(events).toContain(OracleEvent.QUORUM_REACHED);
    expect(events).toContain(OracleEvent.LEADER_ELECTED);
    expect(events).toContain(OracleEvent.PROOF_SUBMITTED);
  });

  it('emits LEADER_ELECTED exactly once per proof', async () => {
    const svc = new OracleService({ nodeCount: 7, threshold: 4 });
    let elections = 0;
    svc.eventBus.on(OracleEvent.LEADER_ELECTED, () => {
      elections += 1;
    });
    await svc.submitProofAndWait({ msg: 'x' });
    expect(elections).toBe(1);
  });

  it('uses a custom submitter when provided', async () => {
    const submitter = jest.fn(async ({ proofId, vote }) => ({ tx: `tx-${proofId}`, vote }));
    const svc = new OracleService({ nodeCount: 3, threshold: 2, submitter });
    const proof = await svc.submitProofAndWait({ payload: 'data' });
    expect(submitter).toHaveBeenCalledTimes(1); // only the leader submits
    expect(proof.result.tx).toMatch(/^tx-/);
  });

  it('processes 10 concurrent proofs without crossing wires', async () => {
    const svc = new OracleService({ nodeCount: 5, threshold: 3 });
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => svc.submitProofAndWait({ i }))
    );
    expect(results).toHaveLength(10);
    for (const proof of results) {
      expect(proof.status).toBe('submitted');
      expect(proof.votes.filter((v) => v.phase === 'leader')).toHaveLength(1);
    }
    // Every proofId must be unique
    const ids = new Set(results.map((p) => p.id));
    expect(ids.size).toBe(10);
  });

  it('reports no_quorum when nodes disagree past the threshold', async () => {
    // Two byzantine nodes return divergent votes; 3 honest nodes can still
    // reach quorum=3 with the default deterministic validator. Force a
    // split by overriding validators on enough nodes.
    const svc = new OracleService({ nodeCount: 4, threshold: 3 });
    let counter = 0;
    for (const node of svc.nodes) {
      const my = counter++;
      node.validate = () => ({ digest: `divergent-${my}` });
    }
    const proof = await svc.submitProofAndWait({ x: 1 });
    expect(proof.status).toBe('no_quorum');
    expect(proof.leader).toBeNull();
  });

  it('exposes node and health snapshots', async () => {
    const svc = new OracleService({ nodeCount: 4, threshold: 3 });
    const nodes = svc.listNodes();
    expect(nodes).toHaveLength(4);
    expect(nodes[0]).toHaveProperty('id');
    expect(nodes[0]).toHaveProperty('status', 'idle');
    const h = svc.health();
    expect(h.nodes).toBe(4);
    expect(h.threshold).toBe(3);
  });
});
