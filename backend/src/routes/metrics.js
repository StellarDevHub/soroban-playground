import express from 'express';
import client from 'prom-client';
import { oracleLockRegistry } from '../services/oracle/lockMetrics.js';

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

// Oracle Queue Metrics
export const oracleTasksEnqueued = new client.Counter({
  name: 'oracle_tasks_enqueued_total',
  help: 'Total number of proof tasks enqueued',
});
register.registerMetric(oracleTasksEnqueued);

export const oracleTasksProcessed = new client.Counter({
  name: 'oracle_tasks_processed_total',
  help: 'Total number of proof tasks processed by workers',
  labelNames: ['status'] // 'success', 'failure'
});
register.registerMetric(oracleTasksProcessed);

export const oracleQueueDepth = new client.Gauge({
  name: 'oracle_queue_depth',
  help: 'Current number of tasks in the pending queue'
});
register.registerMetric(oracleQueueDepth);

export const oracleProcessingDuration = new client.Histogram({
  name: 'oracle_task_processing_duration_seconds',
  help: 'Duration of proof task processing in seconds',
  buckets: [0.1, 0.5, 1, 2, 5, 10]
});
register.registerMetric(oracleProcessingDuration);

router.get('/', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    const merged = await client.Registry.merge([register, oracleLockRegistry]).metrics();
    res.end(merged);
  } catch (ex) {
    res.status(500).end(ex);
  }
});

export default router;
