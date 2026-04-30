// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// Single oracle node. Has its own LockManager (so per-node locks don't
// cross-contend) but shares the consensus coordinator (= shared vote
// store) with peers. validate(payload) must be deterministic so honest
// nodes converge on identical votes.

import crypto from 'crypto';

import { LockManager } from './lockManager.js';
import { LockScope } from './hierarchy.js';

// Default validator: deterministic SHA-256 of the canonical payload.
// Honest nodes will all produce the same digest; adversarial nodes can
// override `validate` per-node to test divergence.
function defaultValidate(payload) {
  const canonical = JSON.stringify(payload, Object.keys(payload || {}).sort());
  return {
    digest: crypto.createHash('sha256').update(canonical).digest('hex'),
  };
}

export class OracleNode {
  constructor({
    id,
    backend,
    consensusCoordinator,
    voteSigner,
    validate = defaultValidate,
    threshold,
    eventBus,
    auditLog,
    submitter,
  }) {
    if (!id) throw new Error('OracleNode requires an id');
    if (!backend) throw new Error('OracleNode requires a lock backend');
    if (!consensusCoordinator) throw new Error('OracleNode requires a ConsensusCoordinator');
    this.id = id;
    this.lockManager = new LockManager({
      backend,
      nodeId: id,
      auditLog,
    });
    this.consensus = consensusCoordinator;
    this.voteSigner = voteSigner;
    this.validate = validate;
    this.threshold = threshold;
    this.eventBus = eventBus;
    this.submitter = submitter; // async ({ proofId, vote, payload }) => any
    this.status = 'idle';
    this.processed = 0;
    this.lastProofAt = null;
  }

  // Process a single proof. Returns:
  //   { phase: 'pending' | 'follower' | 'leader' | 'rejected' | 'error',
  //     ... }
  async processProof(proofId, payload) {
    this.status = 'processing';
    this.lastProofAt = Date.now();

    let vote;
    try {
      vote = await this.validate(payload);
    } catch (err) {
      this.status = 'idle';
      this.eventBus?.publish('vote.rejected', {
        proofId,
        nodeId: this.id,
        reason: 'validation_failed',
        error: err.message,
      });
      return { phase: 'rejected', reason: 'validation_failed', error: err.message };
    }

    const signature = this.voteSigner ? this.voteSigner.sign({ proofId, nodeId: this.id, vote }) : null;

    let result;
    try {
      result = await this.consensus.submitVoteAndMaybeLead({
        proofId,
        nodeId: this.id,
        vote,
        signature,
        threshold: this.threshold,
      });
    } catch (err) {
      this.status = 'idle';
      this.eventBus?.publish('vote.rejected', {
        proofId,
        nodeId: this.id,
        reason: err.code || 'register_failed',
        error: err.message,
      });
      return { phase: 'rejected', reason: err.code || 'register_failed', error: err.message };
    }

    this.processed += 1;
    this.eventBus?.publish('vote.cast', {
      proofId,
      nodeId: this.id,
      vote,
      tally: result.tally,
    });

    if (result.phase === 'pending') {
      this.status = 'idle';
      return result;
    }

    // Quorum was reached on this vote — emit the once-per-proof event.
    if (result.phase === 'leader' || result.phase === 'follower') {
      this.eventBus?.publish('quorum.reached', {
        proofId,
        vote: result.vote,
        threshold: this.threshold,
        tally: result.tally,
      });
    }

    if (result.phase === 'follower') {
      this.status = 'idle';
      return result;
    }

    // We are the leader. Submit, then release the lock.
    this.eventBus?.publish('leader.elected', {
      proofId,
      nodeId: this.id,
      vote: result.vote,
    });
    try {
      const submission = this.submitter
        ? await this.submitter({ proofId, vote: result.vote, payload, nodeId: this.id })
        : { simulated: true };
      this.eventBus?.publish('proof.submitted', {
        proofId,
        nodeId: this.id,
        vote: result.vote,
        submission,
      });
      this.status = 'idle';
      return { ...result, submission };
    } catch (err) {
      this.eventBus?.publish('proof.failed', {
        proofId,
        nodeId: this.id,
        error: err.message,
      });
      this.status = 'error';
      return { ...result, submission: null, error: err.message };
    } finally {
      try {
        await result.handle.release();
      } catch {
        /* release errors already audited */
      }
    }
  }

  // Per-node "I'm processing this proof" lock — prevents one node from
  // processing the same proof twice concurrently. Used by OracleService
  // when a proof arrives while a previous run is still in flight.
  async tryClaimProof(proofId, ttlMs = 30_000) {
    try {
      return await this.lockManager.acquire({
        scope: LockScope.BATCH,
        id: `node-claim:${this.id}:${proofId}`,
        ttlMs,
        retry: { maxAttempts: 1 },
      });
    } catch {
      return null;
    }
  }

  snapshot() {
    return {
      id: this.id,
      status: this.status,
      processed: this.processed,
      lastProofAt: this.lastProofAt,
    };
  }
}
