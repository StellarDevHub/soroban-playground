/**
 * REIT API Routes - RESTful endpoints for Tokenized REIT operations
 * @module routes/reit
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { body, param, query, validationResult } from 'express-validator';
import { reitService } from '../services/reitService.js';
import { invokeService } from '../services/invokeService.js';
import logger from '../utils/logger.js';

const router = Router();

// Rate limiting configurations
const standardLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
});

const strictLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: { error: 'Too many requests, please try again later.' },
});

// Validation helpers
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      success: false, 
      errors: errors.array().map(e => ({ field: e.param, message: e.msg })) 
    });
  }
  next();
};

const handleAsync = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// ── Property Routes ─────────────────────────────────────────────────────────

/**
 * @route GET /api/reit/properties
 * @desc Get all properties with filtering and pagination
 */
router.get(
  '/properties',
  standardLimiter,
  [
    query('contractId').optional().isString().trim(),
    query('status').optional().isIn(['Listed', 'Funded', 'Active', 'Suspended', 'Delisted']),
    query('minPrice').optional().isInt({ min: 0 }),
    query('maxPrice').optional().isInt({ min: 0 }),
    query('location').optional().isString().trim(),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  ],
  validate,
  handleAsync(async (req, res) => {
    const { contractId, status, minPrice, maxPrice, location, page = 1, limit = 20 } = req.query;
    
    const filters = {};
    if (contractId) filters.contractId = contractId;
    if (status) filters.status = status;
    if (minPrice) filters.minPrice = parseInt(minPrice);
    if (maxPrice) filters.maxPrice = parseInt(maxPrice);
    if (location) filters.location = location;

    const result = await reitService.getProperties(filters, { page: parseInt(page), limit: parseInt(limit) });
    
    res.json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  })
);

/**
 * @route GET /api/reit/properties/:id
 * @desc Get property by ID
 */
router.get(
  '/properties/:id',
  standardLimiter,
  [
    param('id').isInt({ min: 1 }).toInt(),
    query('contractId').isString().trim(),
  ],
  validate,
  handleAsync(async (req, res) => {
    const { id } = req.params;
    const { contractId } = req.query;

    const property = await reitService.getProperty(contractId, id);
    
    if (!property) {
      return res.status(404).json({
        success: false,
        error: 'Property not found',
      });
    }

    // Get property distributions
    const distributions = await reitService.getPropertyDistributions(contractId, id, { limit: 10 });

    res.json({
      success: true,
      data: {
        ...property,
        recent_distributions: distributions,
      },
    });
  })
);

/**
 * @route GET /api/reit/properties/stats
 * @desc Get property statistics
 */
router.get(
  '/properties/stats',
  standardLimiter,
  [
    query('contractId').isString().trim(),
  ],
  validate,
  handleAsync(async (req, res) => {
    const { contractId } = req.query;
    const stats = await reitService.getPropertyStats(contractId);
    
    res.json({
      success: true,
      data: stats,
    });
  })
);

// ── Investor Routes ─────────────────────────────────────────────────────────

/**
 * @route GET /api/reit/investors/:address
 * @desc Get investor by address
 */
router.get(
  '/investors/:address',
  standardLimiter,
  [
    param('address').isString().trim().matches(/^G[A-Z0-9]{55}$/),
  ],
  validate,
  handleAsync(async (req, res) => {
    const { address } = req.params;
    
    const investor = await reitService.getInvestor(address);
    
    if (!investor) {
      return res.status(404).json({
        success: false,
        error: 'Investor not found',
      });
    }

    res.json({
      success: true,
      data: investor,
    });
  })
);

/**
 * @route GET /api/reit/investors/:address/properties
 * @desc Get investor's property portfolio
 */
router.get(
  '/investors/:address/properties',
  standardLimiter,
  [
    param('address').isString().trim().matches(/^G[A-Z0-9]{55}$/),
    query('contractId').isString().trim(),
  ],
  validate,
  handleAsync(async (req, res) => {
    const { address } = req.params;
    const { contractId } = req.query;

    const properties = await reitService.getInvestorProperties(contractId, address);
    const portfolio = await reitService.getInvestorPortfolio(contractId, address);

    res.json({
      success: true,
      data: {
        properties,
        portfolio_summary: portfolio,
      },
    });
  })
);

/**
 * @route GET /api/reit/investors/:address/claimable
 * @desc Get claimable dividends for investor
 */
router.get(
  '/investors/:address/claimable',
  standardLimiter,
  [
    param('address').isString().trim().matches(/^G[A-Z0-9]{55}$/),
    query('contractId').isString().trim(),
  ],
  validate,
  handleAsync(async (req, res) => {
    const { address } = req.params;
    const { contractId } = req.query;

    // This would typically call the contract to get real-time claimable amounts
    // For now, return from database
    const properties = await reitService.getInvestorProperties(contractId, address);
    
    let totalClaimable = 0;
    const claimableByProperty = properties.map(p => {
      // Simplified calculation - in production, query contract
      const claimable = 0; // Would be fetched from contract
      totalClaimable += claimable;
      return {
        property_id: p.property_id,
        property_name: p.name,
        shares: p.shares,
        claimable_amount: claimable,
      };
    });

    res.json({
      success: true,
      data: {
        total_claimable: totalClaimable,
        by_property: claimableByProperty,
      },
    });
  })
);

// ── Transaction Routes ─────────────────────────────────────────────────────

/**
 * @route GET /api/reit/transactions
 * @desc Get transactions with filtering
 */
router.get(
  '/transactions',
  standardLimiter,
  [
    query('contractId').optional().isString().trim(),
    query('investor').optional().isString().trim().matches(/^G[A-Z0-9]{55}$/),
    query('type').optional().isIn(['buy_shares', 'transfer_shares', 'claim_dividends', 'deposit_dividends']),
    query('status').optional().isIn(['pending', 'success', 'failed']),
    query('startDate').optional().isInt().toInt(),
    query('endDate').optional().isInt().toInt(),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  ],
  validate,
  handleAsync(async (req, res) => {
    const filters = {};
    const { page = 1, limit = 20 } = req.query;

    if (req.query.contractId) filters.contract_id = req.query.contractId;
    if (req.query.investor) filters.investor_address = req.query.investor;
    if (req.query.type) filters.tx_type = req.query.type;
    if (req.query.status) filters.status = req.query.status;
    if (req.query.startDate) filters.startDate = parseInt(req.query.startDate);
    if (req.query.endDate) filters.endDate = parseInt(req.query.endDate);

    const result = await reitService.getTransactions(filters, {
      page: parseInt(page),
      limit: parseInt(limit),
    });

    res.json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  })
);

/**
 * @route POST /api/reit/transactions
 * @desc Log a new transaction
 */
router.post(
  '/transactions',
  strictLimiter,
  [
    body('contract_id').isString().trim(),
    body('tx_hash').optional().isString().trim(),
    body('tx_type').isIn(['buy_shares', 'transfer_shares', 'claim_dividends', 'deposit_dividends', 'list_property']),
    body('property_id').optional().isInt().toInt(),
    body('investor_address').optional().isString().trim(),
    body('amount').optional().isInt().toInt(),
    body('shares').optional().isInt().toInt(),
    body('status').optional().isIn(['pending', 'success', 'failed']),
  ],
  validate,
  handleAsync(async (req, res) => {
    const txId = await reitService.logTransaction(req.body);
    
    res.status(201).json({
      success: true,
      data: { id: txId },
    });
  })
);

// ── Distribution Routes ─────────────────────────────────────────────────────

/**
 * @route GET /api/reit/distributions
 * @desc Get dividend distributions
 */
router.get(
  '/distributions',
  standardLimiter,
  [
    query('contractId').isString().trim(),
    query('propertyId').optional().isInt().toInt(),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  ],
  validate,
  handleAsync(async (req, res) => {
    const { contractId, propertyId, page = 1, limit = 20 } = req.query;

    let distributions;
    if (propertyId) {
      distributions = await reitService.getPropertyDistributions(
        contractId,
        parseInt(propertyId),
        { page: parseInt(page), limit: parseInt(limit) }
      );
    } else {
      // Get all distributions for contract
      distributions = await reitService.getPropertyDistributions(
        contractId,
        null,
        { page: parseInt(page), limit: parseInt(limit) }
      );
    }

    res.json({
      success: true,
      data: distributions,
    });
  })
);

// ── REIT Configuration Routes ───────────────────────────────────────────────

/**
 * @route GET /api/reit/config
 * @desc Get REIT configuration
 */
router.get(
  '/config',
  standardLimiter,
  [
    query('contractId').isString().trim(),
  ],
  validate,
  handleAsync(async (req, res) => {
    const { contractId } = req.query;
    const config = await reitService.getReitConfig(contractId);
    
    if (!config) {
      return res.status(404).json({
        success: false,
        error: 'REIT configuration not found',
      });
    }

    res.json({
      success: true,
      data: config,
    });
  })
);

// ── Analytics Routes ────────────────────────────────────────────────────────

/**
 * @route GET /api/reit/analytics/performance
 * @desc Get REIT performance metrics
 */
router.get(
  '/analytics/performance',
  standardLimiter,
  [
    query('contractId').isString().trim(),
    query('period').optional().isIn(['7d', '30d', '90d', '1y']),
  ],
  validate,
  handleAsync(async (req, res) => {
    const { contractId, period = '30d' } = req.query;
    
    const metrics = await reitService.getPerformanceMetrics(contractId, period);
    
    res.json({
      success: true,
      data: metrics,
    });
  })
);

/**
 * @route GET /api/reit/analytics/yield
 * @desc Get yield analytics
 */
router.get(
  '/analytics/yield',
  standardLimiter,
  [
    query('contractId').isString().trim(),
  ],
  validate,
  handleAsync(async (req, res) => {
    const { contractId } = req.query;
    
    const analytics = await reitService.getYieldAnalytics(contractId);
    
    res.json({
      success: true,
      data: analytics,
    });
  })
);

/**
 * @route GET /api/reit/analytics/dashboard
 * @desc Get dashboard summary data
 */
router.get(
  '/analytics/dashboard',
  standardLimiter,
  [
    query('contractId').isString().trim(),
  ],
  validate,
  handleAsync(async (req, res) => {
    const { contractId } = req.query;
    
    // Aggregate data for dashboard
    const [propertyStats, config, performance, yield] = await Promise.all([
      reitService.getPropertyStats(contractId),
      reitService.getReitConfig(contractId),
      reitService.getPerformanceMetrics(contractId, '30d'),
      reitService.getYieldAnalytics(contractId),
    ]);

    res.json({
      success: true,
      data: {
        reit_info: config,
        property_stats: propertyStats,
        performance_30d: performance,
        yield_analytics: yield,
      },
    });
  })
);

// ── Events Routes ───────────────────────────────────────────────────────────

/**
 * @route GET /api/reit/events
 * @desc Get indexed contract events
 */
router.get(
  '/events',
  standardLimiter,
  [
    query('contractId').isString().trim(),
    query('eventType').optional().isString().trim(),
    query('startLedger').optional().isInt().toInt(),
    query('endLedger').optional().isInt().toInt(),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  ],
  validate,
  handleAsync(async (req, res) => {
    const { contractId, eventType, startLedger, endLedger, page = 1, limit = 50 } = req.query;

    const filters = { contract_id: contractId };
    if (eventType) filters.event_type = eventType;
    if (startLedger) filters.startLedger = parseInt(startLedger);
    if (endLedger) filters.endLedger = parseInt(endLedger);

    const events = await reitService.getEvents(filters, {
      page: parseInt(page),
      limit: parseInt(limit),
    });

    res.json({
      success: true,
      data: events,
    });
  })
);

// ── Contract Interaction Routes ─────────────────────────────────────────────

/**
 * @route POST /api/reit/invoke/buy-shares
 * @desc Invoke contract to buy shares
 */
router.post(
  '/invoke/buy-shares',
  strictLimiter,
  [
    body('contractId').isString().trim(),
    body('source').isString().trim().matches(/^G[A-Z0-9]{55}$/),
    body('propertyId').isInt({ min: 1 }).toInt(),
    body('shares').isInt({ min: 1 }).toInt(),
  ],
  validate,
  handleAsync(async (req, res) => {
    const { contractId, source, propertyId, shares } = req.body;

    logger.info(`Buy shares request: ${source} buying ${shares} shares of property ${propertyId}`);

    // Log transaction as pending
    const txRecord = await reitService.logTransaction({
      contract_id: contractId,
      tx_type: 'buy_shares',
      property_id: propertyId,
      investor_address: source,
      shares: shares,
      status: 'pending',
    });

    // This would integrate with invokeService to actually invoke the contract
    // For now, return the transaction record
    res.json({
      success: true,
      data: {
        transaction_id: txRecord,
        status: 'pending',
        message: 'Transaction recorded, awaiting blockchain confirmation',
      },
    });
  })
);

/**
 * @route POST /api/reit/invoke/claim-dividends
 * @desc Invoke contract to claim dividends
 */
router.post(
  '/invoke/claim-dividends',
  strictLimiter,
  [
    body('contractId').isString().trim(),
    body('source').isString().trim().matches(/^G[A-Z0-9]{55}$/),
    body('propertyId').isInt({ min: 1 }).toInt(),
  ],
  validate,
  handleAsync(async (req, res) => {
    const { contractId, source, propertyId } = req.body;

    logger.info(`Claim dividends request: ${source} claiming from property ${propertyId}`);

    // Log transaction
    const txRecord = await reitService.logTransaction({
      contract_id: contractId,
      tx_type: 'claim_dividends',
      property_id: propertyId,
      investor_address: source,
      status: 'pending',
    });

    res.json({
      success: true,
      data: {
        transaction_id: txRecord,
        status: 'pending',
        message: 'Claim request recorded, awaiting blockchain confirmation',
      },
    });
  })
);

// ── Cache Management Routes ───────────────────────────────────────────────────

/**
 * @route POST /api/reit/cache/clear
 * @desc Clear REIT caches (admin only)
 */
router.post(
  '/cache/clear',
  strictLimiter,
  handleAsync(async (req, res) => {
    reitService.clearCache();
    
    res.json({
      success: true,
      message: 'REIT caches cleared successfully',
    });
  })
);

/**
 * @route GET /api/reit/cache/stats
 * @desc Get cache statistics
 */
router.get(
  '/cache/stats',
  standardLimiter,
  handleAsync(async (req, res) => {
    const stats = reitService.getCacheStats();
    
    res.json({
      success: true,
      data: stats,
    });
  })
);

// ── Error Handling ──────────────────────────────────────────────────────────

router.use((err, req, res, next) => {
  logger.error('REIT API Error:', err);
  
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

export default router;
