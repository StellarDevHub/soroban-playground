// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { BatchSubmitter } from '../services/batchSubmitter.js';

const router = express.Router();

// Stub fetch/submit functions — replace with real Stellar SDK calls in production
const defaultFetchSequence = async (_account) => '1000';
const defaultSubmitFn = async (envelope) => ({ hash: `0x${Date.now().toString(16)}`, envelope });

let submitter = new BatchSubmitter({
  fetchSequenceFn: defaultFetchSequence,
  submitFn: defaultSubmitFn,
  maxBatchSize: Number(process.env.BATCH_MAX_SIZE) || 10,
  maxWaitMs: Number(process.env.BATCH_MAX_WAIT_MS) || 200,
});

/** POST /api/batch/submit — enqueue a transaction */
router.post(
  '/submit',
  asyncHandler(async (req, res) => {
    const { id, sourceAccount, payload } = req.body;
    if (!id || !sourceAccount || !payload) {
      return res.status(400).json({
        error: 'id, sourceAccount, and payload are required',
      });
    }

    const result = await submitter.submit({
      id,
      sourceAccount,
      buildEnvelope: (seq) => ({ ...payload, sequence: seq.toString() }),
    });

    res.status(200).json({ success: true, data: result });
  }),
);

/** POST /api/batch/flush — flush all queued transactions immediately */
router.post(
  '/flush',
  asyncHandler(async (_req, res) => {
    await submitter.flush();
    res.status(200).json({ success: true, message: 'Queue flushed' });
  }),
);

/** GET /api/batch/status — queue depth */
router.get('/status', (_req, res) => {
  res.status(200).json({ success: true, data: { queueLength: submitter.queueLength } });
});

export default router;
export { submitter };
