// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import http from 'http';
import https from 'https';
import cors from 'cors';
import morgan from 'morgan';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import config from './config/index.js';
import { corsOptions } from './config/cors.js';
import { applyServerTuning } from './config/http2Config.js';
import { http2PushMiddleware } from './middleware/http2Push.js';
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
import warrantyManagementRoute from './routes/warrantyManagement.js';
import yieldOptimizerRoute from './routes/yieldOptimizer.js';
import reitRoute from './routes/reit.js';
import eventsV1Route from './routes/v1/events.js';
import credentialsRoute from './routes/credentials.js';
import credentialRotationService from './services/credentialRotationService.js';
import redisService from './services/redisService.js';
import { setupGraphQL } from './graphql/index.js';
import {
  initializeDatabase,
  refreshDatabaseConnection,
} from './database/connection.js';
import { compressionMiddleware } from './middleware/compressionMiddleware.js';
import feeEngineRoute from './routes/feeEngine.js';
import featureFlagsRoute from './routes/featureFlags.js';
import featureFlagService from './services/featureFlagService.js';
import { LedgerSyncService } from './services/ledgerSyncService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
applyServerTuning(server); // HTTP/2: keep-alive + headers-timeout tuning

// TLS/SSL Hardening configuration
const httpsOptions = {
  minVersion: 'TLSv1.2',
  maxVersion: 'TLSv1.3',
  ciphers: [
    'TLS_AES_256_GCM_SHA384',
    'TLS_CHACHA20_POLY1305_SHA256',
    'TLS_AES_128_GCM_SHA256',
    'ECDHE-RSA-AES256-GCM-SHA384',
    'ECDHE-ECDSA-AES256-GCM-SHA384',
    'ECDHE-RSA-AES128-GCM-SHA256',
    'ECDHE-ECDSA-AES128-GCM-SHA256',
    'ECDHE-ECDSA-CHACHA20-POLY1305',
    'ECDHE-RSA-CHACHA20-POLY1305',
    'DHE-RSA-AES256-GCM-SHA384',
    'DHE-RSA-AES128-GCM-SHA256',
  ].join(':'),
  honorCipherOrder: true,
  ecdhCurve: 'X25519:P-256:P-384',
};

// Attempt to load SSL certificates
let hasCertificates = false;
try {
  if (process.env.SSL_KEY_PATH && process.env.SSL_CERT_PATH) {
    httpsOptions.key = fs.readFileSync(process.env.SSL_KEY_PATH);
    httpsOptions.cert = fs.readFileSync(process.env.SSL_CERT_PATH);
    hasCertificates = true;
  } else if (
    fs.existsSync(path.join(__dirname, 'cert.pem')) &&
    fs.existsSync(path.join(__dirname, 'key.pem'))
  ) {
    httpsOptions.key = fs.readFileSync(path.join(__dirname, 'key.pem'));
    httpsOptions.cert = fs.readFileSync(path.join(__dirname, 'cert.pem'));
    hasCertificates = true;
  }
} catch (err) {
  console.warn('Could not load SSL certificates:', err.message);
}

// Fallback to HTTP if no certs are provided, otherwise use HTTPS
const server = hasCertificates
  ? https.createServer(httpsOptions, app)
  : http.createServer(app);
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
app.use(compressionMiddleware);
app.use(http2PushMiddleware);

// Strict Transport Security (HSTS) headers
// max-age=63072000 is 2 years, required for Qualys SSL Labs A+ and HSTS preload list
app.use((req, res, next) => {
  res.setHeader(
    'Strict-Transport-Security',
    'max-age=63072000; includeSubDomains; preload'
  );
  next();
});

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
app.use('/api/warranty', warrantyManagementRoute);
app.use('/api/yield-optimizer', yieldOptimizerRoute);
app.use('/api/reit', reitRoute);
app.use('/api/fee-engine', feeEngineRoute);
app.use('/api/feature-flags', featureFlagsRoute);
app.use('/api/webhooks', webhooksRoute);
app.use('/api/cors-whitelist', corsAdminRoute);
app.use('/api/v1/events', eventsV1Route);
app.use('/api/registry', serviceRegistryRoute);
app.use('/api/batch', batchSubmitterRoute);
app.use('/api/credentials', credentialsRoute);
app.use('/metrics', metricsRoute);

// GraphQL Endpoint
setupGraphQL(app);
setupSwagger(app);

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
app.get('/', (_req, res) => {
  res.status(200).send('Soroban Playground Backend API is running.');
});

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

// Wires runtime secret rotation onto the live DB/Redis connections. Opt-in: only
// active when a rotation source or encryption key is configured, so default
// behaviour is unchanged.
function setupCredentialRotation() {
  const { intervalMs, graceMs, sourceFile, encryptionKey } =
    config.credentialRotation;
  if (!sourceFile && !encryptionKey && !intervalMs) return;

  credentialRotationService.configure({
    encryptionKey,
    sourceFile,
    intervalMs,
    graceMs,
    initial: {
      DATABASE_URL: process.env.DATABASE_URL,
      REDIS_URL: process.env.REDIS_URL,
    },
  });

  credentialRotationService.onRotate('REDIS_URL', (url) =>
    redisService.rotateConnection(url)
  );
  credentialRotationService.onRotate('DATABASE_URL', (value) =>
    refreshDatabaseConnection({
      filename: value.replace(/^sqlite:\/\//, ''),
      graceMs,
    })
  );

  credentialRotationService.start();
}

// WebSocket + compile service + database init
initializeDatabase()
  .then((db) => {
    setupWebsocketServer(server);
    initializeCompileService().catch(console.error);
    oracleWorkerPool.start();
    startCleanupWorker();
    featureFlagService.initSubscriber();
    startWebhookDispatcher();
    setupCredentialRotation();
    if (process.env.LEDGER_SYNC_ENABLED === 'true') {
      new LedgerSyncService({ db }).start();
    }

    // Start listening
    server.listen(PORT, () => {
      const protocol = hasCertificates ? 'https' : 'http';
      console.log(
        `✅  Backend server running on ${protocol}://localhost:${PORT}`
      );
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
