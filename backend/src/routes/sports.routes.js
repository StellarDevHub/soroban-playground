import express from 'express';
import sportsService from '../services/sports.service.js';
import { rateLimit } from 'express-rate-limit';

const router = express.Router();

const sportsRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Too many requests from this IP, please try again after 15 minutes'
});

router.get('/markets', sportsRateLimit, async (req, res) => {
    try {
        const markets = await sportsService.getAllMarkets();
        res.json(markets);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/markets/:id/odds', async (req, res) => {
    try {
        const odds = await sportsService.getMarketOdds(req.params.id);
        res.json(odds);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/analytics', async (req, res) => {
    try {
        const analytics = await sportsService.getGlobalAnalytics();
        res.json(analytics);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
