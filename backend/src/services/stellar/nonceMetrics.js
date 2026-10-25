// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import client from 'prom-client';

const registry = new client.Registry();

export const nonceReservationsTotal = new client.Counter({
  name: 'stellar_nonce_reservations_total',
  help: 'Total nonce reservations by outcome (reserved|committed|released|failed|timed_out)',
  labelNames: ['account', 'outcome'],
});

export const nonceSequenceDepth = new client.Gauge({
  name: 'stellar_nonce_sequence_depth',
  help: 'Current sequence counter depth per relayer account',
  labelNames: ['account'],
});

export const nonceActiveReservations = new client.Gauge({
  name: 'stellar_nonce_active_reservations',
  help: 'Currently held (uncommitted) reservations per relayer account',
  labelNames: ['account'],
});

export const nonceFreeSequences = new client.Gauge({
  name: 'stellar_nonce_free_sequences',
  help: 'Released sequence numbers queued for reuse per relayer account (gap fillers)',
  labelNames: ['account'],
});

export const nonceErrorsTotal = new client.Counter({
  name: 'stellar_nonce_errors_total',
  help: 'Nonce manager errors by account and type (bad_seq|network|timeout|redis|init|unknown)',
  labelNames: ['account', 'type'],
});

export const nonceResyncTotal = new client.Counter({
  name: 'stellar_nonce_resync_total',
  help: 'On-chain sequence resynchronization attempts by outcome',
  labelNames: ['account', 'outcome'],
});

export const nonceReserveLatency = new client.Histogram({
  name: 'stellar_nonce_reserve_latency_seconds',
  help: 'Latency of nonce reservation acquisition',
  labelNames: ['account'],
  buckets: [0.0005, 0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
});

[
  nonceReservationsTotal,
  nonceSequenceDepth,
  nonceActiveReservations,
  nonceFreeSequences,
  nonceErrorsTotal,
  nonceResyncTotal,
  nonceReserveLatency,
].forEach((m) => registry.registerMetric(m));

export const nonceManagerRegistry = registry;

export function nonceMetricsText() {
  return registry.metrics();
}
