import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import healthService from '../services/healthService.js';

const router = express.Router();

export async function checkWorkerQueueConnectivity() {
  const start = Date.now();
  try {
    const redisModule = await import('../services/redisService.js').catch(() => null);
    const redisService = redisModule?.default || redisModule;
    const isRedisReady = redisService?.client ? (redisService.client.status === 'ready' || redisService.client.status === 'connecting') : true;
    const latencyMs = Date.now() - start;
    return {
      name: 'workerQueue',
      status: isRedisReady ? 'healthy' : 'degraded',
      latencyMs,
      message: isRedisReady ? 'Worker queue connection operational' : 'Worker queue degraded',
    };
  } catch (error) {
    return {
      name: 'workerQueue',
      status: 'degraded',
      latencyMs: Date.now() - start,
      message: error.message,
    };
  }
}

export const healthHandler = asyncHandler(async (req, res) => {
  try {
    const skipCache = req.query?.refresh === 'true';
    const deep = await healthService.performDeepHealthCheck({ skipCache });
    const workerQueue = await checkWorkerQueueConnectivity();
    if (deep.dependencies) {
      deep.dependencies.workerQueue = workerQueue;
    }

    const httpStatus = healthService.getHttpStatusForHealth(deep.status);
    return res
      .status(httpStatus)
      .json({ success: httpStatus < 500, data: deep });
  } catch (error) {
    return res.status(503).json({
      success: false,
      data: { status: 'unhealthy', error: error.message },
    });
  }
});

export const readinessHandler = asyncHandler(async (req, res) => {
  try {
    const skipCache = req.query?.refresh === 'true';
    const deep = await healthService.performDeepHealthCheck({ skipCache });
    const workerQueue = await checkWorkerQueueConnectivity();
    if (deep.dependencies) {
      deep.dependencies.workerQueue = workerQueue;
    }

    const isReady = deep.status === 'ok' || deep.status === 'degraded';
    const httpStatus = isReady ? 200 : 503;
    return res.status(httpStatus).json({
      success: isReady,
      status: isReady ? 'ready' : 'not_ready',
      timestamp: new Date().toISOString(),
      dependencies: deep.dependencies,
    });
  } catch (error) {
    return res.status(503).json({
      success: false,
      status: 'not_ready',
      error: error.message,
    });
  }
});

export const livenessHandler = asyncHandler(async (_req, res) => {
  return res
    .status(200)
    .json({ success: true, data: healthService.getLivenessPayload() });
});

router.get('/', healthHandler);
router.get('/live', livenessHandler);
router.get('/liveness', livenessHandler);
router.get('/ready', readinessHandler);
router.get('/readiness', readinessHandler);

export default router;
