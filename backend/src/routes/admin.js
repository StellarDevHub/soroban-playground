import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import redisService from '../services/redisService.js';
import oracleProofQueueService from '../services/oracleProofQueueService.js';
import apiKeyService, {
  normalizeApiKeyScopes,
} from '../services/apiKeyService.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { seedDatabase } from '../../scripts/seed.js';
import cacheService from '../services/cacheService.js';

const _filename = fileURLToPath(import.meta.url);
const _dirname = path.dirname(_filename);

const router = express.Router();

router.get('/rate-limits', async (req, res) => {
  try {
    const config = await redisService.client.hgetall('config:rate_limits');
    const topIps = await redisService.client.zrevrange(
      'analytics:top_ips',
      0,
      19,
      'WITHSCORES'
    );

    // Format top IPs
    const formattedTopIps = [];
    for (let i = 0; i < topIps.length; i += 2) {
      formattedTopIps.push({
        ip: topIps[i],
        count: parseInt(topIps[i + 1], 10),
      });
    }

    res.json({
      config,
      topIps: formattedTopIps,
      fallback: redisService.isFallbackMode,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/rate-limits', async (req, res) => {
  const { endpoint, limit } = req.body;

  if (!endpoint || !limit) {
    return res.status(400).json({ error: 'Endpoint and limit are required' });
  }

  try {
    await redisService.client.hset('config:rate_limits', endpoint, limit);

    // Log audit change
    const auditKey = `audit:config:${Date.now()}`;
    await redisService.client.set(
      auditKey,
      JSON.stringify({
        endpoint,
        limit,
        timestamp: new Date().toISOString(),
        user: 'admin', // Simple for now
      })
    );
    await redisService.client.expire(auditKey, 60 * 60 * 24 * 7); // 7 days

    res.json({
      success: true,
      message: `Limit for ${endpoint} updated to ${limit}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/oracle-queue', async (_req, res) => {
  try {
    res.json(await oracleProofQueueService.getStatus());
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.get('/oracle-queue/dead-letter', async (req, res) => {
  try {
    const tasks = await oracleProofQueueService.listDeadLetter(
      req.query.limit || 50
    );
    res.json({ tasks, count: tasks.length });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post('/oracle-queue/dead-letter/:id/requeue', async (req, res) => {
  try {
    const task = await oracleProofQueueService.requeueDeadLetter(req.params.id);
    res.json({ success: true, task });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// API Key Management Endpoints

// Generate new API key
router.post('/api-keys', requireTenantContext(), async (req, res) => {
  try {
    const {
      name,
      description,
      tier,
      userId,
      organizationId,
      expiresAt,
      scopes,
    } = req.body;

    if (!name || !tier) {
      return res.status(400).json({ error: 'Name and tier are required' });
    }

    if (!['free', 'standard', 'premium', 'admin'].includes(tier)) {
      return res.status(400).json({
        error: 'Invalid tier. Must be one of: free, standard, premium, admin',
      });
    }

    let normalizedScopes;
    try {
      normalizedScopes = normalizeApiKeyScopes(scopes);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const keyData = await apiKeyService.generateKey({
      name,
      description,
      tier,
      userId: userId || 1, // Default to first user for now
      organizationId,
      tenantId: req.tenant.id,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      scopes: normalizedScopes,
    });

    res.json(keyData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post(
  '/api-keys/:id/rotate',
  requireTenantContext(),
  async (req, res) => {
    try {
      const { name, scopes, overlapSeconds, rotationCutoffAt } = req.body;
      let normalizedScopes;
      if (scopes !== undefined) {
        try {
          normalizedScopes = normalizeApiKeyScopes(scopes);
        } catch (err) {
          return res.status(400).json({ error: err.message });
        }
      }

      const keyData = await apiKeyService.rotateKey(req.params.id, {
        name,
        scopes: normalizedScopes,
        overlapSeconds,
        rotationCutoffAt,
        tenantId: req.tenant.id,
      });

      res.json(keyData);
    } catch (err) {
      const status = err.message.includes('not found') ? 404 : 400;
      res.status(status).json({ error: err.message });
    }
  }
);

router.post(
  '/api-keys/rotation/:groupId/complete',
  requireTenantContext(),
  async (req, res) => {
    try {
      const result = await apiKeyService.completeRotation(req.params.groupId, {
        tenantId: req.tenant.id,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// List API keys
router.get('/api-keys', requireTenantContext(), async (req, res) => {
  try {
    const { userId, status, limit, offset } = req.query;

    const keys = await apiKeyService.listKeys(
      userId || 1, // Default to first user
      {
        status,
        tenantId: req.tenant.id,
        limit: parseInt(limit) || 50,
        offset: parseInt(offset) || 0,
      }
    );

    res.json({ keys, count: keys.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get API key details
router.get('/api-keys/:id', requireTenantContext(), async (req, res) => {
  try {
    const key = await apiKeyService.getKeyById(req.params.id, {
      tenantId: req.tenant.id,
    });
    if (!key) {
      return res.status(404).json({ error: 'API key not found' });
    }
    res.json(key);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Revoke API key
router.delete('/api-keys/:id', requireTenantContext(), async (req, res) => {
  try {
    const { reason } = req.body;
    await apiKeyService.revokeKey(req.params.id, reason || 'revoked', {
      tenantId: req.tenant.id,
    });
    res.json({ success: true, message: 'API key revoked' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get API key usage statistics
router.get('/api-keys/:id/usage', requireTenantContext(), async (req, res) => {
  try {
    const { days } = req.query;
    const stats = await apiKeyService.getUsageStats(req.params.id, {
      days: parseInt(days) || 30,
      tenantId: req.tenant.id,
    });
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get global rate limit statistics
router.get('/rate-limits/stats', async (req, res) => {
  try {
    // Get tier distribution
    const tierStats = (await redisService.client.hgetall('stats:tiers')) || {};

    // Get recent violations
    const violations = await redisService.client.zrevrange(
      'stats:violations',
      0,
      9,
      'WITHSCORES'
    );

    const formattedViolations = [];
    for (let i = 0; i < violations.length; i += 2) {
      formattedViolations.push({
        identifier: violations[i],
        count: parseInt(violations[i + 1], 10),
      });
    }

    res.json({
      tierStats,
      recentViolations: formattedViolations,
      fallbackMode: redisService.isFallbackMode,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clean and reset database route
router.post('/reset-database', async (req, res) => {
  try {
    const { users = 50, projects = 200, files = 500 } = req.body;
    const dbPath =
      process.env.MIGRATION_DB_PATH ||
      path.join(_dirname, '../../data/soroban_playground.sqlite');

    await seedDatabase({ dbPath, users, projects, files });
    res.json({
      success: true,
      message: 'Database reset and seeded successfully',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cache admin endpoints
router.get('/cache', async (req, res) => {
  try {
    const snapshot = await cacheService.getCacheAdminSnapshot();
    res.json({ success: true, snapshot });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/cache/warm', async (req, res) => {
  try {
    const { hashes, top } = req.body;
    const result = await cacheService.warmCache({ hashes, top });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/cache/invalidate', async (req, res) => {
  try {
    const { hash, dependency, namespace } = req.body;
    const result = await cacheService.invalidateCache({
      hash,
      dependency,
      namespace,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/cache/version/bump', async (req, res) => {
  try {
    const { version } = req.body;
    const newVersion = await cacheService.bumpCacheVersion({ version });
    res.json({ success: true, version: newVersion });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
