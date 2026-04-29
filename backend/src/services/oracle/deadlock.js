// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// Wait-for graph deadlock detector.
//
// The graph tracks "owner X is waiting for resource currently held by owner Y".
// We collapse this to a direct edge X -> Y. A cycle in this graph means
// every owner in the cycle is blocked forever — a deadlock. The detector
// runs DFS from the new edge's source on each declareWait() call so we
// detect immediately rather than on a poll.

import { deadlocksDetectedTotal } from './lockMetrics.js';

export class DeadlockDetector {
  constructor() {
    // owner -> Set<owner>  (this owner is waiting for these owners)
    this.waitsFor = new Map();
    // resource key -> owner currently holding it
    this.holders = new Map();
  }

  registerHold(key, owner) {
    this.holders.set(key, owner);
  }

  releaseHold(key, owner) {
    const current = this.holders.get(key);
    if (current === owner) {
      this.holders.delete(key);
    }
  }

  // Returns { deadlock: false } on success, or
  //         { deadlock: true, cycle: [...] } if adding this wait would
  // close a cycle (in which case the wait is NOT recorded).
  declareWait(waiter, key) {
    const target = this.holders.get(key);
    if (!target || target === waiter) return { deadlock: false };

    // Probe: would adding waiter -> target create a cycle?
    if (this._reachable(target, waiter)) {
      deadlocksDetectedTotal.inc();
      const cycle = this._reconstructCycle(target, waiter);
      cycle.unshift(waiter);
      return { deadlock: true, cycle };
    }

    if (!this.waitsFor.has(waiter)) this.waitsFor.set(waiter, new Set());
    this.waitsFor.get(waiter).add(target);
    return { deadlock: false };
  }

  clearWait(waiter, key) {
    const target = this.holders.get(key);
    if (!target) {
      // unknown target — clear all waits for this waiter to be safe
      this.waitsFor.delete(waiter);
      return;
    }
    const set = this.waitsFor.get(waiter);
    if (!set) return;
    set.delete(target);
    if (set.size === 0) this.waitsFor.delete(waiter);
  }

  // Forget everything an owner cared about — used after a release/crash.
  forgetOwner(owner) {
    this.waitsFor.delete(owner);
    for (const [k, v] of this.holders) {
      if (v === owner) this.holders.delete(k);
    }
    for (const [w, set] of this.waitsFor) {
      set.delete(owner);
      if (set.size === 0) this.waitsFor.delete(w);
    }
  }

  // Is `to` reachable from `from` via current waits-for edges?
  _reachable(from, to) {
    const visited = new Set();
    const stack = [from];
    while (stack.length) {
      const node = stack.pop();
      if (node === to) return true;
      if (visited.has(node)) continue;
      visited.add(node);
      const next = this.waitsFor.get(node);
      if (!next) continue;
      for (const n of next) stack.push(n);
    }
    return false;
  }

  // BFS path from `from` to `to` for diagnostic output.
  _reconstructCycle(from, to) {
    const parents = new Map();
    const queue = [from];
    parents.set(from, null);
    while (queue.length) {
      const node = queue.shift();
      if (node === to) break;
      const next = this.waitsFor.get(node);
      if (!next) continue;
      for (const n of next) {
        if (parents.has(n)) continue;
        parents.set(n, node);
        queue.push(n);
      }
    }
    if (!parents.has(to)) return [from, to];
    const path = [];
    let cur = to;
    while (cur !== null) {
      path.unshift(cur);
      cur = parents.get(cur);
    }
    return path;
  }

  snapshot() {
    return {
      holders: [...this.holders.entries()].map(([key, owner]) => ({ key, owner })),
      waits: [...this.waitsFor.entries()].map(([owner, set]) => ({
        owner,
        waitingFor: [...set],
      })),
    };
  }
}

export const sharedDeadlockDetector = new DeadlockDetector();
