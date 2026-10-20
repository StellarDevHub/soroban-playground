// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import morgan from 'morgan';
import fs from 'fs';
import path from 'path';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'url';

import { initializeTracing } from './tracing.js';
import config from './config/index.js';
import { validateEnv } from './config/env.js';
if (process.env.NODE_ENV !== 'test') {
  initializeTracing();
}
import { createCorsPolicy } from './config/cors.js';
import {
  getCachedOrigins,
  startOriginCacheRefresh,
  stopOriginCacheRefresh,
} from './services/corsWhitelistService.js';

import {
  applyServerTuning,
  createAlpnServer,
  attachAcmeHttp01,
  watchTlsCertificates,
} from './config/http2Config.js';

import { http2PushMiddleware } from './middleware/http2Push.js';
import { chaosInjector } from './middleware/chaosInjector.js';

import apiRouter from './routes/api.js';

import authRoute from './routes/auth.js';

import { startCleanupWorker, stopCleanupWorker } from './cleanupWorker.js';

import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

import { setupWebsocketServer, closeWebsocketServer } from './websocket.js';

import { initializeCompileService } from './services/compileService.js';

import adminRoute from './routes/admin.js';

import metricsRoute, {
  requestLatency,
  recordHttpRequest,
} from './routes/metrics.js';

import oracleRoute from './routes/oracle.js';

import { rateLimitMiddleware } from './middleware/rateLimiter.js';

import { rejectPrototypePollution } from './middleware/validation.js';

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

import cacheInvalidator from './services/cacheInvalidator.js';

import kmsService from './services/kmsService.js';

import { setupGraphQL } from './graphql/index.js';

import {
  initializeDatabase,
  refreshDatabaseConnection,
  closeDatabase,
} from './database/connection.js';

import { compressionMiddleware } from './middleware/compressionMiddleware.js';

import applyDdosProtection from './middleware/ddosMitigation.js';

import applySecurityHeaders from './middleware/securityHeaders.js';

import feeEngineRoute from './routes/feeEngine.js';

import featureFlagsRoute from './routes/featureFlags.js';

import featureFlagService from './services/featureFlagService.js';

import { startMemoryLeakDetector } from './services/memoryLeakDetector.js';

import { contractEventIndexer } from './services/contractEventIndexer.js';

import { runStartupMigrations } from './services/migrationService.js';

import healthService from './services/healthService.js';

import { LedgerSyncService } from './services/ledgerSyncService.js';

import healthRouter, { healthHandler } from './routes/health.js';

import snippetsRoute from './routes/snippets.js';

import deployQueueRoute from './routes/deployQueue.js';

import backupRoute from './routes/backup.js';

import { startBackupScheduler } from './services/backupScheduler.js';

import {
  initializeQueues,
  queueDashboard,
  shutdownQueues,
} from './services/queueService.js';

import backgroundJobsRoute from './routes/backgroundJobs.js';

import predictionMarketRoute from './routes/predictionMarket.js';

import {
  startWebhookDispatcher,
  stopWebhookDispatcher,
} from './services/webhookDispatcher.js';

import webhooksRoute from './routes/webhooks.js';

import corsAdminRoute from './routes/corsAdmin.js';

import serviceRegistryRoute from './routes/serviceRegistry.js';

import batchSubmitterRoute from './routes/batchSubmitter.js';

import { setupSwagger } from './docs/swagger.js';

import { negotiateApiVersion } from './middleware/apiVersioning.js';

import { deprecationHeaders } from './middleware/deprecationHeaders.js';

import queuesRoute from './routes/queues.js';

import rpcRoute from './routes/rpc.js';

import { validateStartupEnv } from './config/envSchema.js';

const _filename = fileURLToPath(import.meta.url);
const _dirname = path.dirname(_filename);

if (process.env.NODE_ENV !== 'test') {
  try {
    validateEnv();
  } catch (err) {
    console.error('Environment validation failed:');
    if (err && err.errors) {
      for (const [key, validationError] of Object.entries(err.errors)) {
        console.error(
          `  - ${key}: ${validationError.message || validationError}`
        );
      }
    } else {
      console.error(err.message);
    }
    process.exit(1);
  }
  // Run Zod-based strict schema validation on startup (#1578)
  validateStartupEnv({ strict: false, logger: console });
}

const app = express();
app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal', '10.0.0.0/8']);
let server;
let websocketRedisClient = null;

// TLS/SSL Hardening configuration — HTTP/2 ALPN prefers h2, falls back to 1.1.
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
    fs.existsSync(path.join(_dirname, 'cert.pem')) &&
    fs.existsSync(path.join(_dirname, 'key.pem'))
  ) {
    httpsOptions.key = fs.readFileSync(path.join(_dirname, 'key.pem'));
    httpsOptions.cert = fs.readFileSync(path.join(_dirname, 'cert.pem'));
    hasCertificates = true;
  }
} catch (err) {
  console.warn(
    '[SSL] Could not load certificates, falling back to HTTP:',
    err.message
  );
}

// Let's Encrypt HTTP-01 challenges must be reachable before HSTS/rate limits.
export const acmeChallengeStore = attachAcmeHttp01(app);

// Fallback to HTTP/1.1 if no certs are provided, otherwise HTTP/2 + TLS 1.3 via ALPN.
server = createAlpnServer(app, hasCertificates ? httpsOptions : null);
applyServerTuning(server);
let stopCertificateWatch = () => {};
if (hasCertificates) {
  stopCertificateWatch = watchTlsCertificates(server, {
    keyPath: process.env.SSL_KEY_PATH || path.join(_dirname, 'key.pem'),
    certPath: process.env.SSL_CERT_PATH || path.join(_dirname, 'cert.pem'),
    intervalMs: Number(process.env.TLS_RELOAD_INTERVAL_MS) || 60_000,
  });
}
const PORT = process.env.PORT || 5000;

// Basic middleware
applyDdosProtection(app);
applySecurityHeaders(app);
// Redis-backed global token bucket, applied once before any route. Route
// limits for compile/deploy/invoke use separate buckets (scoped by name).
app.use(rateLimitMiddleware('global'));
app.use(morgan('combined'));
// CORS: env allowlist + FRONTEND_URL + the live DB whitelist. Untrusted
// Origins are rejected before they reach any route.
const corsPolicy = createCorsPolicy(process.env, getCachedOrigins);
for (const warning of corsPolicy.warnings) console.warn(`[CORS] ${warning}`);
app.use(corsPolicy.enforceOriginIsolation);
app.use(corsPolicy.corsMiddleware);
app.use(express.json({ limit: '5mb' }));
// Reject __proto__/constructor/prototype keys before any handler or
// transformer copies request data into objects.
app.use(rejectPrototypePollution);
app.use(cookieParser());
app.use(compressionMiddleware);
app.use(http2PushMiddleware);

// Header-driven fault injection for resilience testing; no-op unless
// CHAOS_ENABLED=true outside production (Issue #1770).
app.use(chaosInjector);

// Strict Transport Security (HSTS) headers
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
      const route = req.route ? req.route.path : req.path;
      requestLatency.observe(
        {
          method: req.method,
          route,
          status: res.statusCode,
        },
        time
      );
      recordHttpRequest(req.method, route, res.statusCode);
    } catch {
      // Metrics are best-effort
    }
  });
  next();
});

// Routes
app.use('/snippets', snippetsRoute);
app.use('/api', apiRouter);
app.use('/api/auth', authRoute);
app.use('/api/admin', adminRoute);
app.use('/api/oracle', oracleRoute);
app.use('/api/oracle-queue', oracleQueueRoute);
app.use('/api/migration', migrationRoute);
app.use('/api/sports-prediction-market', sportsPredictionMarketRoute);
app.use('/api/warranty-management', warrantyManagementRoute);
app.use('/api/yield-optimizer', yieldOptimizerRoute);
app.use('/api/reit', reitRoute);
app.use('/api/v1', eventsV1Route);
app.use('/api/credentials', credentialsRoute);
app.use('/api/fee-engine', feeEngineRoute);
app.use('/api/feature-flags', featureFlagsRoute);
app.use('/api/health', healthRouter);
app.use('/api/deploy-queue', deployQueueRoute);
app.use('/api/backup', backupRoute);
app.use('/api/background-jobs', backgroundJobsRoute);
app.use('/api/prediction-market', predictionMarketRoute);
app.use('/api/webhooks', webhooksRoute);
app.use('/api/cors-admin', corsAdminRoute);
app.use('/api/service-registry', serviceRegistryRoute);
app.use('/api/batch-submitter', batchSubmitterRoute);
app.use('/api/queues', queuesRoute);
app.use('/api/rpc', rpcRoute);
app.use('/metrics', metricsRoute);

app.use(negotiateApiVersion);
app.use(deprecationHeaders);

setupSwagger(app);

// 404 + error handlers
app.use(notFoundHandler);
app.use(errorHandler);

async function start() {
  try {
    await initializeDatabase();
    await runStartupMigrations();
    await initializeQueues();
    await initializeCompileService();
    await oracleWorkerPool.start();
    await contractEventIndexer.start();
    await LedgerSyncService.start();
    await credentialRotationService.start();
    await featureFlagService.initialize();
    await kmsService.initialize();
    await redisService.connect();
    await cacheInvalidator.start();
    startOriginCacheRefresh();
    startCleanupWorker();
    startMemoryLeakDetector();
    startBackupScheduler();
    startWebhookDispatcher();
    setupWebsocketServer(server);
    server.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

async function shutdown(signal) {
  console.log(`Received ${signal}, shutting down...`);
  try {
    stopCertificateWatch();
    stopOriginCacheRefresh();
    stopCleanupWorker();
    stopWebhookDispatcher();
    await closeWebsocketServer();
    await oracleWorkerPool.stop();
    await contractEventIndexer.stop();
    await LedgerSyncService.stop();
    await credentialRotationService.stop();
    await cacheInvalidator.stop();
    await shutdownQueues();
    await closeDatabase();
    server.close(() => {
      console.log('Server closed.');
      process.exit(0);
    });
  } catch (err) {
    console.error('Error during shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app, server, start, shutdown };
export default app;

if (process.env.NODE_ENV !== 'test' || process.env.LISTEN_IN_TEST === 'true') {
  start();
}
