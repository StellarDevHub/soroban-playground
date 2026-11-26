// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { compileContract } from '../services/compileService.js';
import { getWss } from '../websocket.js';

import {
  JobError,
  NonRetryableJobError,
  JOB_ERROR_CODES,
  toBullMqError,
} from './jobErrors.js';

function trySendWsMessage(payload) {
  try {
    const wss = getWss();
    if (wss && wss.clients) {
      const message = JSON.stringify(payload);
      wss.clients.forEach((client) => {
        if (client.readyState === 1) {
          client.send(message);
        }
      });
    }
  } catch {
    // WS notification is best-effort
  }
}

/**
 * Sandboxed processor for asynchronous WASM compilation.
 * Runs in background worker pool.
 */
export default async function compilationProcessor(job) {
  const startTime = Date.now();
  console.log(
    `[Compilation Worker] Processing job ${job.id} (Attempt ${job.attemptsMade + 1})`
  );

  if (!job.data || typeof job.data !== 'object') {
    throw new NonRetryableJobError(
      'Compilation job payload must be a non-null object.',
      {
        code: JOB_ERROR_CODES.MALFORMED_INPUT,
      }
    );
  }

  const { source, contractName = 'soroban_contract' } = job.data;

  if (!source || typeof source !== 'string' || !source.trim()) {
    throw new NonRetryableJobError(
      'Compilation job missing required "source" payload.',
      {
        code: JOB_ERROR_CODES.MISSING_SOURCE,
      }
    );
  }

  try {
    await job.updateProgress(10);

    const result = await compileContract({ source, contractName });

    await job.updateProgress(80);

    trySendWsMessage({
      type: 'compilation:completed',
      jobId: job.id,
      status: 'completed',
      wasmUrl: result.wasmUrl,
      hash: result.hash,
    });

    await job.updateProgress(100);

    const durationMs = Date.now() - startTime;
    console.log(
      `[Compilation Worker] Job ${job.id} compiled successfully in ${durationMs}ms.`
    );
    return {
      success: true,
      jobId: job.id,
      hash: result.hash,
      wasmUrl: result.wasmUrl,
      sizeBytes: result.sizeBytes,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const classifiedError = toBullMqError(err);
    console.error(
      `[Compilation Worker] Job ${job.id} failed after ${durationMs}ms (${classifiedError.code}, retryable=${classifiedError.retryable}):`,
      classifiedError.message
    );

    trySendWsMessage({
      type: 'compilation:failed',
      jobId: job.id,
      status: 'failed',
      error: classifiedError.message,
      errorCode: classifiedError.code,
      retryable: classifiedError.retryable,
    });

    throw classifiedError;
  }
}

export { JobError, NonRetryableJobError };
