import express from 'express';
import { subscriptionService } from '../services/subscriptionService.js';
import { rateLimiter } from '../middleware/rateLimiter.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

router.get('/plans', rateLimiter('standard'), async (req, res, next) => {
  try {
    const plans = await subscriptionService.getPlans();
    res.json(plans);
  } catch (error) {
    logger.error('Failed to fetch plans', { error: error.message });
    next(error);
  }
});

router.post('/subscribe', rateLimiter('standard'), async (req, res, next) => {
  try {
    const { plan_id, auto_renew } = req.body;
    const userId = req.user?.id || 'anonymous';

    if (!plan_id) {
      return res.status(400).json({ error: 'plan_id is required' });
    }

    const result = await subscriptionService.subscribe(userId, plan_id, auto_renew);
    res.json(result);
  } catch (error) {
    logger.error('Failed to subscribe', { error: error.message });
    next(error);
  }
});

router.post('/renew', rateLimiter('standard'), async (req, res, next) => {
  try {
    const userId = req.user?.id || 'anonymous';
    const result = await subscriptionService.renewSubscription(userId);
    res.json(result);
  } catch (error) {
    logger.error('Failed to renew subscription', { error: error.message });
    next(error);
  }
});

router.post('/cancel', rateLimiter('standard'), async (req, res, next) => {
  try {
    const userId = req.user?.id || 'anonymous';
    const result = await subscriptionService.cancelSubscription(userId);
    res.json(result);
  } catch (error) {
    logger.error('Failed to cancel subscription', { error: error.message });
    next(error);
  }
});

router.get('/me', rateLimiter('standard'), async (req, res, next) => {
  try {
    const userId = req.user?.id || 'anonymous';
    const subscription = await subscriptionService.getSubscription(userId);
    res.json(subscription);
  } catch (error) {
    logger.error('Failed to fetch subscription', { error: error.message });
    next(error);
  }
});

router.get('/usage', rateLimiter('standard'), async (req, res, next) => {
  try {
    const userId = req.user?.id || 'anonymous';
    const usage = await subscriptionService.getUsage(userId);
    res.json(usage);
  } catch (error) {
    logger.error('Failed to fetch usage', { error: error.message });
    next(error);
  }
});

router.post('/usage', rateLimiter('standard'), async (req, res, next) => {
  try {
    const { api_calls, storage, bandwidth } = req.body;
    const userId = req.user?.id || 'anonymous';

    const result = await subscriptionService.recordUsage(userId, api_calls, storage, bandwidth);
    res.json(result);
  } catch (error) {
    logger.error('Failed to record usage', { error: error.message });
    next(error);
  }
});

router.post('/admin/plans', rateLimiter('admin'), async (req, res, next) => {
  try {
    const { name, price, duration, features } = req.body;

    if (!name || !price || !duration) {
      return res.status(400).json({ error: 'name, price, and duration are required' });
    }

    const result = await subscriptionService.createPlan(name, price, duration, features || []);
    res.json(result);
  } catch (error) {
    logger.error('Failed to create plan', { error: error.message });
    next(error);
  }
});

export default router;
