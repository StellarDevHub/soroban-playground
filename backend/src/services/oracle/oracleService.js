// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// OracleService — orchestrates N simulated oracle nodes in one process.
//
// Wire-up:
//   - One shared lock backend (memory or redis) so leader-election works.
//   - One shared VoteStore so all nodes see the same tally.
//   - One shared VoteSigner (per-node HMAC keys) for vote authenticity.
//   - One shared ConsensusCoordinator (per coordinator instance is fine
//     — they all read the same VoteStore and use the same lockManager
//     for leader election).
//
// Lifecycle of a proof:
//   submitProof(payload) → fan out validate-and-vote across all nodes
//   in parallel → first node to hit quorum elects itself leader and
//   "submits" → all others become followers → state recorded.
//
// "Submission" is pluggable. Default: log + emit event. Real deployments
// inject a Stellar transaction submitter.

import crypto from 'crypto';

import { ConsensusCoordinator } from './consensus.js';
import { LockManager } from './lockManager.js';
import { LockScope } from './hierarchy.js';
import { MemoryBackend } from './backends.js';
import { MemoryVoteStore } from './voteStore.js';
import { VoteSigner } from './voteSigner.js';
import { OracleNode } from './oracleNode.js';
import { OracleEvent, sharedOracleEventBus } from './oracleEvents.js';
import { sharedAuditLog } from './auditLog.js';

const DEFAULT_NODE_COUNT = 5;
const DEFAULT_THRESHOLD = 3;
const DEFAULT_PROOF_TTL_MS = 5 * 60_000;

function newProofId() {
  return crypto.randomBytes(8).toString('hex');
}

export class OracleService {
  constructor({
    nodeCount = DEFAULT_NODE_COUNT,
    threshold = DEFAULT_THRESHOLD,
    backend,
    voteStore,
    voteSigner,
    eventBus = sharedOracleEventBus,
    auditLog = sharedAuditLog,
    submitter,
    nodeIds, // optional explicit array of node ids (overrides nodeCount)
    requireSignedVotes = true,
    proofRetention = 100, // keep last N proofs in memory for status queries
  } = {}) {
    if (threshold > nodeCount && !nodeIds) {
      throw new Error(
        `threshold (${threshold}) cannot exceed nodeCount (${nodeCount})`
      );
    }
    this.backend = backend || new MemoryBackend();
    this.voteStore =
      voteStore || new MemoryVoteStore({ defaultTtlMs: DEFAULT_PROOF_TTL_MS });
    this.eventBus = eventBus;
    this.audit = auditLog;
    this.submitter = submitter;
    this.threshold = threshold;
    this.proofRetention = proofRetention;
    this.proofs = new Map(); // proofId -> proof state
    this.proofOrder = []; // FIFO of proofIds for retention pruning

    const ids =
      nodeIds || Array.from({ length: nodeCount }, (_, i) => `oracle-${i + 1}`);
    this.voteSigner =
      voteSigner ||
      new VoteSigner({
        keys: Object.fromEntries(
          ids.map((id) => [id, crypto.randomBytes(32).toString('hex')])
        ),
        required: requireSignedVotes,
      });

    // Shared coordinator — created with a lockManager backed by the
    // shared backend; nodeId here is purely for audit-log attribution.
    const coordinatorLockManager = new LockManager({
      backend: this.backend,
      nodeId: 'oracle-coordinator',
      auditLog,
    });
    this.consensus = new ConsensusCoordinator({
      lockManager: coordinatorLockManager,
      voteStore: this.voteStore,
      voteSigner: this.voteSigner,
      auditLog,
      voteTtlMs: DEFAULT_PROOF_TTL_MS,
    });

    this.nodes = ids.map(
      (id) =>
        new OracleNode({
          id,
          backend: this.backend,
          consensusCoordinator: this.consensus,
          voteSigner: this.voteSigner,
          threshold,
          eventBus,
          auditLog,
          submitter: this.submitter,
        })
    );
  }

  _trackProof(proof) {
    this.proofs.set(proof.id, proof);
    this.proofOrder.push(proof.id);
    while (this.proofOrder.length > this.proofRetention) {
      const evicted = this.proofOrder.shift();
      this.proofs.delete(evicted);
      this.consensus.forget(evicted).catch(() => {});
    }
  }

  // Submit a new proof. Returns immediately with the proofId; processing
  // happens asynchronously and progress is observable via getProof() or
  // events on the bus.
  async submitProof(payload, { metadata } = {}) {
    const proofId = newProofId();
    const proof = {
      id: proofId,
      payload,
      metadata: metadata || null,
      status: 'voting',
      submittedAt: Date.now(),
      votes: [],
      consensus: null,
      leader: null,
      result: null,
      error: null,
    };
    this._trackProof(proof);
    this.eventBus.publish(OracleEvent.PROOF_RECEIVED, {
      proofId,
      payload,
      metadata,
    });

    // Fire-and-forget node fan-out. We collect results to populate proof
    // state, but the HTTP caller doesn't wait for it.
    this._runProof(proof).catch((err) => {
      proof.status = 'failed';
      proof.error = err.message;
      this.eventBus.publish(OracleEvent.PROOF_FAILED, {
        proofId,
        error: err.message,
      });
    });
    return proof;
  }

  // Same as submitProof but awaits completion. Useful for tests and
  // for callers that want a synchronous response.
  async submitProofAndWait(payload, opts = {}) {
    const proof = await this.submitProof(payload, opts);
    await this._waitFor(proof.id, ['submitted', 'failed', 'no_quorum']);
    return this.getProof(proof.id);
  }

  async _runProof(proof) {
    const nodeResults = await Promise.allSettled(
      this.nodes.map((n) => n.processProof(proof.id, proof.payload))
    );

    proof.votes = nodeResults.map((r, i) => ({
      nodeId: this.nodes[i].id,
      ok: r.status === 'fulfilled',
      phase: r.status === 'fulfilled' ? r.value.phase : 'rejected',
      error: r.status === 'rejected' ? r.reason?.message : r.value?.error,
    }));

    const leaderResult = nodeResults.find(
      (r) => r.status === 'fulfilled' && r.value.phase === 'leader'
    );
    if (leaderResult) {
      proof.status = 'submitted';
      proof.leader = leaderResult.value.handle?.owner ?? null;
      proof.consensus = leaderResult.value.tally;
      proof.result = leaderResult.value.submission ?? null;
    } else {
      // No leader — either no quorum, or all nodes were rejected.
      const tally = await this.consensus.tally(proof.id);
      proof.consensus = tally;
      const anyRejected = nodeResults.some(
        (r) => r.status === 'fulfilled' && r.value.phase === 'rejected'
      );
      proof.status =
        tally.totalVotes === 0 && anyRejected ? 'failed' : 'no_quorum';
    }
  }

  // Internal helper for submitProofAndWait()
  _waitFor(proofId, terminalStatuses, timeoutMs = 10_000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        const proof = this.proofs.get(proofId);
        if (!proof) return resolve();
        if (terminalStatuses.includes(proof.status)) return resolve();
        if (Date.now() - start > timeoutMs) {
          return reject(
            new Error(`Proof ${proofId} did not complete within ${timeoutMs}ms`)
          );
        }
        setTimeout(check, 5);
      };
      check();
    });
  }

  getProof(proofId) {
    return this.proofs.get(proofId) || null;
  }

  listProofs({ limit = 50 } = {}) {
    const ids = this.proofOrder.slice(-limit).reverse();
    return ids.map((id) => this.proofs.get(id)).filter(Boolean);
  }

  listNodes() {
    return this.nodes.map((n) => n.snapshot());
  }

  health() {
    return {
      backend: this.backend.name,
      voteStore: this.voteStore.name,
      nodes: this.nodes.length,
      threshold: this.threshold,
      processedProofs: this.proofOrder.length,
      activeProofs: this.listProofs({ limit: this.proofRetention }).filter(
        (p) => ['voting'].includes(p.status)
      ).length,
    };
  }
}

let singleton = null;

export function getOracleService(opts) {
  if (!singleton) singleton = new OracleService(opts);
  return singleton;
}

export function resetOracleServiceForTests() {
  singleton = null;
}

export { OracleEvent };
