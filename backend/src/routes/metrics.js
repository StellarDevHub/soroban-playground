import express from 'express';
import client from 'prom-client';

const router = express.Router();

// Create a Registry which registers the metrics
const register = new client.Registry();

// Add a default label which is added to all metrics
register.setDefaultLabels({
  app: 'soroban-playground-backend'
});

// Enable the collection of default metrics
client.collectDefaultMetrics({ register });

// Custom metrics
export const rateLimitHits = new client.Counter({
  name: 'rate_limit_hits_total',
  help: 'Total number of rate limit hits',
  labelNames: ['endpoint', 'status']
});
register.registerMetric(rateLimitHits);

export const cacheHitsTotal = new client.Counter({
  name: 'soroban_cache_hits_total',
  help: 'Total number of cache hits',
  labelNames: ['level', 'reason']
});
register.registerMetric(cacheHitsTotal);

export const cacheMissesTotal = new client.Counter({
  name: 'soroban_cache_misses_total',
  help: 'Total number of cache misses',
  labelNames: ['reason']
});
register.registerMetric(cacheMissesTotal);

export const cacheEvictionsTotal = new client.Counter({
  name: 'soroban_cache_evictions_total',
  help: 'Total number of cache evictions and invalidations'
});
register.registerMetric(cacheEvictionsTotal);

export const cacheEntryCount = new client.Gauge({
  name: 'soroban_cache_entry_count',
  help: 'Number of entries currently loaded in L1 cache'
});
register.registerMetric(cacheEntryCount);

export const cacheVersionGauge = new client.Gauge({
  name: 'soroban_cache_version',
  help: 'Current cache namespace version',
  labelNames: ['namespace']
});
register.registerMetric(cacheVersionGauge);

export const cacheLatencyHistogram = new client.Histogram({
  name: 'soroban_cache_latency_seconds',
  help: 'Latency for cache operations',
  labelNames: ['action']
});
register.registerMetric(cacheLatencyHistogram);

export const requestLatency = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.1, 0.5, 1, 2, 5]
});
register.registerMetric(requestLatency);

router.get('/', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (ex) {
    res.status(500).end(ex);
  }
});

export default router;
