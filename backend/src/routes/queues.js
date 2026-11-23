// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * DLQ (Dead-Letter Queue) management routes (#1577)
 *
 * Provides REST endpoints for inspecting, replaying, and discarding jobs
 * that have exhausted all retry attempts in the compilation / deployment queues.
 *
 * All write operations (replay / delete) require the `admin` role.
 */

import express from 'express';
import {
  getDlqJobs,
  replayDlqJob,
  replayAllDlqJobs,
  deleteDlqJob,
  getQueueMetrics,
} from '../services/queueService.js';
import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';
import { requireRole } from '../middleware/auth.js';

const router = express.Router();

const SUPPORTED_QUEUES = [
  'compilation',
  'deployment',
  'email',
  'indexing',
  'cron',
];

function validateQueueName(name) {
  if (!SUPPORTED_QUEUES.includes(name)) {
    throw createHttpError(
      400,
      `Invalid queue name "${name}". Must be one of: ${SUPPORTED_QUEUES.join(', ')}`
    );
  }
}

/**
 * GET /api/queues/metrics
 * Returns waiting/active/completed/failed counts for all queues.
 */
router.get(
  '/metrics',
  asyncHandler(async (_req, res) => {
    const metrics = await getQueueMetrics();
    return res.json({ success: true, metrics });
  })
);

/**
 * GET /api/queues/:queueName/dlq
 * List jobs currently in the dead-letter queue.
 *
 * Query params:
 *   start  (number, default 0)
 *   end    (number, default 49)
 */
router.get(
  '/:queueName/dlq',
  asyncHandler(async (req, res) => {
    validateQueueName(req.params.queueName);
    const start = Math.max(0, Number.parseInt(req.query.start || '0', 10));
    const end = Math.max(
      start,
      Math.min(999, Number.parseInt(req.query.end || '49', 10))
    );
    const jobs = await getDlqJobs(req.params.queueName, { start, end });
    return res.json({
      success: true,
      queue: req.params.queueName,
      count: jobs.length,
      jobs,
    });
  })
);

/**
 * GET /api/queues/:queueName/dlq/:jobId
 * Inspect a single job in the dead-letter queue.
 */
router.get(
  '/:queueName/dlq/:jobId',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    validateQueueName(req.params.queueName);
    const jobs = await getDlqJobs(req.params.queueName, { start: 0, end: 999 });
    const job = jobs.find((item) => String(item.id) === req.params.jobId);
    if (!job) {
      throw createHttpError(
        404,
        `DLQ job "${req.params.jobId}" not found in queue "${req.params.queueName}"`
      );
    }
    return res.json({ success: true, queue: req.params.queueName, job });
  })
);

/**
 * POST /api/queues/:queueName/dlq/:jobId/replay
 * Replay a single DLQ job back into the source queue.
 */
router.post(
  '/:queueName/dlq/:jobId/replay',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    validateQueueName(req.params.queueName);
    const result = await replayDlqJob(req.params.queueName, req.params.jobId);
    return res.json({ success: true, replayed: result });
  })
);

/**
 * POST /api/queues/:queueName/dlq/replay-all
 * Replay all pending DLQ jobs back into the source queue.
 *
 * Body (optional):
 *   { limit: number }  – max jobs to replay (default 50)
 */
router.post(
  '/:queueName/dlq/replay-all',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    validateQueueName(req.params.queueName);
    const limit = Math.min(500, Number.parseInt(req.body?.limit || '50', 10));
    const results = await replayAllDlqJobs(req.params.queueName, limit);
    return res.json({
      success: true,
      replayed: results,
      count: results.length,
    });
  })
);

/**
 * DELETE /api/queues/:queueName/dlq/:jobId
 * Permanently discard a DLQ job (no replay).
 */
router.delete(
  '/:queueName/dlq/:jobId',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    validateQueueName(req.params.queueName);
    const result = await deleteDlqJob(req.params.queueName, req.params.jobId);
    return res.json({ success: true, ...result });
  })
);

export default router;
