// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { EventEmitter } from 'events';
import { NoncePoolRegistry } from './noncePool.js';

const DEFAULT_MAX_BATCH_SIZE = 10;
const DEFAULT_MAX_WAIT_MS = 200; // flush if batch doesn't fill within this time
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 1000;

/**
 * Queue-based batch transaction submitter.
 *
 * Transactions are enqueued via submit() and flushed as a batch either
 * when MAX_BATCH_SIZE is reached or after MAX_WAIT_MS, whichever comes
 * first. Each transaction is assigned a monotonically increasing sequence
 * number from a NoncePool so concurrent flushes can never produce duplicates.
 *
 * Emits:
 *   'batch:submitted'  { batchId, count }
 *   'tx:success'       { txId, hash }
 *   'tx:failed'        { txId, error, attempts }
 */
export class BatchSubmitter extends EventEmitter {
  #queue = [];
  #flushTimer = null;
  #registry;
  #submitFn;
  #maxBatchSize;
  #maxWaitMs;
  #retryAttempts;
  #retryDelayMs;
  #batchCounter = 0;

  /**
   * @param {object} opts
   * @param {function(string): Promise<string>} opts.fetchSequenceFn - fetches
   *   current sequence for a source account
   * @param {function(object): Promise<{hash:string}>} opts.submitFn - submits
   *   a single transaction envelope; resolve with {hash} or reject on failure
   * @param {number} [opts.maxBatchSize]
   * @param {number} [opts.maxWaitMs]
   * @param {number} [opts.retryAttempts]
   * @param {number} [opts.retryDelayMs]
   */
  constructor({
    fetchSequenceFn,
    submitFn,
    maxBatchSize = DEFAULT_MAX_BATCH_SIZE,
    maxWaitMs = DEFAULT_MAX_WAIT_MS,
    retryAttempts = DEFAULT_RETRY_ATTEMPTS,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  }) {
    super();
    this.#registry = new NoncePoolRegistry(fetchSequenceFn);
    this.#submitFn = submitFn;
    this.#maxBatchSize = maxBatchSize;
    this.#maxWaitMs = maxWaitMs;
    this.#retryAttempts = retryAttempts;
    this.#retryDelayMs = retryDelayMs;
  }

  /**
   * Enqueue a transaction for batch submission.
   *
   * @param {object} tx - transaction descriptor
   * @param {string} tx.id - caller-assigned identifier
   * @param {string} tx.sourceAccount - Stellar G-address of the fee source
   * @param {function(bigint): object} tx.buildEnvelope - called with the
   *   assigned sequence number; must return the transaction envelope to submit
   * @returns {Promise<{txId: string, hash: string}>}
   */
  submit(tx) {
    return new Promise((resolve, reject) => {
      this.#queue.push({ tx, resolve, reject });
      if (this.#queue.length >= this.#maxBatchSize) {
        this.#clearTimer();
        void this.#flush();
      } else {
        this.#startTimer();
      }
    });
  }

  #startTimer() {
    if (this.#flushTimer) return;
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null;
      void this.#flush();
    }, this.#maxWaitMs);
  }

  #clearTimer() {
    if (this.#flushTimer) {
      clearTimeout(this.#flushTimer);
      this.#flushTimer = null;
    }
  }

  async #flush() {
    if (this.#queue.length === 0) return;
    const batch = this.#queue.splice(0, this.#maxBatchSize);
    const batchId = ++this.#batchCounter;

    // Assign sequence numbers concurrently per source account
    await Promise.all(
      batch.map(async ({ tx, resolve, reject }) => {
        const pool = this.#registry.getPool(tx.sourceAccount);
        try {
          const seq = await pool.acquire();
          const envelope = tx.buildEnvelope(seq);
          const result = await this.#submitWithRetry(tx.id, envelope);
          this.emit('tx:success', { txId: tx.id, hash: result.hash });
          resolve({ txId: tx.id, hash: result.hash });
        } catch (err) {
          // Resync pool in case of sequence error
          await this.#registry.getPool(tx.sourceAccount).resync().catch(() => {});
          this.emit('tx:failed', { txId: tx.id, error: err.message });
          reject(err);
        }
      }),
    );

    this.emit('batch:submitted', { batchId, count: batch.length });
  }

  async #submitWithRetry(txId, envelope, attempt = 1) {
    try {
      return await this.#submitFn(envelope);
    } catch (err) {
      if (attempt >= this.#retryAttempts) throw err;
      await new Promise((r) => setTimeout(r, this.#retryDelayMs * attempt));
      return this.#submitWithRetry(txId, envelope, attempt + 1);
    }
  }

  /** Drain remaining queue items without waiting for the timer. */
  async flush() {
    this.#clearTimer();
    while (this.#queue.length > 0) {
      await this.#flush();
    }
  }

  get queueLength() {
    return this.#queue.length;
  }
}
