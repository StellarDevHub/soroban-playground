import express from 'express';
import redisService from '../services/redisService.js';
import { alertManager } from '../utils/alerting.js';
import {
  invalidateCache,
  warmCache,
  listCacheKeys,
  getCacheAdminSnapshot,
  bumpCacheVersion,
} from '../services/cacheService.js';

const router = express.Router();

router.get('/rate-limits', async (req, res) => {
  try {
    const config = await redisService.client.hgetall('config:rate_limits');
    const topIps = await redisService.client.zrevrange('analytics:top_ips', 0, 19, 'WITHSCORES');
    
    // Format top IPs
    const formattedTopIps = [];
    for (let i = 0; i < topIps.length; i += 2) {
      formattedTopIps.push({ ip: topIps[i], count: parseInt(topIps[i+1], 10) });
    }

    res.json({
      config,
      topIps: formattedTopIps,
      fallback: redisService.isFallbackMode
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
    await redisService.client.set(auditKey, JSON.stringify({
      endpoint,
      limit,
      timestamp: new Date().toISOString(),
      user: 'admin' // Simple for now
    }));
    await redisService.client.expire(auditKey, 60 * 60 * 24 * 7); // 7 days

    res.json({ success: true, message: `Limit for ${endpoint} updated to ${limit}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/alerts', (req, res) => {
  try {
    const alerts = alertManager.getRecentAlerts();
    res.json({
      alerts,
      total: alerts.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/cache', async (req, res) => {
  try {
    const snapshot = await getCacheAdminSnapshot();
    res.json({
      success: true,
      snapshot,
      fallback: redisService.isFallbackMode,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/cache/warm', async (req, res) => {
  const { hashes, top } = req.body || {};
  try {
    const warmed = await warmCache({ hashes, top });
    res.json({ success: true, warmed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/cache/invalidate', async (req, res) => {
  const { hash, dependency, namespace } = req.body || {};

  try {
    const result = await invalidateCache({ hash, dependency, namespace });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/cache/keys', async (req, res) => {
  try {
    const keys = await listCacheKeys({
      pattern: req.query.pattern || 'cache:compile:*',
      limit: Number(req.query.limit) || 100,
    });
    res.json({ success: true, keys });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/cache/version/bump', async (req, res) => {
  const { version } = req.body || {};
  if (!version) {
    return res.status(400).json({ error: 'Version is required to bump cache namespace' });
  }

  try {
    const newVersion = await bumpCacheVersion(version);
    res.json({ success: true, version: newVersion });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
