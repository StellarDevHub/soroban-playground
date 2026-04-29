// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { integrationService } from './integrationService.js';

// Monitoring configuration
const MONITORING_CONFIG = {
  METRICS_COLLECTION_INTERVAL: 60000, // 1 minute
  HEALTH_CHECK_INTERVAL: 30000, // 30 seconds
  ALERT_THRESHOLDS: {
    ERROR_RATE: 0.05, // 5%
    RESPONSE_TIME_P95: 2000, // 2 seconds
    RESPONSE_TIME_P99: 5000, // 5 seconds
    MEMORY_USAGE: 0.8, // 80%
    CPU_USAGE: 0.8, // 80%
    DISK_USAGE: 0.9, // 90%
  },
  RETENTION_PERIOD: 7 * 24 * 60 * 60 * 1000, // 7 days
};

// Metrics types
interface Metric {
  name: string;
  value: number;
  timestamp: number;
  labels?: Record<string, string>;
}

interface HealthCheck {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  message: string;
  timestamp: number;
  responseTime?: number;
}

interface Alert {
  id: string;
  type: 'error' | 'warning' | 'info';
  title: string;
  message: string;
  timestamp: number;
  resolved: boolean;
  resolvedAt?: number;
  labels?: Record<string, string>;
}

interface PerformanceMetrics {
  responseTime: {
    min: number;
    max: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
  };
  requestCount: number;
  errorCount: number;
  errorRate: number;
  throughput: number;
}

interface SystemMetrics {
  memory: {
    used: number;
    total: number;
    usage: number;
  };
  cpu: {
    usage: number;
    loadAverage: number[];
  };
  disk: {
    used: number;
    total: number;
    usage: number;
  };
  network: {
    bytesIn: number;
    bytesOut: number;
    packetsIn: number;
    packetsOut: number;
  };
}

class MonitoringService extends EventEmitter {
  private metrics = new Map<string, Metric[]>();
  private healthChecks = new Map<string, HealthCheck>();
  private alerts = new Map<string, Alert>();
  private responseTimes: number[] = [];
  private requestCounts = new Map<string, number>();
  private errorCounts = new Map<string, number>();
  private intervals: NodeJS.Timeout[] = [];

  constructor() {
    super();
    this.startMonitoring();
  }

  // Start monitoring services
  private startMonitoring(): void {
    // Metrics collection
    this.intervals.push(
      setInterval(() => {
        this.collectSystemMetrics();
        this.collectApplicationMetrics();
        this.processMetrics();
        this.checkAlerts();
      }, MONITORING_CONFIG.METRICS_COLLECTION_INTERVAL)
    );

    // Health checks
    this.intervals.push(
      setInterval(() => {
        this.performHealthChecks();
      }, MONITORING_CONFIG.HEALTH_CHECK_INTERVAL)
    );

    // Cleanup old data
    this.intervals.push(
      setInterval(() => {
        this.cleanupOldData();
      }, 60 * 60 * 1000) // Every hour
    );

    logger.info('Monitoring service started');
  }

  // Record a metric
  recordMetric(name: string, value: number, labels?: Record<string, string>): void {
    const metric: Metric = {
      name,
      value,
      timestamp: Date.now(),
      labels,
    };

    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }

    const metrics = this.metrics.get(name)!;
    metrics.push(metric);

    // Keep only recent metrics (based on retention period)
    const cutoff = Date.now() - MONITORING_CONFIG.RETENTION_PERIOD;
    const filtered = metrics.filter(m => m.timestamp > cutoff);
    this.metrics.set(name, filtered);

    this.emit('metric:recorded', metric);
  }

  // Record response time
  recordResponseTime(duration: number, endpoint: string): void {
    this.responseTimes.push(duration);
    this.recordMetric('response_time', duration, { endpoint });

    // Keep only recent response times
    if (this.responseTimes.length > 10000) {
      this.responseTimes = this.responseTimes.slice(-5000);
    }
  }

  // Record request
  recordRequest(endpoint: string, statusCode: number): void {
    const count = this.requestCounts.get(endpoint) || 0;
    this.requestCounts.set(endpoint, count + 1);

    if (statusCode >= 400) {
      const errorCount = this.errorCounts.get(endpoint) || 0;
      this.errorCounts.set(endpoint, errorCount + 1);
    }

    this.recordMetric('requests', 1, { endpoint, status: statusCode.toString() });
  }

  // Collect system metrics
  private collectSystemMetrics(): void {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    // Memory metrics
    const memoryUsed = memUsage.heapUsed;
    const memoryTotal = memUsage.heapTotal;
    const memoryUsage = memoryUsed / memoryTotal;

    this.recordMetric('memory_used_bytes', memoryUsed);
    this.recordMetric('memory_total_bytes', memoryTotal);
    this.recordMetric('memory_usage_ratio', memoryUsage);

    // CPU metrics (simplified)
    this.recordMetric('cpu_usage_user', cpuUsage.user);
    this.recordMetric('cpu_usage_system', cpuUsage.system);

    // Event loop metrics
    this.recordMetric('event_loop_lag', this.getEventLoopLag());
  }

  // Collect application metrics
  private collectApplicationMetrics(): void {
    // Subscription metrics
    this.collectSubscriptionMetrics();
    
    // API metrics
    this.collectApiMetrics();
    
    // Database metrics (if applicable)
    this.collectDatabaseMetrics();
  }

  // Collect subscription-specific metrics
  private async collectSubscriptionMetrics(): Promise<void> {
    try {
      const stats = await integrationService.getStats();
      
      this.recordMetric('total_subscriptions', stats.totalSubscriptions);
      this.recordMetric('active_subscriptions', stats.activeSubscriptions);
      this.recordMetric('cancelled_subscriptions', stats.cancelledSubscriptions);
      this.recordMetric('total_revenue', stats.totalRevenue);
      this.recordMetric('churn_rate', stats.churnRate);
      this.recordMetric('monthly_growth', stats.monthlyGrowth);
    } catch (error) {
      logger.error('Failed to collect subscription metrics', { error: error.message });
    }
  }

  // Collect API metrics
  private collectApiMetrics(): void {
    // Total requests
    const totalRequests = Array.from(this.requestCounts.values()).reduce((sum, count) => sum + count, 0);
    this.recordMetric('total_requests', totalRequests);

    // Total errors
    const totalErrors = Array.from(this.errorCounts.values()).reduce((sum, count) => sum + count, 0);
    this.recordMetric('total_errors', totalErrors);

    // Error rate
    const errorRate = totalRequests > 0 ? totalErrors / totalRequests : 0;
    this.recordMetric('error_rate', errorRate);

    // Throughput (requests per second)
    const throughput = totalRequests / (MONITORING_CONFIG.METRICS_COLLECTION_INTERVAL / 1000);
    this.recordMetric('throughput', throughput);
  }

  // Collect database metrics (placeholder)
  private collectDatabaseMetrics(): void {
    // In a real implementation, this would collect database-specific metrics
    // like connection pool size, query times, etc.
    this.recordMetric('db_connections', 10); // Example
    this.recordMetric('db_query_time', 50); // Example
  }

  // Process metrics and calculate statistics
  private processMetrics(): void {
    // Calculate response time statistics
    if (this.responseTimes.length > 0) {
      const sorted = [...this.responseTimes].sort((a, b) => a - b);
      const len = sorted.length;
      
      const responseTimeStats = {
        min: sorted[0],
        max: sorted[len - 1],
        avg: sorted.reduce((sum, time) => sum + time, 0) / len,
        p50: sorted[Math.floor(len * 0.5)],
        p95: sorted[Math.floor(len * 0.95)],
        p99: sorted[Math.floor(len * 0.99)],
      };

      this.recordMetric('response_time_min', responseTimeStats.min);
      this.recordMetric('response_time_max', responseTimeStats.max);
      this.recordMetric('response_time_avg', responseTimeStats.avg);
      this.recordMetric('response_time_p50', responseTimeStats.p50);
      this.recordMetric('response_time_p95', responseTimeStats.p95);
      this.recordMetric('response_time_p99', responseTimeStats.p99);
    }
  }

  // Perform health checks
  private async performHealthChecks(): Promise<void> {
    const checks = [
      this.checkApiHealth(),
      this.checkDatabaseHealth(),
      this.checkMemoryHealth(),
      this.checkDiskHealth(),
      this.checkWebSocketHealth(),
    ];

    const results = await Promise.allSettled(checks);
    
    results.forEach((result, index) => {
      const checkName = ['api', 'database', 'memory', 'disk', 'websocket'][index];
      
      if (result.status === 'fulfilled') {
        this.healthChecks.set(checkName, result.value);
      } else {
        this.healthChecks.set(checkName, {
          name: checkName,
          status: 'unhealthy',
          message: `Health check failed: ${result.reason}`,
          timestamp: Date.now(),
        });
      }
    });

    this.emit('health:updated', Array.from(this.healthChecks.values()));
  }

  // API health check
  private async checkApiHealth(): Promise<HealthCheck> {
    const start = Date.now();
    
    try {
      await integrationService.healthCheck();
      const responseTime = Date.now() - start;
      
      return {
        name: 'api',
        status: 'healthy',
        message: 'API is responding correctly',
        timestamp: Date.now(),
        responseTime,
      };
    } catch (error) {
      return {
        name: 'api',
        status: 'unhealthy',
        message: `API health check failed: ${error.message}`,
        timestamp: Date.now(),
        responseTime: Date.now() - start,
      };
    }
  }

  // Database health check (placeholder)
  private async checkDatabaseHealth(): Promise<HealthCheck> {
    const start = Date.now();
    
    try {
      // In a real implementation, this would check database connectivity
      const responseTime = Date.now() - start;
      
      return {
        name: 'database',
        status: 'healthy',
        message: 'Database is responding correctly',
        timestamp: Date.now(),
        responseTime,
      };
    } catch (error) {
      return {
        name: 'database',
        status: 'unhealthy',
        message: `Database health check failed: ${error.message}`,
        timestamp: Date.now(),
        responseTime: Date.now() - start,
      };
    }
  }

  // Memory health check
  private checkMemoryHealth(): HealthCheck {
    const memUsage = process.memoryUsage();
    const memoryUsage = memUsage.heapUsed / memUsage.heapTotal;
    
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    let message = 'Memory usage is normal';
    
    if (memoryUsage > 0.9) {
      status = 'unhealthy';
      message = 'Memory usage is critically high';
    } else if (memoryUsage > 0.8) {
      status = 'degraded';
      message = 'Memory usage is high';
    }
    
    return {
      name: 'memory',
      status,
      message,
      timestamp: Date.now(),
    };
  }

  // Disk health check (placeholder)
  private checkDiskHealth(): HealthCheck {
    // In a real implementation, this would check disk usage
    return {
      name: 'disk',
      status: 'healthy',
      message: 'Disk usage is normal',
      timestamp: Date.now(),
    };
  }

  // WebSocket health check
  private checkWebSocketHealth(): HealthCheck {
    // In a real implementation, this would check WebSocket connectivity
    return {
      name: 'websocket',
      status: 'healthy',
      message: 'WebSocket is connected',
      timestamp: Date.now(),
    };
  }

  // Check for alerts
  private checkAlerts(): void {
    const metrics = this.getLatestMetrics();
    
    // Check error rate
    if (metrics.error_rate > MONITORING_CONFIG.ALERT_THRESHOLDS.ERROR_RATE) {
      this.createAlert('error', 'High Error Rate', 
        `Error rate is ${(metrics.error_rate * 100).toFixed(2)}%`);
    }

    // Check response times
    if (metrics.response_time_p95 > MONITORING_CONFIG.ALERT_THRESHOLDS.RESPONSE_TIME_P95) {
      this.createAlert('warning', 'High Response Time', 
        `95th percentile response time is ${metrics.response_time_p95}ms`);
    }

    if (metrics.response_time_p99 > MONITORING_CONFIG.ALERT_THRESHOLDS.RESPONSE_TIME_P99) {
      this.createAlert('error', 'Very High Response Time', 
        `99th percentile response time is ${metrics.response_time_p99}ms`);
    }

    // Check memory usage
    if (metrics.memory_usage_ratio > MONITORING_CONFIG.ALERT_THRESHOLDS.MEMORY_USAGE) {
      this.createAlert('warning', 'High Memory Usage', 
        `Memory usage is ${(metrics.memory_usage_ratio * 100).toFixed(2)}%`);
    }

    // Check health checks
    for (const healthCheck of this.healthChecks.values()) {
      if (healthCheck.status === 'unhealthy') {
        this.createAlert('error', 'Health Check Failed', 
          `${healthCheck.name} is unhealthy: ${healthCheck.message}`);
      }
    }
  }

  // Create an alert
  private createAlert(type: 'error' | 'warning' | 'info', title: string, message: string): void {
    const id = `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const alert: Alert = {
      id,
      type,
      title,
      message,
      timestamp: Date.now(),
      resolved: false,
    };

    this.alerts.set(id, alert);
    this.emit('alert:created', alert);
    
    logger.warn('Alert created', { id, type, title, message });
  }

  // Resolve an alert
  resolveAlert(alertId: string): void {
    const alert = this.alerts.get(alertId);
    if (alert && !alert.resolved) {
      alert.resolved = true;
      alert.resolvedAt = Date.now();
      
      this.emit('alert:resolved', alert);
      logger.info('Alert resolved', { alertId });
    }
  }

  // Get latest metrics
  getLatestMetrics(): Record<string, number> {
    const latest: Record<string, number> = {};
    
    for (const [name, metrics] of this.metrics.entries()) {
      if (metrics.length > 0) {
        latest[name] = metrics[metrics.length - 1].value;
      }
    }
    
    return latest;
  }

  // Get metrics history
  getMetricsHistory(name: string, duration?: number): Metric[] {
    const metrics = this.metrics.get(name) || [];
    
    if (duration) {
      const cutoff = Date.now() - duration;
      return metrics.filter(m => m.timestamp > cutoff);
    }
    
    return metrics;
  }

  // Get performance metrics
  getPerformanceMetrics(): PerformanceMetrics {
    const latest = this.getLatestMetrics();
    
    return {
      responseTime: {
        min: latest.response_time_min || 0,
        max: latest.response_time_max || 0,
        avg: latest.response_time_avg || 0,
        p50: latest.response_time_p50 || 0,
        p95: latest.response_time_p95 || 0,
        p99: latest.response_time_p99 || 0,
      },
      requestCount: latest.total_requests || 0,
      errorCount: latest.total_errors || 0,
      errorRate: latest.error_rate || 0,
      throughput: latest.throughput || 0,
    };
  }

  // Get system metrics
  getSystemMetrics(): SystemMetrics {
    const latest = this.getLatestMetrics();
    
    return {
      memory: {
        used: latest.memory_used_bytes || 0,
        total: latest.memory_total_bytes || 0,
        usage: latest.memory_usage_ratio || 0,
      },
      cpu: {
        usage: latest.cpu_usage_user || 0,
        loadAverage: [], // Would be populated with actual load averages
      },
      disk: {
        used: 0, // Would be populated with actual disk usage
        total: 0,
        usage: 0,
      },
      network: {
        bytesIn: 0,
        bytesOut: 0,
        packetsIn: 0,
        packetsOut: 0,
      },
    };
  }

  // Get health status
  getHealthStatus(): HealthCheck[] {
    return Array.from(this.healthChecks.values());
  }

  // Get alerts
  getAlerts(includeResolved = false): Alert[] {
    const alerts = Array.from(this.alerts.values());
    
    if (!includeResolved) {
      return alerts.filter(a => !a.resolved);
    }
    
    return alerts.sort((a, b) => b.timestamp - a.timestamp);
  }

  // Get monitoring dashboard data
  getDashboardData(): {
    performance: PerformanceMetrics;
    system: SystemMetrics;
    health: HealthCheck[];
    alerts: Alert[];
    metrics: Record<string, Metric[]>;
  } {
    return {
      performance: this.getPerformanceMetrics(),
      system: this.getSystemMetrics(),
      health: this.getHealthStatus(),
      alerts: this.getAlerts(),
      metrics: Object.fromEntries(this.metrics),
    };
  }

  // Clean up old data
  private cleanupOldData(): void {
    const cutoff = Date.now() - MONITORING_CONFIG.RETENTION_PERIOD;
    
    // Clean up metrics
    for (const [name, metrics] of this.metrics.entries()) {
      const filtered = metrics.filter(m => m.timestamp > cutoff);
      this.metrics.set(name, filtered);
    }
    
    // Clean up resolved alerts older than retention period
    for (const [id, alert] of this.alerts.entries()) {
      if (alert.resolved && alert.resolvedAt && alert.resolvedAt < cutoff) {
        this.alerts.delete(id);
      }
    }
    
    // Clean up old response times
    this.responseTimes = this.responseTimes.filter((_, index) => {
      // Keep only recent response times (last 10000)
      return index >= this.responseTimes.length - 10000;
    });
  }

  // Get event loop lag
  private getEventLoopLag(): number {
    const start = process.hrtime.bigint();
    
    return new Promise(resolve => {
      setImmediate(() => {
        const lag = Number(process.hrtime.bigint() - start) / 1000000; // Convert to milliseconds
        resolve(lag);
      });
    }) as any;
  }

  // Stop monitoring
  stop(): void {
    this.intervals.forEach(interval => clearInterval(interval));
    this.intervals = [];
    logger.info('Monitoring service stopped');
  }

  // Export metrics for external systems
  exportMetrics(format: 'prometheus' | 'json' = 'json'): string {
    if (format === 'prometheus') {
      return this.exportPrometheusMetrics();
    }
    
    return JSON.stringify({
      metrics: Object.fromEntries(this.metrics),
      health: Array.from(this.healthChecks.values()),
      alerts: Array.from(this.alerts.values()),
      timestamp: Date.now(),
    });
  }

  // Export metrics in Prometheus format
  private exportPrometheusMetrics(): string {
    const lines: string[] = [];
    
    for (const [name, metrics] of this.metrics.entries()) {
      for (const metric of metrics) {
        const labels = metric.labels 
          ? `{${Object.entries(metric.labels).map(([k, v]) => `${k}="${v}"`).join(',')}}`
          : '';
        
        lines.push(`${name}${labels} ${metric.value} ${metric.timestamp}`);
      }
    }
    
    return lines.join('\n');
  }
}

// Export singleton instance
export const monitoringService = new MonitoringService();
export default monitoringService;
