import express from 'express';
import { oracleQueueService } from '../services/oracleQueueService.js';

const router = express.Router();

/**
 * @route POST /api/oracle/proofs/verify
 * @desc Enqueue a single proof for verification
 */
router.post('/verify', async (req, res, next) => {
  try {
    const { payload, priority, maxRetries, deadline } = req.body;

    if (!payload) {
      return res.status(400).json({ success: false, error: 'Payload is required' });
    }

    const taskId = await oracleQueueService.enqueue(payload, priority, maxRetries, deadline);
    
    return res.status(202).json({
      success: true,
      message: 'Proof task enqueued successfully',
      data: { taskId }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @route POST /api/oracle/proofs/verify/batch
 * @desc Enqueue multiple proofs for verification
 */
router.post('/verify/batch', async (req, res, next) => {
  try {
    const { payloads, priority, maxRetries } = req.body;

    if (!Array.isArray(payloads) || payloads.length === 0) {
      return res.status(400).json({ success: false, error: 'Array of payloads is required' });
    }

    const taskIds = await oracleQueueService.enqueueBatch(payloads, priority, maxRetries);
    
    return res.status(202).json({
      success: true,
      message: `${taskIds.length} proof tasks enqueued successfully`,
      data: { taskIds }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @route GET /api/oracle/proofs/:taskId
 * @desc Get the status of a specific proof task
 */
router.get('/:taskId', async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const task = await oracleQueueService.getTaskStatus(taskId);

    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    return res.json({ success: true, data: task });
  } catch (err) {
    next(err);
  }
});

/**
 * @route GET /api/admin/oracle/queue
 * @desc Get queue metrics (depth, dlq)
 */
router.get('/admin/queue', async (req, res, next) => {
  try {
    const metrics = await oracleQueueService.getQueueMetrics();
    return res.json({ success: true, data: metrics });
  } catch (err) {
    next(err);
  }
});

export default router;
