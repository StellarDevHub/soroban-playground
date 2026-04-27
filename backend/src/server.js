// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import http from 'http';
import cors from 'cors';
import morgan from 'morgan';
// import rateLimit from 'express-rate-limit'; // Replaced by custom Redis limiter
import os from 'os';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import apiRouter from './routes/api.js';
import { startCleanupWorker } from './cleanupWorker.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import { setupWebsocketServer } from './websocket.js';
import { initializeTracing } from './tracing.js';
import { initializeMetrics } from './metrics/performance.js';
import { getCurrentSpan, setSpanAttributes } from './utils/tracing.js';
import adminRoute from './routes/admin.js';
import metricsRoute, { requestLatency } from './routes/metrics.js';
import { rateLimitMiddleware } from './middleware/rateLimiter.js';
import auditLogger from './middleware/auditLogger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

// Load package.json for version info
let packageJson = {};
try {
  packageJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8')
  );
} catch {
  try {
    packageJson = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8')
    );
  } catch {
    packageJson = { version: 'unknown', name: 'soroban-playground-backend' };
  }
}

// Morgan logging format
const logFormat = config.tracing.enabled 
  ? ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" trace_id=:traceId - :response-time ms'
  : ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" - :response-time ms';

// Custom morgan token for trace ID
morgan.token('traceId', (req) => req.traceId || '-');

// Basic middleware
app.use(morgan(logFormat));
app.use(cors());
app.use(express.json());
app.use(auditLogger);

// Trace context middleware
app.use(async (req, res, next) => {
  if (config.tracing.enabled) {
    const { trace, getTraceId } = await import('./utils/tracing.js');
    const tracer = trace.getTracer(config.tracing.serviceName, config.tracing.serviceVersion);
    
    // Extract trace context from headers
    const traceId = req.headers['x-trace-id'] || req.headers['x-request-id'];
    const spanId = req.headers['x-span-id'];
    const traceFlags = req.headers['x-trace-flags'];
    
    let span;
    if (traceId) {
      // Continue existing trace
      const spanContext = {
        traceId,
        spanId: spanId || '0000000000000000',
        traceFlags: traceFlags ? parseInt(traceFlags, 10) : 1,
        isRemote: true,
      };
      span = tracer.startSpan(`HTTP ${req.method} ${req.path}`, {}, spanContext);
    } else {
      // Start new trace
      span = tracer.startSpan(`HTTP ${req.method} ${req.path}`);
    }
    
    // Set trace ID in response headers
    const context = span.spanContext();
    res.setHeader('x-trace-id', context.traceId);
    
    // Store span in request for later use
    req.traceSpan = span;
    req.traceId = context.traceId;
    
    // End span when response finishes
    res.on('finish', () => {
      span.end();
    });
  }
  next();
});

// Latency tracking middleware
app.use((req, res, next) => {
  const start = process.hrtime();
  res.on('finish', () => {
    const diff = process.hrtime(start);
    const time = diff[0] + diff[1] / 1e9;
    const timeMs = time * 1000;
    requestLatency.observe({ 
      method: req.method, 
      route: req.route ? req.route.path : req.path, 
      status: res.statusCode 
    }, time);

    // Add to current span if tracing is enabled
    if (config.tracing.enabled) {
      const span = getCurrentSpan();
      if (span) {
        setSpanAttributes(span, {
          'http.duration_ms': timeMs,
          'http.status_code': res.statusCode,
          'http.method': req.method,
          'http.route': req.route ? req.route.path : req.path,
        });
      }
    }
  });
  next();
});

// Rate limiting - global limiter (Replaced)
// const globalLimiter = rateLimit({ ... });

app.use(rateLimitMiddleware('global'));

// Routes
app.use('/api', apiRouter);
app.use('/api/admin', adminRoute);
app.use('/metrics', metricsRoute);

// ─── Health Check Helpers ────────────────────────────────────────────────────

function getCpuUsage() {
  return os.cpus().map((cpu, index) => {
    const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
    const idle = cpu.times.idle;
    return {
      core: index,
      model: cpu.model,
      speedMHz: cpu.speed,
      usedPercent: total > 0 ? +((1 - idle / total) * 100).toFixed(1) : 0,
    };
  });
}

function getMemoryInfo() {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;
  const toMB = (b) => +(b / 1024 / 1024).toFixed(2);
  return {
    totalMB: toMB(totalBytes),
    freeMB: toMB(freeBytes),
    usedMB: toMB(usedBytes),
    usedPercent: +((usedBytes / totalBytes) * 100).toFixed(1),
  };
}

function getUptimeInfo() {
  const formatSeconds = (s) => {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return [d && `${d}d`, h && `${h}h`, m && `${m}m`, `${sec}s`]
      .filter(Boolean)
      .join(' ');
  };
  return {
    processSec: Math.floor(process.uptime()),
    processHuman: formatSeconds(process.uptime()),
    systemSec: Math.floor(os.uptime()),
    systemHuman: formatSeconds(os.uptime()),
  };
}

function getRuntimeInfo() {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
  };
}

// ─── Health Check Endpoint ───────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  try {
    const memory = getMemoryInfo();
    const status = memory.usedPercent > 95 ? 'degraded' : 'ok';
    const payload = {
      status,
      version: packageJson.version ?? 'unknown',
      service: packageJson.name ?? 'soroban-playground-backend',
      timestamp: new Date().toISOString(),
      uptime: getUptimeInfo(),
      cpu: getCpuUsage(),
      memory,
      runtime: getRuntimeInfo(),
    };
    return res.status(200).json({ success: true, data: payload });
  } catch (err) {
    return res.status(500).json({
      success: false,
      data: {
        status: 'error',
        version: packageJson.version ?? 'unknown',
        timestamp: new Date().toISOString(),
        error: err.message,
      },
    });
  }
});

// GraphQL endpoint
await setupGraphQL(app);

// Error handlers (must be after routes)
app.use(notFoundHandler);
app.use(errorHandler);

setupWebsocketServer(server);
await initializeCompileService();
await initializeTracing();
await initializeMetrics();
startCleanupWorker();
if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
  });
}

export default app;
