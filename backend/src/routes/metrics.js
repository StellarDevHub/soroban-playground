import express from 'express';
import client from 'prom-client';
import { oracleLockRegistry } from '../services/oracle/lockMetrics.js';
import { tieredCacheMetrics } from '../services/multiLevelCache.js';
import { kafkaConsumerRegistry } from '../metrics/kafkaConsumerMetrics.js';
import { metricsAuthMiddleware } from '../telemetry/middleware.js';

const router = express.Router();

// Create a Registry which registers the metrics
const register = new client.Registry();

// Add a default label which is added to all metrics
register.setDefaultLabels({
  app: 'soroban-playground-backend',
});

// Enable the collection of default metrics
client.collectDefaultMetrics({ register });

// Custom metrics
export const rateLimitHits = new client.Counter({
  name: 'rate_limit_hits_total',
  help: 'Total number of rate limit hits',
  labelNames: ['endpoint', 'status'],
});
register.registerMetric(rateLimitHits);

export const cacheHitsTotal = new client.Counter({
  name: 'soroban_cache_hits_total',
  help: 'Total number of cache hits',
  labelNames: ['level', 'reason'],
});
register.registerMetric(cacheHitsTotal);

export const cacheMissesTotal = new client.Counter({
  name: 'soroban_cache_misses_total',
  help: 'Total number of cache misses',
  labelNames: ['reason'],
});
register.registerMetric(cacheMissesTotal);

export const cacheEvictionsTotal = new client.Counter({
  name: 'soroban_cache_evictions_total',
  help: 'Total number of cache evictions and invalidations',
});
register.registerMetric(cacheEvictionsTotal);

export const cacheEntryCount = new client.Gauge({
  name: 'soroban_cache_entry_count',
  help: 'Number of entries currently loaded in L1 cache',
});
register.registerMetric(cacheEntryCount);

export const cacheVersionGauge = new client.Gauge({
  name: 'soroban_cache_version',
  help: 'Current cache namespace version',
  labelNames: ['namespace'],
});
register.registerMetric(cacheVersionGauge);

export const cacheLatencyHistogram = new client.Histogram({
  name: 'soroban_cache_latency_seconds',
  help: 'Latency for cache operations',
  labelNames: ['action'],
});
register.registerMetric(cacheLatencyHistogram);

register.registerMetric(tieredCacheMetrics.hits);
register.registerMetric(tieredCacheMetrics.misses);
register.registerMetric(tieredCacheMetrics.evictions);

export const requestLatency = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.1, 0.5, 1, 2, 5],
});
register.registerMetric(requestLatency);

export const requestCount = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests processed by the backend',
  labelNames: ['method', 'route', 'status'],
});
register.registerMetric(requestCount);

export const requestRate = new client.Gauge({
  name: 'http_request_rate_per_second',
  help: 'Average HTTP request rate per second over the last minute',
});
register.registerMetric(requestRate);

export const activeCompilationJobs = new client.Gauge({
  name: 'active_compilation_jobs',
  help: 'Number of active compilation jobs currently running',
});
register.registerMetric(activeCompilationJobs);

// [BE-10] Alias required by OpenMetrics spec / issue #1758
// `compiler_jobs_active` is the canonical name; `active_compilation_jobs`
// is retained for backwards-compatibility with existing dashboards.
export const compilerJobsActive = new client.Gauge({
  name: 'compiler_jobs_active',
  help: 'Number of compiler jobs currently active (canonical OpenMetrics name)',
});
register.registerMetric(compilerJobsActive);

// [BE-10] RPC latency histogram in milliseconds (issue #1758)
export const rpcLatencyMilliseconds = new client.Histogram({
  name: 'rpc_latency_milliseconds',
  help: 'Latency of RPC calls in milliseconds',
  labelNames: ['endpoint', 'status'],
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
});
register.registerMetric(rpcLatencyMilliseconds);

export const httpErrorsTotal = new client.Counter({
  name: 'http_errors_total',
  help: 'Total number of HTTP error responses',
  labelNames: ['method', 'route', 'status'],
});
register.registerMetric(httpErrorsTotal);

export const processCpuSecondsTotal =
  register.getSingleMetric('process_cpu_seconds_total') ||
  new client.Gauge({
    name: 'process_cpu_seconds_total',
    help: 'Total CPU time consumed by this process in seconds',
  });
if (!register.getSingleMetric('process_cpu_seconds_total')) {
  register.registerMetric(processCpuSecondsTotal);
}

export const processMemoryRssBytes =
  register.getSingleMetric('process_memory_rss_bytes') ||
  new client.Gauge({
    name: 'process_memory_rss_bytes',
    help: 'Resident memory usage in bytes',
  });
if (!register.getSingleMetric('process_memory_rss_bytes')) {
  register.registerMetric(processMemoryRssBytes);
}

const requestTimestamps = [];
const REQUEST_RATE_WINDOW_MS = 60_000;

export function recordHttpRequest(method, route, status) {
  requestCount.inc({ method, route, status });
  if (status >= 400) {
    httpErrorsTotal.inc({ method, route, status });
  }
  const now = Date.now();
  requestTimestamps.push(now);
  const cutoff = now - REQUEST_RATE_WINDOW_MS;
  while (requestTimestamps.length > 0 && requestTimestamps[0] < cutoff) {
    requestTimestamps.shift();
  }
  requestRate.set(requestTimestamps.length / (REQUEST_RATE_WINDOW_MS / 1000));
}

export function updateSystemMetrics() {
  const usage = process.cpuUsage();
  if (
    processCpuSecondsTotal &&
    typeof processCpuSecondsTotal.set === 'function'
  ) {
    processCpuSecondsTotal.set((usage.user + usage.system) / 1e6);
  }
  if (
    processMemoryRssBytes &&
    typeof processMemoryRssBytes.set === 'function'
  ) {
    processMemoryRssBytes.set(process.memoryUsage().rss);
  }
}

// Oracle Queue Metrics
export const oracleTasksEnqueued = new client.Counter({
  name: 'oracle_tasks_enqueued_total',
  help: 'Total number of proof tasks enqueued',
});
register.registerMetric(oracleTasksEnqueued);

export const oracleTasksProcessed = new client.Counter({
  name: 'oracle_tasks_processed_total',
  help: 'Total number of proof tasks processed by workers',
  labelNames: ['status'], // 'success', 'failure'
});
register.registerMetric(oracleTasksProcessed);

export const oracleQueueDepth = new client.Gauge({
  name: 'oracle_queue_depth',
  help: 'Current number of tasks in the pending queue',
});
register.registerMetric(oracleQueueDepth);

export const oracleProcessingDuration = new client.Histogram({
  name: 'oracle_task_processing_duration_seconds',
  help: 'Duration of proof task processing in seconds',
  buckets: [0.1, 0.5, 1, 2, 5, 10],
});
register.registerMetric(oracleProcessingDuration);

// Event Schema Metrics
export const eventQuarantineSize = new client.Gauge({
  name: 'event_quarantine_size',
  help: 'Number of events currently in quarantine',
});
register.registerMetric(eventQuarantineSize);

export const eventSchemaBreakingChangesTotal = new client.Counter({
  name: 'event_schema_breaking_changes_total',
  help: 'Total number of breaking schema changes detected',
  labelNames: ['event_type'],
});
register.registerMetric(eventSchemaBreakingChangesTotal);

export const eventSchemaDetectionAlertsTotal = new client.Counter({
  name: 'event_schema_detection_alerts_total',
  help: 'Total number of schema detection alerts fired',
  labelNames: ['event_type', 'severity'],
});
register.registerMetric(eventSchemaDetectionAlertsTotal);

export const eventSchemaVersionEventsTotal = new client.Counter({
  name: 'event_schema_version_events_total',
  help: 'Total number of schema version events',
  labelNames: ['event_type', 'schema_version'],
});
register.registerMetric(eventSchemaVersionEventsTotal);

export const eventValidationTotal = new client.Counter({
  name: 'event_validation_total',
  help: 'Total number of event validation attempts',
  labelNames: ['event_type', 'schema_version', 'outcome'],
});
register.registerMetric(eventValidationTotal);

// Oracle Proof Metrics
export const oracleProofDeadLetterTotal = new client.Counter({
  name: 'oracle_proof_dead_letter_total',
  help: 'Total number of oracle proof tasks sent to dead letter queue',
  labelNames: ['reason'],
});
register.registerMetric(oracleProofDeadLetterTotal);

export const oracleProofProcessingDuration = new client.Histogram({
  name: 'oracle_proof_processing_duration_seconds',
  help: 'Duration of oracle proof processing in seconds',
  labelNames: ['outcome'],
  buckets: [0.1, 0.5, 1, 2, 5, 10],
});
register.registerMetric(oracleProofProcessingDuration);

export const oracleProofQueueDepth = new client.Gauge({
  name: 'oracle_proof_queue_depth',
  help: 'Current depth of oracle proof queue',
  labelNames: ['state'],
});
register.registerMetric(oracleProofQueueDepth);

export const oracleProofTaskRetries = new client.Counter({
  name: 'oracle_proof_task_retries_total',
  help: 'Total number of oracle proof task retries',
  labelNames: ['reason'],
});
register.registerMetric(oracleProofTaskRetries);

export const oracleProofTasksEnqueued = new client.Counter({
  name: 'oracle_proof_tasks_enqueued_total',
  help: 'Total number of oracle proof tasks enqueued',
  labelNames: ['priority'],
});
register.registerMetric(oracleProofTasksEnqueued);

export const oracleProofTaskTransitions = new client.Counter({
  name: 'oracle_proof_task_transitions_total',
  help: 'Total number of oracle proof task state transitions',
  labelNames: ['from_state', 'to_state'],
});
register.registerMetric(oracleProofTaskTransitions);

export const oracleProofWorkerHeartbeats = new client.Counter({
  name: 'oracle_proof_worker_heartbeats_total',
  help: 'Total number of heartbeats received from proof workers',
  labelNames: ['worker_id'],
});
register.registerMetric(oracleProofWorkerHeartbeats);

// Database Query Metrics
export const dbQueryDuration = new client.Histogram({
  name: 'db_query_duration_seconds',
  help: 'Duration of database queries in seconds',
  labelNames: ['operation', 'status'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2],
});
register.registerMetric(dbQueryDuration);

export const dbQueriesTotal = new client.Counter({
  name: 'db_queries_total',
  help: 'Total number of database queries executed',
  labelNames: ['operation', 'status'],
});
register.registerMetric(dbQueriesTotal);

// Soroban RPC Call Metrics
export const sorobanRpcCallDuration = new client.Histogram({
  name: 'soroban_rpc_call_duration_seconds',
  help: 'Duration of Soroban RPC calls in seconds',
  labelNames: ['endpoint', 'status'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});
register.registerMetric(sorobanRpcCallDuration);

export const sorobanRpcCallsTotal = new client.Counter({
  name: 'soroban_rpc_calls_total',
  help: 'Total number of Soroban RPC calls',
  labelNames: ['endpoint', 'status'],
});
register.registerMetric(sorobanRpcCallsTotal);

router.get('/', metricsAuthMiddleware(), async (req, res) => {
  try {
    updateSystemMetrics();
    res.set('Content-Type', register.contentType);
    const merged = await client.Registry.merge([
      register,
      oracleLockRegistry,
      kafkaConsumerRegistry,
    ]).metrics();
    res.end(merged);
  } catch (ex) {
    res.status(500).send(ex.toString());
  }
});

export default router;
