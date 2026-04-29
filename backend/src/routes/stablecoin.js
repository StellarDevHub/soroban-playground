import express from 'express';
import stablecoinService from '../services/stablecoinService.js';
import { rateLimitMiddleware } from '../middleware/rateLimiter.js';

const router = express.Router();

// Get stablecoin metrics
router.get('/metrics', async (req, res) => {
  try {
    const metrics = await stablecoinService.getMetrics();
    res.json({
      success: true,
      data: metrics
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get price history
router.get('/price-history', async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const history = await stablecoinService.getPriceHistory(parseInt(days));
    res.json({
      success: true,
      data: history
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get rebase history
router.get('/rebase-history', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const history = await stablecoinService.getRebaseHistory(parseInt(limit));
    res.json({
      success: true,
      data: history
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get reserve info
router.get('/reserve', async (req, res) => {
  try {
    const reserve = await stablecoinService.getReserveInfo();
    res.json({
      success: true,
      data: reserve
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get contract status
router.get('/status', async (req, res) => {
  try {
    const status = await stablecoinService.getContractStatus();
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Update price (oracle only)
router.post('/price', rateLimitMiddleware('oracle'), async (req, res) => {
  try {
    const { price, signature } = req.body;
    const result = await stablecoinService.updatePrice(price, signature);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Trigger rebase
router.post('/rebase', rateLimitMiddleware('invoke'), async (req, res) => {
  try {
    const { adminKey } = req.body;
    const result = await stablecoinService.triggerRebase(adminKey);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get user balance
router.get('/balance/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const balance = await stablecoinService.getBalance(address);
    res.json({
      success: true,
      data: { address, balance }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get transaction history
router.get('/transactions/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const { limit = 20 } = req.query;
    const transactions = await stablecoinService.getTransactions(address, parseInt(limit));
    res.json({
      success: true,
      data: transactions
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Pause contract
router.post('/pause', rateLimitMiddleware('admin'), async (req, res) => {
  try {
    const { adminKey } = req.body;
    const result = await stablecoinService.pause(adminKey);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Unpause contract
router.post('/unpause', rateLimitMiddleware('admin'), async (req, res) => {
  try {
    const { adminKey } = req.body;
    const result = await stablecoinService.unpause(adminKey);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Add reserve
router.post('/reserve/add', rateLimitMiddleware('admin'), async (req, res) => {
  try {
    const { adminKey, amount } = req.body;
    const result = await stablecoinService.addReserve(adminKey, amount);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Withdraw reserve
router.post('/reserve/withdraw', rateLimitMiddleware('admin'), async (req, res) => {
  try {
    const { adminKey, amount } = req.body;
    const result = await stablecoinService.withdrawReserve(adminKey, amount);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
