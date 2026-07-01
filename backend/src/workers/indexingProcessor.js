// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import contractEventIndexer from '../services/contractEventIndexer.js';

/**
 * Sandboxed processor for contract event indexing.
 * Runs in a separate process.
 */
export default async function indexingProcessor(job) {
  console.log(
    `[Indexing Worker] Processing job ${job.id} (Attempt ${job.attemptsMade + 1})`
  );

  try {
    // Ensure DB is connected
    if (!contractEventIndexer._db.db) {
      await contractEventIndexer._db.connect();
    }

    await contractEventIndexer._poll();

    console.log(`[Indexing Worker] Job ${job.id} completed successfully`);
    return { success: true, polled: true };
  } catch (err) {
    console.error(`[Indexing Worker] Job ${job.id} failed:`, err.message);
    throw err; // Throw to trigger retry/fail logic in BullMQ
  }
}
