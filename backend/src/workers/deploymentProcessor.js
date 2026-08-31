// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { deployContract } from '../services/deployService.js';
import { getWss } from '../websocket.js';

class JobError extends Error {
  constructor(
    message,
    { retryable = true, code = 'UNKNOWN', details = null } = {}
  ) {
    super(message);
    this.name = 'JobError';
    this.retryable = retryable;
    this.code = code;
    this.details = details;
  }
}

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
 * Sandboxed processor for asynchronous contract deployment.
 * Runs in a dedicated BullMQ worker process (issue #1333).
 */
export default async function deploymentProcessor(job) {
  const startTime = Date.now();
  console.log(
    `[Deployment Worker] Processing job ${job.id} (Attempt ${job.attemptsMade + 1})`
  );

  const {
    wasmPath,
    contractName,
    network = 'testnet',
    sourceAccount,
  } = job.data;

  if (!wasmPath || typeof wasmPath !== 'string') {
    throw new JobError('Deployment job missing required "wasmPath" payload.', {
      retryable: false,
      code: 'MISSING_WASM_PATH',
    });
  }
  if (!contractName || typeof contractName !== 'string') {
    throw new JobError(
      'Deployment job missing required "contractName" payload.',
      { retryable: false, code: 'MISSING_CONTRACT_NAME' }
    );
  }

  try {
    await job.updateProgress(10);

    const result = await deployContract(
      {
        contractName,
        wasmPath,
        network,
        sourceAccount:
          sourceAccount || process.env.SOROBAN_SOURCE_ACCOUNT || '',
      },
      { onProgress: () => job.updateProgress(50) }
    );

    await job.updateProgress(80);

    const deployedAt = new Date().toISOString();
    const payload = {
      contractId: result.contractId,
      contractName,
      network,
      wasmPath,
      deployedAt,
      message: `Contract "${contractName}" deployed successfully to ${network}`,
    };

    trySendWsMessage({
      type: 'deployment:completed',
      jobId: job.id,
      status: 'completed',
      ...payload,
    });

    await job.updateProgress(100);

    const durationMs = Date.now() - startTime;
    console.log(
      `[Deployment Worker] Job ${job.id} deployed successfully in ${durationMs}ms.`
    );
    return { success: true, jobId: job.id, ...payload, durationMs };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error(
      `[Deployment Worker] Job ${job.id} failed after ${durationMs}ms:`,
      err.message
    );

    trySendWsMessage({
      type: 'deployment:failed',
      jobId: job.id,
      status: 'failed',
      error: err.message,
    });

    throw err;
  }
}

export { JobError };
