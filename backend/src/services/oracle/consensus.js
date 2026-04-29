// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// Lock-coordinated consensus for oracle submissions.
//
// Pipeline:
//   1. Each oracle node calls registerVote(proofId, nodeId, vote, signature?).
//      Votes go through a pluggable VoteStore (memory or Redis) so all
//      coordinators in the cluster see the same tally.
//   2. checkQuorum(proofId, threshold) returns true once `threshold` nodes
//      have submitted matching votes (with optional weighting).
//   3. The first node to acquire the per-proof submission lock becomes the
//      leader. All others get isLeader=false and back off.
//
// Vote authenticity is delegated to a VoteSigner. If `voteSigner.required`
// is true, unsigned/invalid votes are rejected at registerVote time.
// Per-proof TTL on votes prevents stale state from accumulating.

import { LockScope } from './hierarchy.js';
import { consensusElectionsTotal } from './lockMetrics.js';
import { sharedAuditLog } from './auditLog.js';
import { MemoryVoteStore } from './voteStore.js';
import { VoteSigner } from './voteSigner.js';

const SUBMISSION_LOCK_TTL_MS = 60_000;

export class ConsensusCoordinator {
  constructor({
    lockManager,
    voteStore,
    voteSigner,
    weights,
    auditLog = sharedAuditLog,
    voteTtlMs,
  } = {}) {
    if (!lockManager)
      throw new Error('ConsensusCoordinator requires a lockManager');
    this.lockManager = lockManager;
    this.voteStore =
      voteStore ||
      new MemoryVoteStore({ defaultTtlMs: voteTtlMs ?? 5 * 60_000 });
    this.voteSigner = voteSigner || new VoteSigner({ required: false });
    this.weights = weights || null; // optional Map<nodeId, number> or plain object
    this.audit = auditLog;
    this.voteTtlMs = voteTtlMs;
  }

  _weightOf(nodeId) {
    if (!this.weights) return 1;
    if (this.weights instanceof Map) return this.weights.get(nodeId) ?? 1;
    return this.weights[nodeId] ?? 1;
  }

  async registerVote(proofId, nodeId, vote, signature) {
    const verification = this.voteSigner.verify({
      proofId,
      nodeId,
      vote,
      signature,
    });
    if (!verification.ok) {
      this.audit.record('consensus.vote_rejected', {
        proofId,
        nodeId,
        reason: verification.reason,
      });
      const err = new Error(`Vote rejected: ${verification.reason}`);
      err.code = 'INVALID_VOTE';
      throw err;
    }
    await this.voteStore.put(proofId, nodeId, vote, signature, this.voteTtlMs);
    this.audit.record('consensus.vote_recorded', { proofId, nodeId });
    return this.tally(proofId);
  }

  async tally(proofId) {
    const votes = await this.voteStore.get(proofId);
    const counts = new Map();
    let totalWeight = 0;
    for (const [nodeId, env] of votes) {
      const w = this._weightOf(nodeId);
      totalWeight += w;
      const k = JSON.stringify(env.vote);
      counts.set(k, (counts.get(k) || 0) + w);
    }
    const results = [...counts.entries()]
      .map(([k, count]) => ({ vote: JSON.parse(k), count }))
      .sort((a, b) => b.count - a.count);
    return { totalVotes: votes.size, totalWeight, results };
  }

  // Returns { reached, vote, count } or { reached: false, leadingVote, leadingCount }.
  async checkQuorum(proofId, threshold) {
    const { results } = await this.tally(proofId);
    if (results.length === 0) return { reached: false };
    const top = results[0];
    if (top.count >= threshold) {
      return { reached: true, vote: top.vote, count: top.count };
    }
    return { reached: false, leadingVote: top.vote, leadingCount: top.count };
  }

  // Try to become the submitter for `proofId`. Returns
  //   { isLeader: true, handle } if this node won the lock
  //   { isLeader: false, reason } otherwise
  async electLeader(proofId, { ttlMs = SUBMISSION_LOCK_TTL_MS, retry } = {}) {
    try {
      const handle = await this.lockManager.acquire({
        scope: LockScope.BATCH,
        id: `submit:${proofId}`,
        ttlMs,
        retry: retry || { maxAttempts: 1 },
        metadata: { purpose: 'consensus.submission', proofId },
      });
      consensusElectionsTotal.inc({ outcome: 'won' });
      this.audit.record('consensus.leader_elected', {
        proofId,
        nodeId: this.lockManager.nodeId,
        owner: handle.owner,
      });
      return { isLeader: true, handle };
    } catch (err) {
      if (err.code === 'LOCK_TIMEOUT' || err.code === 'DEADLOCK') {
        consensusElectionsTotal.inc({ outcome: 'lost' });
        return { isLeader: false, reason: err.code };
      }
      consensusElectionsTotal.inc({ outcome: 'error' });
      throw err;
    }
  }

  // Combined: register a vote, check quorum, attempt to become leader.
  async submitVoteAndMaybeLead({
    proofId,
    nodeId,
    vote,
    signature,
    threshold,
  }) {
    await this.registerVote(proofId, nodeId, vote, signature);
    const quorum = await this.checkQuorum(proofId, threshold);
    if (!quorum.reached) {
      return { phase: 'pending', tally: await this.tally(proofId) };
    }
    const election = await this.electLeader(proofId);
    if (election.isLeader) {
      return {
        phase: 'leader',
        tally: await this.tally(proofId),
        vote: quorum.vote,
        handle: election.handle,
      };
    }
    return {
      phase: 'follower',
      tally: await this.tally(proofId),
      vote: quorum.vote,
      reason: election.reason,
    };
  }

  async forget(proofId) {
    await this.voteStore.forget(proofId);
  }
}
