// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import Redis from 'ioredis';
import { Queue, Worker, FlowProducer } from 'bullmq';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDlqQueueName, routeFailedJobToDlq } from './bullmqDlqService.js';
import config from '../config/index.js';

const _filename = fileURLToPath(import.meta.url);
const _dirname = path.dirname(_filename);

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Distributed-worker concurrency (issue #1333): each queue worker process can
// process this many jobs in parallel. Tune per environment.
const COMPILE_WORKER_CONCURRENCY = config.compile.workerConcurrency;
const DEPLOY_WORKER_CONCURRENCY = config.deployment.workerConcurrency;
const QUEUE_JOB_ATTEMPTS = config.queue.jobAttempts;
const QUEUE_RETRY_BACKOFF_MS = config.queue.retryBackoffMs;

// Track connections to prevent leaks
const activeConnections = [];

// Helper to create Redis connections pooled exclusively for BullMQ
function createConnection(purpose) {
  const client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    enableOfflineQueue: false,
    maxRetriesPerRequest: null,
    retryStrategy(times) {
      // Reconnect after delay, but prevent log flooding
      return Math.min(times * 2000, 30000);
    },
    connectionName: `soroban-playground:bullmq:${purpose}`,
  });

  let loggedError = false;
  client.on('error', (err) => {
    const isConnRefused =
      err.code === 'ECONNREFUSED' ||
      (err.errors && err.errors.some((e) => e.code === 'ECONNREFUSED'));
    // Log once when offline, suppress log spam
    if (process.env.NODE_ENV !== 'test' && !loggedError) {
      if (isConnRefused) {
        console.warn(
          `[BullMQ Redis Offline] [${purpose}]: Redis server not reachable at ${REDIS_URL}. Queue features will be paused until Redis is started.`
        );
        loggedError = true;
      } else {
        console.error(`[BullMQ Redis Error] [${purpose}]:`, err.message);
      }
    }
  });

  client.on('connect', () => {
    loggedError = false;
  });

  activeConnections.push(client);
  return client;
}

// Queue definitions
export const queues = {};
export const workers = {};
export let flowProducer = null;
export let queueDashboard = null;

// Custom backoff strategies
export const backoffStrategies = {
  linear: (attemptsMade, err, options) => {
    const delay = options?.delay || 1000;
    return attemptsMade * delay;
  },
};

/**
 * Initialize queues, workers, flow producer, and Bull Board dashboard.
 */
export function initializeQueues() {
  // 1. Initialize Queues
  queues.indexing = new Queue('indexing', {
    connection: createConnection('queue-indexing'),
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
    },
  });

  queues.email = new Queue('email', {
    connection: createConnection('queue-email'),
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
    },
  });

  queues.cron = new Queue('cron', {
    connection: createConnection('queue-cron'),
    defaultJobOptions: {
      attempts: 2,
      backoff: {
        type: 'fixed',
        delay: 2000,
      },
    },
  });

  queues.compilation = new Queue('compilation', {
    connection: createConnection('queue-compilation'),
    defaultJobOptions: {
      attempts: QUEUE_JOB_ATTEMPTS,
      backoff: {
        type: 'exponential',
        delay: QUEUE_RETRY_BACKOFF_MS,
      },
      removeOnComplete: 1000,
      removeOnFail: false,
    },
  });

  queues.deployment = new Queue('deployment', {
    connection: createConnection('queue-deployment'),
    defaultJobOptions: {
      attempts: QUEUE_JOB_ATTEMPTS,
      backoff: {
        type: 'exponential',
        delay: QUEUE_RETRY_BACKOFF_MS,
      },
      removeOnComplete: 1000,
      removeOnFail: false,
    },
  });

  // Dead-letter queues: exhausted jobs are routed here so failed compilations
  // and deployments are never silently dropped. (issue #1333)
  queues.compilationDlq = new Queue(getDlqQueueName('compilation'), {
    connection: createConnection('queue-compilation-dlq'),
  });
  queues.deploymentDlq = new Queue(getDlqQueueName('deployment'), {
    connection: createConnection('queue-deployment-dlq'),
  });

  for (const [name, queue] of Object.entries(queues)) {
    queue.on('error', (err) => {
      const isConnRefused =
        err.code === 'ECONNREFUSED' ||
        (err.errors && err.errors.some((e) => e.code === 'ECONNREFUSED'));
      if (process.env.NODE_ENV !== 'test' && !isConnRefused) {
        console.error(`[BullMQ Queue Error] [${name}]:`, err.message || err);
      }
    });
  }

  // 2. Initialize FlowProducer for parent-child job trees
  flowProducer = new FlowProducer({
    connection: createConnection('flow-producer'),
  });
  flowProducer.on('error', (err) => {
    const isConnRefused =
      err.code === 'ECONNREFUSED' ||
      (err.errors && err.errors.some((e) => e.code === 'ECONNREFUSED'));
    if (process.env.NODE_ENV !== 'test' && !isConnRefused) {
      console.error('[BullMQ FlowProducer Error]:', err.message || err);
    }
  });

  // 3. Initialize Workers (only if not in test mode, to facilitate mock workers in tests)
  if (process.env.NODE_ENV !== 'test') {
    // Path to sandboxed workers (executing in separate processes)
    const indexingWorkerPath = path.resolve(
      _dirname,
      '../workers/indexingProcessor.js'
    );
    const emailWorkerPath = path.resolve(
      _dirname,
      '../workers/emailProcessor.js'
    );
    const cronWorkerPath = path.resolve(
      _dirname,
      '../workers/cronProcessor.js'
    );
    const compilationWorkerPath = path.resolve(
      _dirname,
      '../workers/compilationProcessor.js'
    );
    const deploymentWorkerPath = path.resolve(
      _dirname,
      '../workers/deploymentProcessor.js'
    );

    workers.indexing = new Worker('indexing', indexingWorkerPath, {
      connection: createConnection('worker-indexing'),
      useWorkerThreads: false, // forces separate child process (sandboxed worker)
      settings: { backoffStrategies },
    });

    workers.email = new Worker('email', emailWorkerPath, {
      connection: createConnection('worker-email'),
      useWorkerThreads: false,
      settings: { backoffStrategies },
    });

    workers.cron = new Worker('cron', cronWorkerPath, {
      connection: createConnection('worker-cron'),
      useWorkerThreads: false,
      settings: { backoffStrategies },
    });

    workers.compilation = new Worker('compilation', compilationWorkerPath, {
      connection: createConnection('worker-compilation'),
      useWorkerThreads: false,
      concurrency: COMPILE_WORKER_CONCURRENCY,
      settings: { backoffStrategies },
    });

    workers.deployment = new Worker('deployment', deploymentWorkerPath, {
      connection: createConnection('worker-deployment'),
      useWorkerThreads: false,
      concurrency: DEPLOY_WORKER_CONCURRENCY,
      settings: { backoffStrategies },
    });

    // Handle worker events
    for (const [name, worker] of Object.entries(workers)) {
      worker.on('completed', (job) => {
        console.log(
          `[BullMQ Worker] Job ${job.id} of queue ${name} has completed.`
        );
      });
      worker.on('failed', (job, err) => {
        console.error(
          `[BullMQ Worker] Job ${job?.id} of queue ${name} has failed:`,
          err.message
        );
        // Route exhausted jobs to their dead-letter queue so they can be
        // inspected or replayed later. (issue #1333)
        const dlqQueue = queues[`${name}Dlq`];
        if (dlqQueue && job) {
          routeFailedJobToDlq({
            job,
            error: err,
            dlqQueue,
            removeOriginal: true,
          }).catch((dlqErr) => {
            console.error(
              `[BullMQ DLQ] Failed to route job ${job.id} to DLQ:`,
              dlqErr.message
            );
          });
        }
      });
      worker.on('error', (err) => {
        if (process.env.NODE_ENV !== 'test') {
          // Worker error event handled silently by custom createConnection logger
        }
      });
    }

    // Schedule default repeatable jobs (cron)
    setupCronJobs().catch((err) => {
      console.error('Failed to setup repeatable cron jobs:', err.message);
    });
  }

  // 4. Initialize Bull Board UI / Dashboard
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');

  createBullBoard({
    queues: [
      new BullMQAdapter(queues.indexing),
      new BullMQAdapter(queues.email),
      new BullMQAdapter(queues.cron),
      new BullMQAdapter(queues.compilation),
      new BullMQAdapter(queues.deployment),
      new BullMQAdapter(queues.compilationDlq),
      new BullMQAdapter(queues.deploymentDlq),
    ],
    serverAdapter,
  });

  queueDashboard = serverAdapter.getRouter();
}

/**
 * Setup default repeatable cron jobs.
 */
async function setupCronJobs() {
  // Add daily cleanup repeatable job
  await queues.cron.add(
    'daily-cleanup',
    { task: 'cleanup' },
    {
      repeat: {
        pattern: '0 0 * * *', // daily at midnight
      },
      jobId: 'daily-cleanup',
    }
  );
  console.log('[BullMQ] Daily cleanup cron job scheduled');
}

/**
 * Add a job to a specific queue.
 */
export async function addJob(queueName, jobName, data, options = {}) {
  const queue = queues[queueName];
  if (!queue) {
    throw new Error(`Queue "${queueName}" not found or not initialized`);
  }
  return await queue.add(jobName, data, options);
}

/**
 * Add a parent-child transaction tree/flow.
 * Format of flow:
 * {
 *   queueName: 'indexing',
 *   name: 'parent-indexing-job',
 *   data: { contractId: 'C123...' },
 *   children: [
 *     { queueName: 'email', name: 'notify-start', data: { to: 'admin@test.com' } }
 *   ]
 * }
 */
export async function addFlow(flow) {
  if (!flowProducer) {
    throw new Error('FlowProducer not initialized');
  }
  return await flowProducer.add(flow);
}

/**
 * Close all queues, workers, flow producer and quit all Redis connections to prevent leaks.
 */
export async function shutdownQueues() {
  console.log(
    '[BullMQ] Shutting down queues, workers, and Redis connections...'
  );

  // 1. Close all Workers
  for (const [name, worker] of Object.entries(workers)) {
    try {
      await worker.close();
      console.log(`[BullMQ] Worker for queue "${name}" closed`);
    } catch (err) {
      console.error(`[BullMQ] Error closing worker "${name}":`, err.message);
    }
  }

  // 2. Close all Queues
  for (const [name, queue] of Object.entries(queues)) {
    try {
      await queue.close();
      console.log(`[BullMQ] Queue "${name}" closed`);
    } catch (err) {
      console.error(`[BullMQ] Error closing queue "${name}":`, err.message);
    }
  }

  // 3. Close Flow Producer
  if (flowProducer) {
    try {
      await flowProducer.close();
      console.log('[BullMQ] FlowProducer closed');
    } catch (err) {
      console.error('[BullMQ] Error closing FlowProducer:', err.message);
    }
  }

  // 4. Quit all Redis Connections
  const quitPromises = activeConnections.map(async (client) => {
    if (client.status !== 'end') {
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
    }
  });

  await Promise.all(quitPromises);
  activeConnections.length = 0;
  console.log('[BullMQ] All background processing connections terminated');
}
