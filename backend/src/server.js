// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import fs from 'fs';
import path from 'path';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'url';

import config from './config/index.js';
import { corsOptions } from './config/cors.js';
import {
  applyServerTuning,
  createAlpnServer,
  attachAcmeHttp01,
  watchTlsCertificates,
} from './config/http2Config.js';
import { http2PushMiddleware } from './middleware/http2Push.js';
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

const _filename = fileURLToPath(import.meta.url);
const _dirname = path.dirname(_filename);

const app = express();
app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal', '10.0.0.0/8']);
let httpServer = http.createServer(app);
applyServerTuning(httpServer); // HTTP/2: keep-alive + headers-timeout tuning

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
const server = createAlpnServer(app, hasCertificates ? httpsOptions : null);
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
app.use(rateLimitMiddleware('global'));
app.use(morgan('combined'));
app.use(cors(corsOptions));
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());
app.use(compressionMiddleware);
app.use(http2PushMiddleware);

// Apply the Redis-backed global limiter before any API route is dispatched.
// Route-specific compile/deploy limits remain available through the factory.
app.use(rateLimitMiddleware('global'));

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
app.use('/api/snippets', snippetsRoute);
app.use('/api/deploy-queue', deployQueueRoute);
app.use('/api/backup', backupRoute);
app.use('/api/auth', authRoute);
app.use('/api/background-jobs', backgroundJobsRoute);

if (
  config.app?.env === 'development' ||
  process.env.NODE_ENV === 'development'
) {
  app.use('/admin/queues', (req, res, next) => {
    if (queueDashboard) {
      return queueDashboard(req, res, next);
    }
    res.status(503).json({ error: 'Queue dashboard initializing' });
  });
}

app.use('/api/prediction-market', predictionMarketRoute);
app.use('/metrics', metricsRoute);

// GraphQL & Swagger
setupGraphQL(app);
setupSwagger(app);

// Health Check and Readiness Probes
app.get('/', (_req, res) => {
  res.status(200).send('Soroban Playground Backend API is running.');
});

app.use('/health', healthRouter);
app.get('/api/health', healthHandler);

// Error handlers (must be registered after routes)
app.use(notFoundHandler);
app.use(errorHandler);

// Secret rotation setup
function setupCredentialRotation() {
  const { intervalMs, graceMs, sourceFile, encryptionKey } =
    config.credentialRotation || {};
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

let ledgerSyncServiceInstance = null;

// Initialize Database & Boot Services
initializeDatabase()
  .then(async (db) => {
    setupWebsocketServer(server);
    await initializeCompileService().catch((err) =>
      console.error('[CompileService] Initialization error:', err)
    );

    oracleWorkerPool.start();
    startCleanupWorker();
    startBackupScheduler();
    featureFlagService.initSubscriber();
    startWebhookDispatcher();
    setupCredentialRotation();
    initializeQueues();
    cacheInvalidator.start().catch((err) =>
      console.warn('[CacheInvalidator] start failed:', err.message)
    );
    kmsService.start();

    if (process.env.LEDGER_SYNC_ENABLED === 'true') {
      ledgerSyncServiceInstance = new LedgerSyncService({ db });
      ledgerSyncServiceInstance.start();
    }

    if (process.env.NODE_ENV !== 'test') {
      server.listen(PORT, () => {
        const protocol = hasCertificates ? 'https' : 'http';
        console.log(
          `✅ Backend server running on ${protocol}://localhost:${PORT}`
        );
      });
    }
  })
  .catch((err) => {
    console.error('CRITICAL: Database initialization failed:', err);
    process.exit(1);
  });

// Graceful Shutdown Handler
let isShuttingDown = false;
const SHUTDOWN_TIMEOUT_MS = 30000;

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[Shutdown] Received ${signal}. Starting graceful shutdown...`);

  const forceExit = setTimeout(() => {
    console.error(
      '[Shutdown] Graceful shutdown timed out after 30s. Force exiting process.'
    );
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  if (forceExit.unref) forceExit.unref();

  try {
    // 1. Stop background workers and queue consumers
    console.log('[Shutdown] Stopping background workers...');
    stopCleanupWorker();
    stopWebhookDispatcher();
    stopCertificateWatch();
    cacheInvalidator.stop().catch(() => {});
    kmsService.stop();
    if (ledgerSyncServiceInstance) ledgerSyncServiceInstance.stop();
    await oracleWorkerPool.stop();
    credentialRotationService.stop();

    try {
      await shutdownQueues();
    } catch (err) {
      console.error('[Shutdown] Error closing BullMQ queues:', err.message);
    }

    // 2. Stop accepting new HTTP requests
    console.log('[Shutdown] Stopping HTTP server...');
    await new Promise((resolve) => server.close(resolve));

    // 3. Terminate WebSockets cleanly
    console.log('[Shutdown] Terminating WebSocket connections...');
    if (typeof closeWebsocketServer === 'function') {
      await closeWebsocketServer();
    }

    // 4. Drain database pool and close Redis connections
    console.log('[Shutdown] Closing database and Redis connections...');
    await closeDatabase();

    if (redisService.client && redisService.client.status !== 'end') {
      try {
        await redisService.client.quit();
      } catch (_) {
        redisService.client.disconnect();
      }
    }

    console.log('[Shutdown] Graceful shutdown completed cleanly.');
    clearTimeout(forceExit);
    process.exit(0);
  } catch (err) {
    console.error('[Shutdown] Error encountered during execution:', err);
    clearTimeout(forceExit);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;
