import express from 'express';
import { ticketingService } from '../services/ticketingService.js';
import { rateLimitMiddleware } from '../middleware/rateLimiter.js';

const router = express.Router();

router.post('/create-event', rateLimitMiddleware('invoke'), async (req, res) => {
  try {
    const result = await ticketingService.createEvent(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/buy-ticket', rateLimitMiddleware('invoke'), async (req, res) => {
  try {
    const result = await ticketingService.buyTicket(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/check-in', rateLimitMiddleware('invoke'), async (req, res) => {
  try {
    const result = await ticketingService.checkIn(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/analytics/:eventId', async (req, res) => {
  try {
    const analytics = await ticketingService.getAnalytics(req.params.eventId);
    res.json({ success: true, data: analytics });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
