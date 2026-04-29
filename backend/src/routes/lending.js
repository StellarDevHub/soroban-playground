import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import eventSchemaService from '../services/eventSchemaService.js';
import { sendSuccess } from '../utils/response.js';

const router = express.Router();

router.get(
  '/credit-score/:address',
  asyncHandler(async (req, res) => {
    const { address } = req.params;
    
    // Filter ingested events for repayments by this user
    const events = eventSchemaService.readEvents({ 
      eventType: 'repayment' 
    }).filter(e => e.data?.user === address);

    const history = events.map(e => ({
      amount: e.data?.amount,
      score: e.data?.score,
      timestamp: e.timestamp
    }));

    // Get the latest score or default to 0
    const currentScore = history.length > 0 ? history[history.length - 1].score : 0;

    return sendSuccess(res, {
      data: {
        address,
        currentScore,
        history
      },
      message: 'Credit score and repayment history retrieved'
    });
  })
);

export default router;
