import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import healthService from '../services/healthService.js';

const router = express.Router();

export const healthHandler = asyncHandler(async (req, res) => {
  try {
    const skipCache = req.query?.refresh === 'true';
    const deep = await healthService.performDeepHealthCheck({ skipCache });
    const httpStatus = healthService.getHttpStatusForHealth(deep.status);
    return res.status(httpStatus).json({ success: httpStatus < 500, data: deep });
  } catch (error) {
    return res.status(503).json({
      success: false,
      data: { status: 'unhealthy', error: error.message },
    });
  }
});

export const livenessHandler = asyncHandler(async (_req, res) => {
  return res.status(200).json({ success: true, data: healthService.getLivenessPayload() });
});

router.get('/', healthHandler);
router.get('/live', livenessHandler);

export default router;
