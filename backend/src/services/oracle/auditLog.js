// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// Append-only ring buffer of lock events. Bounded so a long-running process
// doesn't grow unbounded; consumers can drain or stream events out of band.

export class AuditLog {
  constructor({ capacity = 1000, sink = null, now = () => Date.now() } = {}) {
    this.capacity = capacity;
    this.entries = [];
    this.sink = sink; // optional async (entry) => void for external persistence
    this.now = now;
    this.sequence = 0;
  }

  record(event, payload = {}) {
    this.sequence += 1;
    const entry = {
      seq: this.sequence,
      ts: this.now(),
      event,
      ...payload,
    };
    this.entries.push(entry);
    if (this.entries.length > this.capacity) {
      this.entries.splice(0, this.entries.length - this.capacity);
    }
    if (this.sink) {
      // fire-and-forget; failures here must not break lock semantics
      Promise.resolve()
        .then(() => this.sink(entry))
        .catch(() => {});
    }
    return entry;
  }

  recent(limit = 100) {
    if (limit >= this.entries.length) return [...this.entries];
    return this.entries.slice(-limit);
  }

  filter(predicate) {
    return this.entries.filter(predicate);
  }

  clear() {
    this.entries.length = 0;
  }
}

export const sharedAuditLog = new AuditLog();
