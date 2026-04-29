import express from "express";
import cors from "cors";
import { initializeDatabase } from "./database/connection.js";
import compileRoute from "./routes/compile.js";
import deployRoute from "./routes/deploy.js";
import invokeRoute from "./routes/invoke.js";
import searchRoute from "./routes/search.js";
import cacheService from "./services/cacheService.js";
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
import { initializeCompileService } from './services/compileService.js';
import oracleProofQueueService from './services/oracleProofQueueService.js';
import adminRoute from './routes/admin.js';
import metricsRoute, { requestLatency } from './routes/metrics.js';
import oracleRoute from './routes/oracle.js';
import { rateLimitMiddleware } from './middleware/rateLimiter.js';
import oracleQueueRoute from './routes/oracleQueue.js';
import { oracleWorkerPool } from './services/oracleWorkerPool.js';
import migrationRoute from './routes/migration.js';
import lotteryRoute from './routes/lottery.js';
import escrowRoute from './routes/escrow.js';

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
app.use(express.json({ limit: '5mb' }));

// Initialize database and cache on startup
async function initializeServices() {
  try {
    await initializeDatabase();
    console.log('Database initialized successfully');
    
    await cacheService.initialize();
    console.log('Cache service initialized');
  } catch (error) {
    console.error('Service initialization error:', error);
  }
}

// Routes
app.use("/api/compile", compileRoute);
app.use("/api/deploy", deployRoute);
app.use("/api/invoke", invokeRoute);
app.use("/api/search", searchRoute);

// Enhanced health check
app.get("/api/health", async (req, res) => {
  const cacheHealth = await cacheService.healthCheck();
  
  res.json({
    status: "ok",
    message: "Soroban Playground API is running",
    timestamp: new Date().toISOString(),
    service: "soroban-playground-backend",
    services: {
      database: "connected",
      cache: cacheHealth.status
    }
  });
});

// Search-specific health check
app.get("/api/search/health", async (req, res) => {
  const cacheHealth = await cacheService.healthCheck();
  
  res.json({
    success: cacheHealth.status === 'connected',
    status: cacheHealth.status,
    timestamp: new Date().toISOString(),
    service: "search-service"
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
app.use('/api/oracle', oracleQueueRoute);
app.use('/api/admin', adminRoute);
app.use('/api/migrations', migrationRoute);
app.use('/api/lottery', lotteryRoute);
app.use('/api/escrow', escrowRoute);
app.use('/metrics', metricsRoute);

// GraphQL — mounted at /graphql (GraphiQL playground available at GET /graphql)
const yoga = createGraphQLServer();
app.use('/graphql', yoga);

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

// Start server
app.listen(PORT, async () => {
// Error handlers (must be after routes)
app.use(notFoundHandler);
app.use(errorHandler);

setupWebsocketServer(server);
await initializeCompileService();
await oracleProofQueueService.startWorkers();
startCleanupWorker();
oracleWorkerPool.start(); // Start the oracle worker pool
server.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
  await initializeServices();
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await cacheService.close();
  process.exit(0);
});

export default app;
