// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import cors from 'cors';
import express from 'express';
import fs from 'fs';
import helmet from 'helmet';
import http from 'http';
import morgan from 'morgan';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import apiRouter from './routes/api.js';
import compileRoute from './routes/compile.js';
import deployRoute from './routes/deploy.js';
import invokeRoute from './routes/invoke.js';
import searchRoute from './routes/search.js';
import freelancerIdentityRoute from './routes/freelancerIdentity.js';
import { initializeDatabase } from './database/connection.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import { rateLimitMiddleware } from './middleware/rateLimiter.js';
import cacheService from './services/cacheService.js';
import { setupWebsocketServer } from './websocket.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 5000;

const app = express();
const server = http.createServer(app);

let packageJson = { version: 'unknown', name: 'soroban-playground-backend' };
for (const candidate of ['../../package.json', '../package.json']) {
  try {
    packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, candidate), 'utf8'));
    break;
  } catch {
    // Try the next package manifest location.
  }
}

function memoryInfo() {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;
  return {
    totalMB: Math.round(totalBytes / 1024 / 1024),
    freeMB: Math.round(freeBytes / 1024 / 1024),
    usedMB: Math.round(usedBytes / 1024 / 1024),
    usedPercent: Math.round((usedBytes / totalBytes) * 1000) / 10,
  };
}

async function initializeServices() {
  try {
    await initializeDatabase();
    await cacheService.initialize();
  } catch (error) {
    console.error('Service initialization error:', error);
  }
}

app.use(morgan('combined'));
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(rateLimitMiddleware('global'));

app.get('/api/health', async (_req, res) => {
  const cacheHealth = await cacheService.healthCheck().catch(() => ({ status: 'error' }));
  res.json({
    success: true,
    data: {
      status: memoryInfo().usedPercent > 95 ? 'degraded' : 'ok',
      service: packageJson.name,
      version: packageJson.version,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      memory: memoryInfo(),
      cache: cacheHealth.status,
    },
  });
});

app.use('/api/compile', compileRoute);
app.use('/api/deploy', deployRoute);
app.use('/api/invoke', invokeRoute);
app.use('/api/search', searchRoute);
app.use('/api/freelancer-identity', freelancerIdentityRoute);
app.use('/api', apiRouter);

app.use(notFoundHandler);
app.use(errorHandler);

setupWebsocketServer(server);

server.listen(PORT, async () => {
  await initializeServices();
  console.log(`Backend server running on http://localhost:${PORT}`);
});

process.on('SIGTERM', async () => {
  await cacheService.close();
  server.close(() => process.exit(0));
});

export default app;
