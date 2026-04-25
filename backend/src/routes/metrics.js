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
    res.end(await register.metrics());
  } catch (ex) {
    res.status(500).end(ex);
  }
});

export default router;
