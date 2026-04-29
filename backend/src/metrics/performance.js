import { MeterProvider, Meter } from '@opentelemetry/api-metrics';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import config from '../config/index.js';

// Create metrics for performance profiling
let meter;

export function initializeMetrics() {
  if (!config.tracing.enabled) return null;

  const exporter = new PrometheusExporter({
    port: process.env.METRICS_PORT || 9464,
  });

  const meterProvider = new MeterProvider({
    exporter,
    interval: 10000, // Collect every 10 seconds
  });

  meter = meterProvider.getMeter(config.tracing.serviceName, config.tracing.serviceVersion);

  // Performance profiling metrics
  const memoryUsage = meter.createObservableGauge('process_memory_usage_bytes', {
    description: 'Current memory usage of the process',
  });

  const cpuUsage = meter.createObservableGauge('process_cpu_usage_percent', {
    description: 'Current CPU usage percentage',
  });

  const eventLoopLag = meter.createObservableGauge('nodejs_eventloop_lag_seconds', {
    description: 'Event loop lag in seconds',
  });

  // Observable callbacks
  memoryUsage.addCallback((observableResult) => {
    const memUsage = process.memoryUsage();
    observableResult.observe(memUsage.heapUsed, { type: 'heap_used' });
    observableResult.observe(memUsage.heapTotal, { type: 'heap_total' });
    observableResult.observe(memUsage.external, { type: 'external' });
    observableResult.observe(memUsage.rss, { type: 'rss' });
  });

  cpuUsage.addCallback((observableResult) => {
    // Simple CPU usage calculation
    const startUsage = process.cpuUsage();
    setTimeout(() => {
      const endUsage = process.cpuUsage(startUsage);
      const totalUsage = endUsage.user + endUsage.system;
      const usagePercent = (totalUsage / 1000000) * 100; // Convert to percentage
      observableResult.observe(usagePercent);
    }, 100);
  });

  eventLoopLag.addCallback((observableResult) => {
    const start = process.hrtime.bigint();
    setImmediate(() => {
      const lag = Number(process.hrtime.bigint() - start) / 1e9; // Convert to seconds
      observableResult.observe(lag);
    });
  });

  console.log('Performance metrics initialized');
  return meterProvider;
}

// Custom metrics for operations
export function createOperationMetrics() {
  if (!meter) return {};

  const compileDuration = meter.createHistogram('soroban_compile_duration_seconds', {
    description: 'Duration of contract compilation operations',
  });

  const deployDuration = meter.createHistogram('soroban_deploy_duration_seconds', {
    description: 'Duration of contract deployment operations',
  });

  const invokeDuration = meter.createHistogram('soroban_invoke_duration_seconds', {
    description: 'Duration of contract invocation operations',
  });

  const queueSize = meter.createObservableGauge('soroban_queue_size', {
    description: 'Current size of operation queues',
  });

  const cacheHitRate = meter.createObservableGauge('soroban_cache_hit_rate', {
    description: 'Cache hit rate for compilations',
  });

  return {
    compileDuration,
    deployDuration,
    invokeDuration,
    queueSize,
    cacheHitRate,
  };
}