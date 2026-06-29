// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Asynchronous in-process job queue for contract deployments.
 *
 * Accepts deployment jobs, executes them with bounded concurrency (1 at a time
 * by default), and stores results so callers can poll by job ID.
 *
 * @module deployQueue
 */

import { randomBytes } from 'crypto';

/** Max concurrent deploy workers. */
const CONCURRENCY = 1;

/** @type {Map<string, import('../types/index.ts').DeployJob>} */
const jobs = new Map();

/** @type {string[]} - pending job IDs in FIFO order */
const queue = [];

let activeCount = 0;

/**
 * Generate a random job ID.
 * @returns {string}
 */
function generateJobId() {
  return `job_${randomBytes(4).toString('hex')}`;
}

/**
 * Simulate a deploy operation (matches the existing v1/deploy.js behaviour).
 * Swap this for real Soroban CLI invocation in production.
 *
 * @param {import('../types/index.ts').DeployJob} job
 * @returns {Promise<import('../types/index.ts').DeployJobResult>}
 */
async function executeDeploy(job) {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const contractId =
    'C' + Math.random().toString(36).substring(2, 54).toUpperCase();
  return {
    contractId,
    contractName: job.contractName,
    network: job.network,
    wasmPath: job.wasmPath,
    deployedAt: new Date().toISOString(),
    message: `Contract "${job.contractName}" deployed successfully to ${job.network}`,
  };
}

/**
 * Drain the queue: pick the next pending job and run it.
 */
function drain() {
  if (activeCount >= CONCURRENCY || queue.length === 0) return;

  const jobId = queue.shift();
  const job = jobs.get(jobId);
  if (!job) return;

  activeCount++;
  job.status = 'running';
  job.startedAt = new Date().toISOString();

  executeDeploy(job)
    .then((result) => {
      job.status = 'done';
      job.result = result;
      job.completedAt = new Date().toISOString();
    })
    .catch((err) => {
      job.status = 'failed';
      job.error = err.message;
      job.completedAt = new Date().toISOString();
    })
    .finally(() => {
      activeCount--;
      drain();
    });
}

/**
 * Enqueue a new deploy job.
 *
 * @param {import('../types/index.ts').EnqueueDeployInput} input
 * @returns {import('../types/index.ts').DeployJob} The created job record.
 */
export function enqueueDeployJob(input) {
  const id = generateJobId();

  /** @type {import('../types/index.ts').DeployJob} */
  const job = {
    id,
    wasmPath: input.wasmPath,
    contractName: input.contractName,
    network: input.network || 'testnet',
    status: 'queued',
    createdAt: new Date().toISOString(),
  };

  jobs.set(id, job);
  queue.push(id);
  drain();
  return job;
}

/**
 * Get a job by ID.
 *
 * @param {string} id
 * @returns {import('../types/index.ts').DeployJob|null}
 */
export function getDeployJob(id) {
  return jobs.get(id) ?? null;
}

/**
 * Return queue statistics.
 *
 * @returns {import('../types/index.ts').DeployQueueStats}
 */
export function getQueueStats() {
  const allJobs = Array.from(jobs.values());
  return {
    queued: allJobs.filter((j) => j.status === 'queued').length,
    running: allJobs.filter((j) => j.status === 'running').length,
    done: allJobs.filter((j) => j.status === 'done').length,
    failed: allJobs.filter((j) => j.status === 'failed').length,
    total: allJobs.length,
  };
}
