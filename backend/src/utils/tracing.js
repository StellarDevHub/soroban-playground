import { trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import config from '../config/index.js';

const tracer = trace.getTracer(
  config.tracing.serviceName,
  config.tracing.serviceVersion
);

// Helper to create a span with common attributes
export function createSpan(name, attributes = {}, kind = SpanKind.INTERNAL) {
  const span = tracer.startSpan(name, { kind });
  if (attributes) {
    span.setAttributes(attributes);
  }
  return span;
}

// Helper to wrap a function with a span
export function withSpan(name, fn, attributes = {}, kind = SpanKind.INTERNAL) {
  return async (...args) => {
    const span = createSpan(name, attributes, kind);
    try {
      const result = await fn(...args);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      span.recordException(error);
      throw error;
    } finally {
      span.end();
    }
  };
}

// Helper to add span events
export function addSpanEvent(span, name, attributes = {}) {
  span.addEvent(name, attributes);
}

// Helper to set span attributes
export function setSpanAttributes(span, attributes) {
  span.setAttributes(attributes);
}

// Get current span
export function getCurrentSpan() {
  return trace.getActiveSpan();
}

// Extract trace ID from current span
export function getTraceId() {
  const span = getCurrentSpan();
  return span ? span.spanContext().traceId : undefined;
}

// Inject trace context into environment for subprocess
export function injectTraceContext(env = {}) {
  const span = getCurrentSpan();
  if (span) {
    const context = span.spanContext();
    return {
      ...env,
      OTEL_TRACE_ID: context.traceId,
      OTEL_SPAN_ID: context.spanId,
      OTEL_TRACE_FLAGS: context.traceFlags.toString(),
    };
  }
  return env;
}
