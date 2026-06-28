// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * In-memory nonce pool for a single Stellar source account.
 * Tracks the current sequence number and hands out increments
 * atomically so concurrent batch submissions never produce
 * duplicate sequence numbers.
 */
export class NoncePool {
  #sourceAccount;
  #sequence;
  #fetchFn;
  #pending = new Map(); // sequenceNumber → resolve
  #initialized = false;

  /**
   * @param {string} sourceAccount - Stellar account G-address
   * @param {function(string): Promise<string>} fetchFn - returns the
   *   current sequence number string for the given account
   */
  constructor(sourceAccount, fetchFn) {
    this.#sourceAccount = sourceAccount;
    this.#fetchFn = fetchFn;
  }

  async #ensureInitialized() {
    if (this.#initialized) return;
    const seq = await this.#fetchFn(this.#sourceAccount);
    this.#sequence = BigInt(seq);
    this.#initialized = true;
  }

  /** Acquire the next sequence number. Call release() when the tx is submitted. */
  async acquire() {
    await this.#ensureInitialized();
    const seq = ++this.#sequence;
    return seq;
  }

  /** Resync sequence from the ledger (e.g. after a submission failure). */
  async resync() {
    const seq = await this.#fetchFn(this.#sourceAccount);
    this.#sequence = BigInt(seq);
  }

  get currentSequence() {
    return this.#sequence;
  }
}

/**
 * Registry that maps source accounts to their NoncePool instances.
 * Re-uses existing pools so all callers sharing a source account
 * coordinate via the same pool.
 */
export class NoncePoolRegistry {
  #pools = new Map();
  #fetchFn;

  constructor(fetchFn) {
    this.#fetchFn = fetchFn;
  }

  getPool(sourceAccount) {
    if (!this.#pools.has(sourceAccount)) {
      this.#pools.set(
        sourceAccount,
        new NoncePool(sourceAccount, this.#fetchFn)
      );
    }
    return this.#pools.get(sourceAccount);
  }

  clearPool(sourceAccount) {
    this.#pools.delete(sourceAccount);
  }
}
