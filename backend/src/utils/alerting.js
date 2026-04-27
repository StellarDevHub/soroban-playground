import { getCurrentSpan, getTraceId } from '../utils/tracing.js';
import config from '../config/index.js';

// Simple alerting based on logs and metrics
export class AlertManager {
  constructor() {
    this.alerts = new Map();
    this.thresholds = {
      slowRequestMs: config.tracing.slowRequestThresholdMs,
      errorRatePercent: 5, // Alert if error rate > 5%
      highLatencyMs: 10000, // Alert if p95 latency > 10s
    };
  }

  // Alert on high error rates
  checkErrorRate(endpoint, errorCount, totalCount) {
    const errorRate = (errorCount / totalCount) * 100;
    if (errorRate > this.thresholds.errorRatePercent) {
      this.alert('high_error_rate', {
        endpoint,
        errorRate: errorRate.toFixed(2),
        errorCount,
        totalCount,
      });
    }
  }

  // Alert on slow requests
  checkSlowRequest(durationMs, endpoint) {
    if (durationMs > this.thresholds.slowRequestMs) {
      this.alert('slow_request', {
        durationMs,
        endpoint,
        thresholdMs: this.thresholds.slowRequestMs,
      });
    }
  }

  // Alert on high latency
  checkHighLatency(p95LatencyMs) {
    if (p95LatencyMs > this.thresholds.highLatencyMs) {
      this.alert('high_latency', {
        p95LatencyMs,
        thresholdMs: this.thresholds.highLatencyMs,
      });
    }
  }

  // Alert on deployment failures
  checkDeploymentFailure(deploymentId, error) {
    this.alert('deployment_failed', {
      deploymentId,
      error: error.message,
    });
  }

  // Alert on compilation failures
  checkCompilationFailure(hash, error) {
    this.alert('compilation_failed', {
      hash,
      error: error.message,
    });
  }

  // Generic alert method
  alert(type, details) {
    const traceId = getTraceId();
    const alert = {
      type,
      timestamp: new Date().toISOString(),
      traceId,
      details,
      severity: this.getSeverity(type),
    };

    // Log the alert
    console.error(`ALERT [${alert.severity.toUpperCase()}]: ${type}`, alert);

    // Store recent alerts (last 100)
    this.alerts.set(`${type}-${Date.now()}`, alert);
    if (this.alerts.size > 100) {
      const firstKey = this.alerts.keys().next().value;
      this.alerts.delete(firstKey);
    }

    // In a real system, you might send to external monitoring
    // this.sendToMonitoring(alert);
  }

  getSeverity(type) {
    const severityMap = {
      high_error_rate: 'warning',
      slow_request: 'info',
      high_latency: 'warning',
      deployment_failed: 'error',
      compilation_failed: 'error',
    };
    return severityMap[type] || 'info';
  }

  getRecentAlerts() {
    return Array.from(this.alerts.values()).sort((a, b) => 
      new Date(b.timestamp) - new Date(a.timestamp)
    );
  }
}

export const alertManager = new AlertManager();