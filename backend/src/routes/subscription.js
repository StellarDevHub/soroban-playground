// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';
import { 
  createSubscriptionPlan,
  getSubscriptionPlans,
  getSubscriptionPlan,
  updateSubscriptionPlan,
  deleteSubscriptionPlan,
  createSubscription,
  getUserSubscriptions,
  getSubscription,
  cancelSubscription,
  renewSubscription,
  toggleAutoRenew,
  getSubscriptionStats,
  pauseContract,
  updatePlatformFee,
  transferAdmin
} from '../services/subscriptionService.js';
import { rateLimitMiddleware } from '../middleware/rateLimiter.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Apply authentication to all subscription routes
router.use(authenticateToken);

// === Plan Management ===

/**
 * Validates subscription plan creation request
 */
function validateCreatePlanRequest(body) {
  const { planId, name, pricePerPeriod, billingPeriod, isActive = true } = body;
  const errors = [];

  if (!planId || typeof planId !== 'string') {
    errors.push('planId is required and must be a string');
  }

  if (!name || typeof name !== 'string') {
    errors.push('name is required and must be a string');
  }

  if (!pricePerPeriod || typeof pricePerPeriod !== 'number' || pricePerPeriod <= 0) {
    errors.push('pricePerPeriod is required and must be a positive number');
  }

  if (!billingPeriod || typeof billingPeriod !== 'number' || billingPeriod <= 0) {
    errors.push('billingPeriod is required and must be a positive number');
  }

  if (typeof isActive !== 'boolean') {
    errors.push('isActive must be a boolean');
  }

  if (errors.length > 0) {
    return {
      error: 'Validation failed',
      details: errors,
    };
  }

  return null;
}

/**
 * POST /api/subscription/plans
 * Create a new subscription plan
 */
router.post(
  '/plans',
  rateLimitMiddleware('create_plan'),
  asyncHandler(async (req, res, next) => {
    // Validate request payload
    const validationError = validateCreatePlanRequest(req.body);
    if (validationError) {
      return next(
        createHttpError(400, validationError.error, validationError.details)
      );
    }

    try {
      const result = await createSubscriptionPlan({
        ...req.body,
        createdBy: req.user.id,
      });

      res.status(201).json({
        success: true,
        data: result,
        message: 'Subscription plan created successfully',
      });
    } catch (error) {
      return next(
        createHttpError(500, 'Failed to create subscription plan', [error.message])
      );
    }
  })
);

/**
 * GET /api/subscription/plans
 * Get all subscription plans
 */
router.get(
  '/plans',
  rateLimitMiddleware('get_plans'),
  asyncHandler(async (req, res, next) => {
    try {
      const { active, page = 1, limit = 10 } = req.query;
      
      const result = await getSubscriptionPlans({
        active: active === 'true',
        page: parseInt(page),
        limit: parseInt(limit),
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      return next(
        createHttpError(500, 'Failed to get subscription plans', [error.message])
      );
    }
  })
);

/**
 * GET /api/subscription/plans/:planId
 * Get a specific subscription plan
 */
router.get(
  '/plans/:planId',
  rateLimitMiddleware('get_plan'),
  asyncHandler(async (req, res, next) => {
    try {
      const { planId } = req.params;
      
      const result = await getSubscriptionPlan(planId);

      if (!result) {
        return next(createHttpError(404, 'Subscription plan not found'));
      }

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      return next(
        createHttpError(500, 'Failed to get subscription plan', [error.message])
      );
    }
  })
);

/**
 * PUT /api/subscription/plans/:planId
 * Update a subscription plan
 */
router.put(
  '/plans/:planId',
  rateLimitMiddleware('update_plan'),
  asyncHandler(async (req, res, next) => {
    try {
      const { planId } = req.params;
      const updates = req.body;

      const result = await updateSubscriptionPlan(planId, updates, req.user.id);

      if (!result) {
        return next(createHttpError(404, 'Subscription plan not found'));
      }

      res.json({
        success: true,
        data: result,
        message: 'Subscription plan updated successfully',
      });
    } catch (error) {
      return next(
        createHttpError(500, 'Failed to update subscription plan', [error.message])
      );
    }
  })
);

/**
 * DELETE /api/subscription/plans/:planId
 * Delete a subscription plan
 */
router.delete(
  '/plans/:planId',
  rateLimitMiddleware('delete_plan'),
  asyncHandler(async (req, res, next) => {
    try {
      const { planId } = req.params;

      const result = await deleteSubscriptionPlan(planId, req.user.id);

      if (!result) {
        return next(createHttpError(404, 'Subscription plan not found'));
      }

      res.json({
        success: true,
        message: 'Subscription plan deleted successfully',
      });
    } catch (error) {
      return next(
        createHttpError(500, 'Failed to delete subscription plan', [error.message])
      );
    }
  })
);

// === Subscription Management ===

/**
 * Validates subscription creation request
 */
function validateCreateSubscriptionRequest(body) {
  const { planId, paymentMethod } = body;
  const errors = [];

  if (!planId || typeof planId !== 'string') {
    errors.push('planId is required and must be a string');
  }

  if (!paymentMethod || typeof paymentMethod !== 'string') {
    errors.push('paymentMethod is required and must be a string');
  }

  if (errors.length > 0) {
    return {
      error: 'Validation failed',
      details: errors,
    };
  }

  return null;
}

/**
 * POST /api/subscription/subscriptions
 * Create a new subscription
 */
router.post(
  '/subscriptions',
  rateLimitMiddleware('create_subscription'),
  asyncHandler(async (req, res, next) => {
    // Validate request payload
    const validationError = validateCreateSubscriptionRequest(req.body);
    if (validationError) {
      return next(
        createHttpError(400, validationError.error, validationError.details)
      );
    }

    try {
      const result = await createSubscription({
        ...req.body,
        userId: req.user.id,
      });

      res.status(201).json({
        success: true,
        data: result,
        message: 'Subscription created successfully',
      });
    } catch (error) {
      return next(
        createHttpError(500, 'Failed to create subscription', [error.message])
      );
    }
  })
);

/**
 * GET /api/subscription/subscriptions
 * Get user's subscriptions
 */
router.get(
  '/subscriptions',
  rateLimitMiddleware('get_subscriptions'),
  asyncHandler(async (req, res, next) => {
    try {
      const { status, page = 1, limit = 10 } = req.query;
      
      const result = await getUserSubscriptions(req.user.id, {
        status,
        page: parseInt(page),
        limit: parseInt(limit),
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      return next(
        createHttpError(500, 'Failed to get subscriptions', [error.message])
      );
    }
  })
);

/**
 * GET /api/subscription/subscriptions/:subscriptionId
 * Get a specific subscription
 */
router.get(
  '/subscriptions/:subscriptionId',
  rateLimitMiddleware('get_subscription'),
  asyncHandler(async (req, res, next) => {
    try {
      const { subscriptionId } = req.params;
      
      const result = await getSubscription(subscriptionId, req.user.id);

      if (!result) {
        return next(createHttpError(404, 'Subscription not found'));
      }

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      return next(
        createHttpError(500, 'Failed to get subscription', [error.message])
      );
    }
  })
);

/**
 * POST /api/subscription/subscriptions/:subscriptionId/cancel
 * Cancel a subscription
 */
router.post(
  '/subscriptions/:subscriptionId/cancel',
  rateLimitMiddleware('cancel_subscription'),
  asyncHandler(async (req, res, next) => {
    try {
      const { subscriptionId } = req.params;

      const result = await cancelSubscription(subscriptionId, req.user.id);

      if (!result) {
        return next(createHttpError(404, 'Subscription not found'));
      }

      res.json({
        success: true,
        data: result,
        message: 'Subscription cancelled successfully',
      });
    } catch (error) {
      return next(
        createHttpError(500, 'Failed to cancel subscription', [error.message])
      );
    }
  })
);

/**
 * POST /api/subscription/subscriptions/:subscriptionId/renew
 * Renew a subscription
 */
router.post(
  '/subscriptions/:subscriptionId/renew',
  rateLimitMiddleware('renew_subscription'),
  asyncHandler(async (req, res, next) => {
    try {
      const { subscriptionId } = req.params;

      const result = await renewSubscription(subscriptionId, req.user.id);

      if (!result) {
        return next(createHttpError(404, 'Subscription not found'));
      }

      res.json({
        success: true,
        data: result,
        message: 'Subscription renewed successfully',
      });
    } catch (error) {
      return next(
        createHttpError(500, 'Failed to renew subscription', [error.message])
      );
    }
  })
);

/**
 * POST /api/subscription/subscriptions/:subscriptionId/auto-renew
 * Toggle auto-renew for a subscription
 */
router.post(
  '/subscriptions/:subscriptionId/auto-renew',
  rateLimitMiddleware('toggle_auto_renew'),
  asyncHandler(async (req, res, next) => {
    try {
      const { subscriptionId } = req.params;
      const { autoRenew } = req.body;

      if (typeof autoRenew !== 'boolean') {
        return next(createHttpError(400, 'autoRenew must be a boolean'));
      }

      const result = await toggleAutoRenew(subscriptionId, req.user.id, autoRenew);

      if (!result) {
        return next(createHttpError(404, 'Subscription not found'));
      }

      res.json({
        success: true,
        data: result,
        message: `Auto-renew ${autoRenew ? 'enabled' : 'disabled'} successfully`,
      });
    } catch (error) {
      return next(
        createHttpError(500, 'Failed to toggle auto-renew', [error.message])
      );
    }
  })
);

// === Admin Functions ===

/**
 * GET /api/subscription/stats
 * Get subscription statistics (admin only)
 */
router.get(
  '/stats',
  rateLimitMiddleware('get_stats'),
  asyncHandler(async (req, res, next) => {
    try {
      // Check if user is admin
      if (!req.user.isAdmin) {
        return next(createHttpError(403, 'Admin access required'));
      }

      const result = await getSubscriptionStats();

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      return next(
        createHttpError(500, 'Failed to get subscription stats', [error.message])
      );
    }
  })
);

/**
 * POST /api/subscription/admin/pause
 * Pause/unpause the contract (admin only)
 */
router.post(
  '/admin/pause',
  rateLimitMiddleware('pause_contract'),
  asyncHandler(async (req, res, next) => {
    try {
      // Check if user is admin
      if (!req.user.isAdmin) {
        return next(createHttpError(403, 'Admin access required'));
      }

      const { paused } = req.body;

      if (typeof paused !== 'boolean') {
        return next(createHttpError(400, 'paused must be a boolean'));
      }

      const result = await pauseContract(paused, req.user.id);

      res.json({
        success: true,
        data: result,
        message: `Contract ${paused ? 'paused' : 'unpaused'} successfully`,
      });
    } catch (error) {
      return next(
        createHttpError(500, 'Failed to pause contract', [error.message])
      );
    }
  })
);

/**
 * POST /api/subscription/admin/platform-fee
 * Update platform fee (admin only)
 */
router.post(
  '/admin/platform-fee',
  rateLimitMiddleware('update_platform_fee'),
  asyncHandler(async (req, res, next) => {
    try {
      // Check if user is admin
      if (!req.user.isAdmin) {
        return next(createHttpError(403, 'Admin access required'));
      }

      const { feeBps } = req.body;

      if (typeof feeBps !== 'number' || feeBps < 0 || feeBps > 1000) {
        return next(createHttpError(400, 'feeBps must be a number between 0 and 1000'));
      }

      const result = await updatePlatformFee(feeBps, req.user.id);

      res.json({
        success: true,
        data: result,
        message: 'Platform fee updated successfully',
      });
    } catch (error) {
      return next(
        createHttpError(500, 'Failed to update platform fee', [error.message])
      );
    }
  })
);

/**
 * POST /api/subscription/admin/transfer-admin
 * Transfer admin rights (admin only)
 */
router.post(
  '/admin/transfer-admin',
  rateLimitMiddleware('transfer_admin'),
  asyncHandler(async (req, res, next) => {
    try {
      // Check if user is admin
      if (!req.user.isAdmin) {
        return next(createHttpError(403, 'Admin access required'));
      }

      const { newAdminAddress } = req.body;

      if (!newAdminAddress || typeof newAdminAddress !== 'string') {
        return next(createHttpError(400, 'newAdminAddress is required and must be a string'));
      }

      const result = await transferAdmin(newAdminAddress, req.user.id);

      res.json({
        success: true,
        data: result,
        message: 'Admin rights transferred successfully',
      });
    } catch (error) {
      return next(
        createHttpError(500, 'Failed to transfer admin rights', [error.message])
      );
    }
  })
);

export default router;
