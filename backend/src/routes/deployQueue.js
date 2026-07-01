// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * @swagger
 * tags:
 *   name: DeployQueue
 *   description: Asynchronous deployment job queue
 */

import express from 'express';
import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';
import {
  enqueueDeployJob,
  getDeployJob,
  getQueueStats,
} from '../services/deployQueue.js';

const router = express.Router();

/**
 * @swagger
 * /deploy-queue:
 *   post:
 *     summary: Enqueue an async contract deployment job
 *     tags: [DeployQueue]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [wasmPath, contractName]
 *             properties:
 *               wasmPath:
 *                 type: string
 *               contractName:
 *                 type: string
 *               network:
 *                 type: string
 *                 default: testnet
 *     responses:
 *       202:
 *         description: Job accepted and queued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 job:
 *                   $ref: '#/components/schemas/DeployJob'
 *       400:
 *         description: Validation error
 */
router.post(
  '/',
  asyncHandler(async (req, res, next) => {
    const { wasmPath, contractName, network } = req.body || {};
    if (!wasmPath) return next(createHttpError(400, 'wasmPath is required'));
    if (!contractName)
      return next(createHttpError(400, 'contractName is required'));

    const job = enqueueDeployJob({ wasmPath, contractName, network });
    return res.status(202).json({ success: true, job });
  })
);

/**
 * @swagger
 * /deploy-queue/{id}:
 *   get:
 *     summary: Poll the status of a queued deployment job
 *     tags: [DeployQueue]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Job ID returned from POST /deploy-queue
 *     responses:
 *       200:
 *         description: Job status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 job:
 *                   $ref: '#/components/schemas/DeployJob'
 *       404:
 *         description: Job not found
 */
router.get(
  '/:id',
  asyncHandler(async (req, res, next) => {
    const job = getDeployJob(req.params.id);
    if (!job) return next(createHttpError(404, 'Job not found'));
    return res.json({ success: true, job });
  })
);

/**
 * @swagger
 * /deploy-queue/stats:
 *   get:
 *     summary: Get deploy queue statistics
 *     tags: [DeployQueue]
 *     responses:
 *       200:
 *         description: Queue stats
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 stats:
 *                   $ref: '#/components/schemas/DeployQueueStats'
 */
router.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const stats = getQueueStats();
    return res.json({ success: true, stats });
  })
);

export default router;
