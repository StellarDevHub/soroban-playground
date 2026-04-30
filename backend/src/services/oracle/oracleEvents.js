// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// Tiny event bus for oracle lifecycle events. Decoupled from the WebSocket
// layer so the OracleService can stay transport-agnostic.

import { EventEmitter } from 'events';

export const OracleEvent = Object.freeze({
  PROOF_RECEIVED: 'proof.received',
  VOTE_CAST: 'vote.cast',
  VOTE_REJECTED: 'vote.rejected',
  QUORUM_REACHED: 'quorum.reached',
  LEADER_ELECTED: 'leader.elected',
  PROOF_SUBMITTED: 'proof.submitted',
  PROOF_FAILED: 'proof.failed',
  NODE_STATUS: 'node.status',
});

export class OracleEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(64);
  }

  publish(event, payload) {
    this.emit(event, { event, ts: Date.now(), ...payload });
    this.emit('*', { event, ts: Date.now(), ...payload });
  }
}

export const sharedOracleEventBus = new OracleEventBus();
