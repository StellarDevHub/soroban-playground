import express from 'express';
import redisService from '../services/redisService.js';
import oracleProofQueueService from '../services/oracleProofQueueService.js';

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

export default router;
