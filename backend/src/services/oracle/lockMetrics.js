// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import client from 'prom-client';

const registry = new client.Registry();

export const lockAcquireTotal = new client.Counter({
  name: 'oracle_lock_acquire_total',
  help: 'Total lock acquisition attempts',
  labelNames: ['scope', 'outcome'],
});

export const lockReleaseTotal = new client.Counter({
  name: 'oracle_lock_release_total',
  help: 'Total lock release attempts',
  labelNames: ['scope', 'outcome'],
});

export const lockHoldDuration = new client.Histogram({
  name: 'oracle_lock_hold_duration_seconds',
  help: 'How long a lock was held before being released',
  labelNames: ['scope'],
  buckets: [0.001, 0.01, 0.05, 0.1, 0.5, 1, 5, 30],
});

export const lockAcquireLatency = new client.Histogram({
  name: 'oracle_lock_acquire_latency_seconds',
  help: 'How long acquire() took (including retries)',
  labelNames: ['scope', 'outcome'],
  buckets: [0.001, 0.01, 0.05, 0.1, 0.5, 1, 5, 30],
});

export const lockContention = new client.Counter({
  name: 'oracle_lock_contention_total',
  help: 'Acquires that had to retry at least once',
  labelNames: ['scope'],
});

export const lockActiveGauge = new client.Gauge({
  name: 'oracle_lock_active',
  help: 'Number of currently held locks per scope',
  labelNames: ['scope'],
});

export const lockBackendGauge = new client.Gauge({
  name: 'oracle_lock_backend_mode',
  help: 'Active lock backend (1=redis, 0=memory fallback)',
});

export const deadlocksDetectedTotal = new client.Counter({
  name: 'oracle_lock_deadlocks_detected_total',
  help: 'Number of deadlock cycles detected',
});

export const consensusElectionsTotal = new client.Counter({
  name: 'oracle_consensus_elections_total',
  help: 'Leader elections performed',
  labelNames: ['outcome'],
});

[
  lockAcquireTotal,
  lockReleaseTotal,
  lockHoldDuration,
  lockAcquireLatency,
  lockContention,
  lockActiveGauge,
  lockBackendGauge,
  deadlocksDetectedTotal,
  consensusElectionsTotal,
].forEach((m) => registry.registerMetric(m));

export const oracleLockRegistry = registry;

export function metricsText() {
  return registry.metrics();
}
