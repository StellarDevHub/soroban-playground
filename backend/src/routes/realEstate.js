import express from 'express';
import { realEstateService } from '../services/realEstateService.js';
import { rateLimitMiddleware } from '../middleware/rateLimiter.js';

const router = express.Router();

router.post('/list', rateLimitMiddleware('invoke'), async (req, res) => {
  try {
    const result = await realEstateService.listProperty(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/buy', rateLimitMiddleware('invoke'), async (req, res) => {
  try {
    const result = await realEstateService.buyShares(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/deposit-rent', rateLimitMiddleware('invoke'), async (req, res) => {
  try {
    const result = await realEstateService.depositRent(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/portfolio/:address', async (req, res) => {
  try {
    const portfolio = await realEstateService.getPortfolio(req.params.address);
    res.json({ success: true, data: portfolio });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
