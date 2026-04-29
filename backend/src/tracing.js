import { NodeSDK } from '@opentelemetry/sdk-node';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { ZipkinExporter } from '@opentelemetry/exporter-zipkin';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import {
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  AlwaysOnSampler,
} from '@opentelemetry/sdk-trace-base';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';
import config from './config/index.js';

// Custom sampler for the requirements:
// - 100% errors
// - 10% success
// - 100% slow requests (>5s)
class CustomSampler {
  constructor() {
    this.successSampler = new TraceIdRatioBasedSampler(
      config.tracing.sampleRateSuccess
    ); // Configurable success rate
    this.alwaysOnSampler = new AlwaysOnSampler(); // 100% errors and slow
  }

  shouldSample(context, traceId, spanName, spanKind, attributes, links) {
    // Always sample errors and slow requests
    if (
      attributes?.['http.status_code'] >= 400 ||
      attributes?.['http.duration_ms'] > config.tracing.slowRequestThresholdMs
    ) {
      return this.alwaysOnSampler.shouldSample(
        context,
        traceId,
        spanName,
        spanKind,
        attributes,
        links
      );
    }
    // Configurable rate for success
    return this.successSampler.shouldSample(
      context,
      traceId,
      spanName,
      spanKind,
      attributes,
      links
    );
  }
}

// Initialize tracing
export function initializeTracing() {
  if (!config.tracing.enabled) {
    console.log('OpenTelemetry tracing disabled');
    return null;
  }

  const resource = new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: config.tracing.serviceName,
    [SemanticResourceAttributes.SERVICE_VERSION]: config.tracing.serviceVersion,
    [SemanticResourceAttributes.SERVICE_INSTANCE_ID]: process.pid.toString(),
  });

  const exporters = [];

  // Jaeger exporter
  if (config.tracing.jaegerEndpoint) {
    const jaegerExporter = new JaegerExporter({
      endpoint: config.tracing.jaegerEndpoint,
      username: process.env.JAEGER_USER,
      password: process.env.JAEGER_PASSWORD,
    });
    exporters.push(jaegerExporter);
  }

  // Zipkin exporter
  if (config.tracing.zipkinEndpoint) {
    const zipkinExporter = new ZipkinExporter({
      url: config.tracing.zipkinEndpoint,
    });
    exporters.push(zipkinExporter);
  }

  // If no exporters configured, use console for development
  if (exporters.length === 0 && config.app.env === 'development') {
    exporters.push(new ConsoleSpanExporter());
  }

  const spanProcessors = exporters.map(
    (exporter) => new BatchSpanProcessor(exporter)
  );

  const sdk = new NodeSDK({
    resource,
    spanProcessors,
    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable some auto-instrumentations that might be noisy
        '@opentelemetry/instrumentation-fs': {
          enabled: false, // Too noisy for file operations
        },
        '@opentelemetry/instrumentation-net': {
          enabled: false,
        },
        '@opentelemetry/instrumentation-dns': {
          enabled: false,
        },
        '@opentelemetry/instrumentation-http': {
          enabled: true,
        },
        '@opentelemetry/instrumentation-express': {
          enabled: true,
        },
        '@opentelemetry/instrumentation-ioredis': {
          enabled: true,
        },
      }),
    ],
    sampler: new ParentBasedSampler({
      root: new CustomSampler(),
    }),
  });

  // Start the SDK
  sdk.start();

  console.log(
    'OpenTelemetry tracing initialized with exporters:',
    exporters.map((e) => e.constructor.name)
  );

  // Graceful shutdown
  process.on('SIGTERM', () => {
    sdk
      .shutdown()
      .then(() => {
        console.log('OpenTelemetry tracing shut down');
        process.exit(0);
      })
      .catch((error) => {
        console.error('Error shutting down tracing', error);
        process.exit(1);
      });
  });

  return sdk;
}
