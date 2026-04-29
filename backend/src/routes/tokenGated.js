import express from 'express';
import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';
import { invokeSorobanContract } from '../services/invokeService.js';
import cacheService from '../services/cacheService.js';
import { rateLimitMiddleware } from '../middleware/rateLimiter.js';
import { emitTokenGatedEvent } from '../services/tokenGatedService.js';

const router = express.Router();

// Mocked contract ID for the Token Gated Access contract
// In a real scenario, this would be configured or passed in the request
const TOKEN_GATED_CONTRACT_ID = process.env.TOKEN_GATED_CONTRACT_ID || 'C...'; 

/**
 * GET /api/token-gated/rules
 * Fetch all gating rules from the contract (with caching)
 */
router.get(
  '/rules',
  rateLimitMiddleware('standard'),
  asyncHandler(async (req, res) => {
    const cacheKey = 'token-gated:rules';
    const cachedRules = await cacheService.get(cacheKey);

    if (cachedRules) {
      return res.json({ success: true, data: JSON.parse(cachedRules), cached: true });
    }

    // In a real scenario, we might have a function to get all rules
    // For now, we'll assume we know the resources we want to check
    // or the contract has a way to list them.
    // This is a simplified fetch for the example.
    const resources = ['vip_content', 'beta_access', 'premium_dashboard'];
    const rules = [];

    for (const resource of resources) {
      try {
        const result = await invokeSorobanContract({
          requestId: `rules-fetch-${Date.now()}`,
          contractId: TOKEN_GATED_CONTRACT_ID,
          functionName: 'get_rule',
          args: { resource },
          network: 'testnet',
        });
        if (result.success) {
          rules.push({ resource, ...result.parsed });
        }
      } catch (err) {
        // Skip resources that don't have rules yet
      }
    }

    await cacheService.set(cacheKey, JSON.stringify(rules), 300); // Cache for 5 minutes

    res.json({ success: true, data: rules, cached: false });
  })
);

/**
 * POST /api/token-gated/verify
 * Verify if a user has access to a specific resource
 */
router.post(
  '/verify',
  rateLimitMiddleware('standard'),
  asyncHandler(async (req, res, next) => {
    const { user, resource } = req.body;

    if (!user || !resource) {
      return next(createHttpError(400, 'User address and resource ID are required'));
    }

    try {
      const result = await invokeSorobanContract({
        requestId: `verify-${Date.now()}`,
        contractId: TOKEN_GATED_CONTRACT_ID,
        functionName: 'check_access',
        args: { user, resource },
        network: 'testnet',
      });

      if (!result.success) {
        return next(createHttpError(500, 'Contract invocation failed', [result.stderr]));
      }

      const hasAccess = result.parsed === true;

      emitTokenGatedEvent('access_checked', {
        user,
        resource,
        hasAccess,
        success: true
      });

      res.json({
        success: true,
        data: {
          user,
          resource,
          hasAccess,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      emitTokenGatedEvent('access_checked', {
        user,
        resource,
        success: false,
        error: error.message
      });
      return next(createHttpError(502, 'Verification failed', [error.message]));
    }
  })
);

/**
 * GET /api/token-gated/health
 * Health check for the token gating service
 */
router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'token-gated-access' });
});

export default router;
