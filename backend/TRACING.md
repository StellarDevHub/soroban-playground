# Distributed Tracing with OpenTelemetry

This document describes the OpenTelemetry distributed tracing implementation in the Soroban Playground backend.

## Overview

The backend now includes comprehensive distributed tracing using OpenTelemetry to provide observability into the Soroban smart contract operations. Tracing helps debug distributed systems, track performance bottlenecks, and correlate logs and metrics.

## Features Implemented

### ✅ Distributed Traces
- All critical operations (compile, deploy, invoke) are traced
- HTTP requests are traced with automatic instrumentation
- Database operations (Redis) are traced
- Child process executions (Soroban CLI) are traced

### ✅ Trace Context Propagation
- Trace ID is extracted from incoming HTTP headers (`x-trace-id`, `x-span-id`, `x-trace-flags`)
- Trace context is propagated across service boundaries
- Trace ID is injected into response headers
- Trace context is passed to child processes via environment variables

### ✅ Instrumentation Points
- **HTTP Requests**: Automatic via `@opentelemetry/instrumentation-express`
- **Redis Operations**: Automatic via `@opentelemetry/instrumentation-ioredis`
- **Rate Limiting**: Custom spans for check operations
- **Compilation**: Spans for queue, cache check, worker execution, Cargo build
- **Deployment**: Spans for batch operations, individual contract deployments
- **Invocation**: Spans for queue, Soroban CLI execution

### ✅ Performance Profiling
- Memory usage metrics (heap, RSS, external)
- CPU usage percentage
- Event loop lag
- Custom histograms for operation durations
- Queue size gauges
- Cache hit rate metrics

### ✅ Trace Sampling
- **100% errors**: All error traces are sampled
- **10% success**: Configurable success rate sampling (default 10%)
- **100% slow requests**: Requests > 5 seconds are always sampled
- Configurable via environment variables

### ✅ Trace Visualization
- **Jaeger**: Export traces to Jaeger for visualization
- **Zipkin**: Alternative Zipkin exporter
- **Console**: Development mode console output

### ✅ Trace Correlation
- **Logs**: HTTP logs include trace ID via Morgan token
- **Metrics**: Prometheus metrics are correlated via trace context
- **Errors**: Error logs include trace ID

### ✅ Custom Span Events
- Cache hits/misses with metadata
- Queue state changes
- Worker lifecycle events
- Deployment attempts and failures

### ✅ Trace Analytics
- Error patterns identification
- Slowest endpoints tracking
- Failure rate analysis
- Performance bottleneck detection

### ✅ Trace-Based Alerting
- High error rate alerts (>5%)
- Slow request alerts (>5s)
- Deployment failure alerts
- Compilation failure alerts
- Server error alerts (5xx)

## Configuration

Tracing is configured via environment variables:

```bash
# Enable/disable tracing
TRACING_ENABLED=true

# Service identification
TRACING_SERVICE_NAME=soroban-playground-backend
TRACING_SERVICE_VERSION=1.0.0

# Exporters
TRACING_JAEGER_ENDPOINT=http://localhost:14268/api/traces
TRACING_ZIPKIN_ENDPOINT=http://localhost:9411/api/v2/spans

# Sampling configuration
TRACING_SAMPLE_RATE_SUCCESS=0.1      # 10% of successful requests
TRACING_SAMPLE_RATE_ERRORS=1.0       # 100% of errors
TRACING_SLOW_REQUEST_THRESHOLD_MS=5000  # Slow request threshold
```

## Jaeger Setup

To visualize traces with Jaeger:

1. Run Jaeger locally:
```bash
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 14268:14268 \
  jaegertracing/all-in-one:latest
```

2. Set environment variable:
```bash
TRACING_JAEGER_ENDPOINT=http://localhost:14268/api/traces
```

3. Access Jaeger UI at http://localhost:16686

## Zipkin Setup

Alternative Zipkin setup:

```bash
docker run -d -p 9411:9411 openzipkin/zipkin
```

Set:
```bash
TRACING_ZIPKIN_ENDPOINT=http://localhost:9411/api/v2/spans
```

## Metrics and Monitoring

Performance metrics are exposed via Prometheus at `/metrics` endpoint.

Cache analytics and metrics now include:
- `soroban_cache_hits_total`
- `soroban_cache_misses_total`
- `soroban_cache_evictions_total`
- `soroban_cache_entry_count`
- `soroban_cache_version`
- `soroban_cache_latency_seconds`

Additional metrics endpoint for performance profiling runs on port 9464.

## Alerting

Recent alerts can be viewed at `/api/admin/alerts` endpoint.

Alerts include:
- Server errors (5xx)
- Deployment failures
- Compilation failures
- High error rates
- Slow requests

## Trace Context Headers

The API accepts and returns trace context headers:

**Request Headers:**
- `x-trace-id`: Trace ID (hex string)
- `x-span-id`: Parent span ID (hex string)
- `x-trace-flags`: Trace flags (integer)

**Response Headers:**
- `x-trace-id`: Current trace ID

## Log Correlation

HTTP access logs include trace ID:

```
127.0.0.1 - - [25/Apr/2026:19:41:55 +0000] "POST /api/v1/compile HTTP/1.1" 200 123 "-" "-" trace_id=1234567890abcdef - 1500 ms
```

## Development

In development mode, traces are output to console if no exporters are configured.

To disable tracing entirely:
```bash
TRACING_ENABLED=false
```

## Troubleshooting

### Traces not appearing in Jaeger
1. Check Jaeger endpoint configuration
2. Verify network connectivity to Jaeger
3. Check application logs for OpenTelemetry errors
4. Ensure TRACING_ENABLED=true

### High performance overhead
1. Adjust sampling rates
2. Disable noisy instrumentations in `tracing.js`
3. Use production exporters instead of console

### Missing trace context
1. Ensure client sends proper trace headers
2. Check middleware order in `server.js`
3. Verify trace context propagation in async operations

## Architecture

```
Client Request
    ↓
Trace Context Middleware (extract/create trace ID)
    ↓
HTTP Instrumentation (automatic span creation)
    ↓
Rate Limit Middleware (custom spans)
    ↓
Route Handler
    ↓
Service Layer (custom spans for operations)
    ↓
Worker/CLI Execution (trace context injection)
    ↓
Response with Trace ID header
```

## Future Enhancements

- Integration with Sentry for error tracking
- Custom dashboards for trace analytics
- Automated anomaly detection
- Trace-based alerting to external systems (Slack, PagerDuty)