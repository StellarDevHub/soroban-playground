import express from 'express';
import {
  asyncHandler,
  createHttpError,
} from '../../middleware/errorHandler.js';
import { rateLimitMiddleware } from '../../middleware/rateLimiter.js';
import { runSimulation } from '../../services/simulationService.js';

const router = express.Router();

export { runSimulation };

router.post(
  '/fee',
  rateLimitMiddleware('read'),
  asyncHandler(async (req, res, next) => {
    const { transactionXdr, transaction, network = 'testnet' } = req.body || {};
    const xdrToSimulate = transactionXdr || transaction;

    if (!xdrToSimulate || typeof xdrToSimulate !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'transactionXdr or transaction (base64 string) is required',
      });
    }

    try {
      const report = await runSimulation(xdrToSimulate, network);
      return res.json({
        success: true,
        status: 'success',
        data: report,
      });
    } catch (error) {
      return next(
        createHttpError(500, 'Fee simulation failed', {
          details: error.message,
        })
      );
    }
  })
);

// Pre-flight simulation endpoint - returns the full resource profile,
// gas visualizer breakdown and diagnostics for a transaction.
router.post(
  '/pre-flight',
  rateLimitMiddleware('read'),
  asyncHandler(async (req, res, next) => {
    const { transactionXdr, transaction, network = 'testnet' } = req.body || {};
    const xdrToSimulate = transactionXdr || transaction;

    if (!xdrToSimulate || typeof xdrToSimulate !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'transactionXdr or transaction (base64 string) is required',
      });
    }

    try {
      const report = await runSimulation(xdrToSimulate, network);
      return res.json({
        success: true,
        status: 'success',
        data: report,
      });
    } catch (error) {
      return next(
        createHttpError(500, 'Pre-flight simulation failed', {
          details: error.message,
        })
      );
    }
  })
);

export default router;
