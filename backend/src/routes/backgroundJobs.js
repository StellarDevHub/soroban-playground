// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import { addJob, addFlow, queues } from '../services/queueService.js';
import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';

const router = express.Router();

const VALID_QUEUE_NAMES = new Set([
  'indexing',
  'email',
  'cron',
  'compilation',
  'deployment',
]);
const VALID_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateRequiredFields(body, fields) {
  const missing = fields.filter(
    (f) => !body[f] || (typeof body[f] === 'string' && !body[f].trim())
  );
  return missing.length > 0 ? missing : null;
}

/**
 * @swagger
 * tags:
 *   name: BackgroundJobs
 *   description: BullMQ background processing API
 */

/**
 * @swagger
 * /background-jobs/indexing:
 *   post:
 *     summary: Enqueue a contract indexing job
 *     tags: [BackgroundJobs]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [contractId]
 *             properties:
 *               contractId:
 *                 type: string
 *     responses:
 *       202:
 *         description: Job accepted
 */
router.post(
  '/indexing',
  asyncHandler(async (req, res, next) => {
    const { contractId } = req.body || {};
    if (!contractId || typeof contractId !== 'string' || !contractId.trim()) {
      return next(
        createHttpError(
          400,
          'contractId is required and must be a non-empty string',
          { field: 'contractId' }
        )
      );
    }

    try {
      const job = await addJob('indexing', 'contract-indexing', {
        contractId: contractId.trim(),
      });
      return res.status(202).json({
        success: true,
        message: 'Indexing job enqueued',
        jobId: job.id,
      });
    } catch (err) {
      return next(
        createHttpError(503, 'Failed to enqueue indexing job', {
          cause: err.message,
        })
      );
    }
  })
);

/**
 * @swagger
 * /background-jobs/email:
 *   post:
 *     summary: Enqueue an email sending job
 *     tags: [BackgroundJobs]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [to, subject, body]
 *             properties:
 *               to:
 *                 type: string
 *               subject:
 *                 type: string
 *               body:
 *                 type: string
 *     responses:
 *       202:
 *         description: Job accepted
 */
router.post(
  '/email',
  asyncHandler(async (req, res, next) => {
    const { to, subject, body } = req.body || {};

    const missing = validateRequiredFields(req.body || {}, ['to']);
    if (missing) {
      return next(
        createHttpError(400, `${missing.join(', ')} is required`, {
          fields: missing,
        })
      );
    }

    if (typeof to === 'string' && !VALID_EMAIL_REGEX.test(to.trim())) {
      return next(
        createHttpError(400, 'to must be a valid email address', {
          field: 'to',
        })
      );
    }

    try {
      const job = await addJob('email', 'send-email', {
        to: to.trim(),
        subject,
        body,
      });
      return res.status(202).json({
        success: true,
        message: 'Email job enqueued',
        jobId: job.id,
      });
    } catch (err) {
      return next(
        createHttpError(503, 'Failed to enqueue email job', {
          cause: err.message,
        })
      );
    }
  })
);

/**
 * @swagger
 * /background-jobs/cron:
 *   post:
 *     summary: Trigger a cron/maintenance task immediately
 *     tags: [BackgroundJobs]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               taskName:
 *                 type: string
 *     responses:
 *       202:
 *         description: Job accepted
 */
router.post(
  '/cron',
  asyncHandler(async (req, res, next) => {
    const { taskName } = req.body || {};

    if (
      taskName !== undefined &&
      (typeof taskName !== 'string' || !taskName.trim())
    ) {
      return next(
        createHttpError(400, 'taskName must be a non-empty string', {
          field: 'taskName',
        })
      );
    }

    try {
      const job = await addJob('cron', taskName?.trim() || 'manual-cleanup', {
        manual: true,
      });
      return res.status(202).json({
        success: true,
        message: 'Cron maintenance job enqueued',
        jobId: job.id,
      });
    } catch (err) {
      return next(
        createHttpError(503, 'Failed to enqueue cron job', {
          cause: err.message,
        })
      );
    }
  })
);

/**
 * @swagger
 * /background-jobs/flow:
 *   post:
 *     summary: Enqueue parent-child dependency job tree
 *     tags: [BackgroundJobs]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [parent, children]
 *             properties:
 *               parent:
 *                 type: object
 *               children:
 *                 type: array
 *                 items:
 *                   type: object
 *     responses:
 *       202:
 *         description: Flow accepted
 */
router.post(
  '/flow',
  asyncHandler(async (req, res, next) => {
    const { parent, children } = req.body || {};
    if (!parent || typeof parent !== 'object') {
      return next(
        createHttpError(400, 'parent object is required', { field: 'parent' })
      );
    }
    if (!children || !Array.isArray(children)) {
      return next(
        createHttpError(400, 'children array is required', {
          field: 'children',
        })
      );
    }
    if (children.length === 0) {
      return next(
        createHttpError(400, 'children array must not be empty', {
          field: 'children',
        })
      );
    }

    for (let i = 0; i < children.length; i++) {
      if (!children[i] || typeof children[i] !== 'object') {
        return next(
          createHttpError(400, `children[${i}] must be an object`, {
            field: `children[${i}]`,
          })
        );
      }
      if (!children[i].name) {
        return next(
          createHttpError(400, `children[${i}].name is required`, {
            field: `children[${i}].name`,
          })
        );
      }
    }

    const flow = {
      name: parent.name || 'parent-job',
      queueName: parent.queueName || 'indexing',
      data: parent.data || {},
      opts: parent.opts || {},
      children: children.map((child) => ({
        name: child.name,
        queueName: child.queueName || 'email',
        data: child.data || {},
        opts: child.opts || {},
      })),
    };

    try {
      const result = await addFlow(flow);
      return res.status(202).json({
        success: true,
        message: 'Parent-child job tree flow enqueued',
        jobId: result.job.id,
        childrenIds: result.children
          ? result.children.map((c) => c.job.id)
          : [],
      });
    } catch (err) {
      return next(
        createHttpError(503, 'Failed to enqueue flow', { cause: err.message })
      );
    }
  })
);

/**
 * @swagger
 * /background-jobs/status/{queueName}/{jobId}:
 *   get:
 *     summary: Query the status of a specific background job
 *     tags: [BackgroundJobs]
 *     parameters:
 *       - in: path
 *         name: queueName
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Job status details
 */
router.get(
  '/status/:queueName/:jobId',
  asyncHandler(async (req, res, next) => {
    const { queueName, jobId } = req.params;

    if (!queueName || !VALID_QUEUE_NAMES.has(queueName)) {
      return next(
        createHttpError(
          400,
          `Invalid queue name. Must be one of: ${[...VALID_QUEUE_NAMES].join(', ')}`,
          {
            field: 'queueName',
            validValues: [...VALID_QUEUE_NAMES],
          }
        )
      );
    }

    if (!jobId || typeof jobId !== 'string') {
      return next(
        createHttpError(400, 'jobId is required', { field: 'jobId' })
      );
    }

    const queue = queues[queueName];
    if (!queue) {
      return next(createHttpError(404, `Queue "${queueName}" not found`));
    }

    try {
      const job = await queue.getJob(jobId);
      if (!job) {
        return next(
          createHttpError(
            404,
            `Job "${jobId}" not found in queue "${queueName}"`
          )
        );
      }

      const state = await job.getState();
      return res.json({
        success: true,
        jobId: job.id,
        state,
        progress: job.progress,
        attemptsMade: job.attemptsMade,
        failedReason: job.failedReason,
        data: job.data,
        returnValue: job.returnValue,
      });
    } catch (err) {
      return next(
        createHttpError(500, 'Failed to retrieve job status', {
          cause: err.message,
        })
      );
    }
  })
);

export default router;
