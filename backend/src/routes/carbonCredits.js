const express = require('express');
const router = express.Router();
const carbonCreditService = require('../services/carbonCreditService');
const { rateLimiter } = require('../middleware/rateLimiter');

/**
 * @swagger
 * /api/impact/dashboard:
 *   get:
 *     summary: Get environmental impact metrics
 *     tags: [Environmental Impact]
 */
router.get('/impact/dashboard', rateLimiter, async (req, res, next) => {
  try {
    const metrics = await carbonCreditService.getImpactMetrics();
    res.json(metrics);
  } catch (err) {
    next(err);
  }
});

router.post('/credits/mint', rateLimiter, async (req, res, next) => {
  try {
    const { to, offset, projectType, projectId } = req.body;
    const result = await carbonCreditService.mintCredit(to, offset, projectType, projectId);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/credits/verify', rateLimiter, async (req, res, next) => {
  try {
    const { id } = req.body;
    const result = await carbonCreditService.verifyCredit(id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/credits/retire', rateLimiter, async (req, res, next) => {
  try {
    const { owner, id, amount } = req.body;
    const result = await carbonCreditService.retireCredit(owner, id, amount);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/credits/:id', async (req, res, next) => {
  try {
    const detail = await carbonCreditService.getCreditDetails(req.params.id);
    if (!detail) return res.status(404).json({ message: 'Credit not found' });
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

router.get('/transactions', async (req, res) => {
  const history = await carbonCreditService.getTransactionHistory(req.query);
  res.json(history);
});

module.exports = router;