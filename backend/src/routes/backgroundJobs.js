// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import { addJob, addFlow, queues } from '../services/queueService.js';
import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';

const router = express.Router();

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
    if (!contractId) {
      return next(createHttpError(400, 'contractId is required'));
    }

    const job = await addJob('indexing', 'contract-indexing', { contractId });
    return res.status(202).json({
      success: true,
      message: 'Indexing job enqueued',
      jobId: job.id,
    });
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
    if (!to) {
      return next(createHttpError(400, 'to is required'));
    }

    const job = await addJob('email', 'send-email', { to, subject, body });
    return res.status(202).json({
      success: true,
      message: 'Email job enqueued',
      jobId: job.id,
    });
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
  asyncHandler(async (req, res) => {
    const { taskName } = req.body || {};
    const job = await addJob('cron', taskName || 'manual-cleanup', {
      manual: true,
    });
    return res.status(202).json({
      success: true,
      message: 'Cron maintenance job enqueued',
      jobId: job.id,
    });
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
    if (!parent || !children || !Array.isArray(children)) {
      return next(
        createHttpError(400, 'parent and children array are required')
      );
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

    const result = await addFlow(flow);
    return res.status(202).json({
      success: true,
      message: 'Parent-child job tree flow enqueued',
      jobId: result.job.id,
      childrenIds: result.children ? result.children.map((c) => c.job.id) : [],
    });
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
    const queue = queues[queueName];
    if (!queue) {
      return next(createHttpError(404, `Queue "${queueName}" not found`));
    }

    const job = await queue.getJob(jobId);
    if (!job) {
      return next(
        createHttpError(404, `Job "${jobId}" not found in queue "${queueName}"`)
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
  })
);

export default router;
