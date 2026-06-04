// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// Optimistic CAS-style locking. Used when distributed locks are unavailable
// or when the call site prefers to retry on conflict instead of blocking.
// Each key carries a monotonically increasing version. A mutator reads the
// current version, performs its work, and only commits if the version is
// still what it read.

export class OptimisticStore {
  constructor() {
    this.versions = new Map(); // key -> { version: number, value: any }
  }

  read(key) {
    const entry = this.versions.get(key);
    if (!entry) return { version: 0, value: null };
    return { version: entry.version, value: entry.value };
  }

  // Returns { ok, version } — ok=false means another writer beat us.
  compareAndSet(key, expectedVersion, value) {
    const current = this.versions.get(key);
    const currentVersion = current ? current.version : 0;
    if (currentVersion !== expectedVersion) {
      return { ok: false, version: currentVersion };
    }
    const next = currentVersion + 1;
    this.versions.set(key, { version: next, value });
    return { ok: true, version: next };
  }

  // Run mutator with retries. mutator: (currentValue) => newValue
  async withCas(key, mutator, { maxAttempts = 5 } = {}) {
    let attempt = 0;
    while (attempt < maxAttempts) {
      attempt += 1;
      const { version, value } = this.read(key);
      const next = await mutator(value);
      const result = this.compareAndSet(key, version, next);
      if (result.ok)
        return { value: next, version: result.version, attempts: attempt };
    }
    const err = new Error(
      `Optimistic CAS failed after ${maxAttempts} attempts on key ${key}`
    );
    err.code = 'CAS_EXHAUSTED';
    throw err;
  }
}

export const sharedOptimisticStore = new OptimisticStore();
