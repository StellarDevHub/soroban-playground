// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import http from 'http';
import cors from 'cors';
import morgan from 'morgan';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import './config/index.js';
import { corsOptions } from './config/cors.js';
import apiRouter from './routes/api.js';
import { startCleanupWorker } from './cleanupWorker.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import { setupWebsocketServer } from './websocket.js';
import { initializeCompileService } from './services/compileService.js';
import adminRoute from './routes/admin.js';
import metricsRoute, { requestLatency } from './routes/metrics.js';
import oracleRoute from './routes/oracle.js';
import { rateLimitMiddleware } from './middleware/rateLimiter.js';
import oracleQueueRoute from './routes/oracleQueue.js';
import { oracleWorkerPool } from './services/oracleWorkerPool.js';
import migrationRoute from './routes/migration.js';
import sportsPredictionMarketRoute from './routes/sportsPredictionMarket.js';
import tokenizedReitRoute from './routes/tokenizedReit.js';
import treasuryRoute from './routes/treasury.js';
import storageRoute from './routes/storage.js';
import { initializeDatabase } from './database/connection.js';
import { setupGraphQL } from './graphql/index.js';

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

// Basic middleware
app.use(morgan('combined'));
app.use(cors(corsOptions));
app.use(express.json({ limit: '5mb' }));

// Latency tracking middleware
app.use((req, res, next) => {
  const start = process.hrtime();
  res.on('finish', () => {
    const diff = process.hrtime(start);
    const time = diff[0] + diff[1] / 1e9;
    try {
      requestLatency.observe(
        {
          method: req.method,
          route: req.route ? req.route.path : req.path,
          status: res.statusCode,
        },
        time
      );
    } catch {
      // metrics are best-effort
    }
  });
  next();
});

// Rate limiting
// app.use(rateLimitMiddleware('global'));

// Routes
app.use('/api', apiRouter);
app.use('/api/oracle', oracleQueueRoute);
app.use('/api/admin', adminRoute);
app.use('/api/migrations', migrationRoute);
app.use('/api/sports-markets', sportsPredictionMarketRoute);
app.use('/api/reit', tokenizedReitRoute);
app.use('/api/treasury', treasuryRoute);
app.use('/api/storage', storageRoute);
app.use('/metrics', metricsRoute);

// GraphQL Endpoint
setupGraphQL(app);

// ─── Health Check Helpers ──────────────────────────────────────────────────────

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

// ─── Health Check Endpoint ────────────────────────────────────────────────────
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

// Error handlers (must be after routes)
app.use(notFoundHandler);
app.use(errorHandler);

// WebSocket + compile service + database init
initializeDatabase()
  .then(() => {
    setupWebsocketServer(server);
    initializeCompileService().catch(console.error);
    oracleWorkerPool.start();
    startCleanupWorker();

    // Start listening
    server.listen(PORT, () => {
      console.log(`✅  Backend server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('CRITICAL: Database initialization failed:', err);
    process.exit(1);
  });

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down gracefully...');
  server.close(() => process.exit(0));
});

export default app;
