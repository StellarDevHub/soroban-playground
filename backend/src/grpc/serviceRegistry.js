// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT
//
// Service discovery registry for Soroban Playground microservices.
//
// Provides a lightweight, in-process service registry with:
//   • Registration / deregistration of named service endpoints
//   • Health-check polling (delegates to each service's gRPC HealthCheck RPC)
//   • Round-robin load-balancing across healthy replicas
//   • TTL-based stale-entry eviction
//
// In a production environment this would integrate with Consul or etcd.
// The current implementation is self-contained and suitable for the Docker
// Compose and single-region Render deployments described in the README.
//
// Usage:
//   import { ServiceRegistry } from './grpc/serviceRegistry.js';
//   const registry = new ServiceRegistry({ pollIntervalMs: 15_000 });
//   registry.register('indexer', { host: 'localhost', port: 50051 });
//   const endpoint = registry.resolve('indexer'); // { host, port }

import { GrpcClient } from './client.js';
import { EventEmitter } from 'events';
import { MTLS_ENABLED, TLS_ENABLED } from './grpcCredentials.js';

// ─── Types (JSDoc) ────────────────────────────────────────────────────────────

/**
 * @typedef {object} ServiceEndpoint
 * @property {string}  host
 * @property {number}  port
 * @property {boolean} [tls]
 */

/**
 * @typedef {object} ServiceEntry
 * @property {string}           name
 * @property {ServiceEndpoint}  endpoint
 * @property {'healthy'|'unhealthy'|'unknown'} health
 * @property {number}           registeredAt   - Unix ms
 * @property {number}           lastCheckedAt  - Unix ms
 * @property {GrpcClient|null}  _client
 */

// ─── ServiceRegistry ─────────────────────────────────────────────────────────

export class ServiceRegistry extends EventEmitter {
  /**
   * @param {object} [opts]
   * @param {number} [opts.pollIntervalMs]  - Health-check interval (default: 30 s)
   * @param {number} [opts.ttlMs]           - Entry eviction TTL (default: 120 s)
   * @param {number} [opts.healthTimeoutMs] - Per-probe deadline (default: 5 s)
   */
  constructor(opts = {}) {
    super();
    const {
      pollIntervalMs = 30_000,
      ttlMs = 120_000,
      healthTimeoutMs = 5_000,
    } = opts;

    this._pollIntervalMs = pollIntervalMs;
    this._ttlMs = ttlMs;
    this._healthTimeoutMs = healthTimeoutMs;

    /** @type {Map<string, ServiceEntry[]>} name → list of replicas */
    this._services = new Map();

    /** @type {Map<string, number>} name → round-robin cursor */
    this._cursors = new Map();

    this._timer = null;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  /**
   * Start background health-check polling.
   *
   * @returns {this}
   */
  start() {
    if (this._timer) return this;
    this._timer = setInterval(() => this._pollAll(), this._pollIntervalMs);
    this._timer.unref?.(); // don't prevent process exit
    return this;
  }

  /**
   * Stop polling and close all managed gRPC clients.
   */
  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    for (const entries of this._services.values()) {
      for (const entry of entries) {
        entry._client?.close();
        entry._client = null;
      }
    }
  }

  // ── Registration ────────────────────────────────────────────────────────────

  /**
   * Register a service endpoint.
   *
   * @param {string}          name
   * @param {ServiceEndpoint} endpoint
   */
  register(name, endpoint) {
    if (!this._services.has(name)) this._services.set(name, []);

    const existing = this._services
      .get(name)
      .find(
        (e) =>
          e.endpoint.host === endpoint.host && e.endpoint.port === endpoint.port
      );

    if (existing) {
      existing.registeredAt = Date.now();
      return;
    }

    const client = new GrpcClient({
      host: endpoint.host,
      port: endpoint.port,
      // Honour the endpoint's explicit tls/mtls flag; fall back to the
      // process-level GRPC_MTLS / GRPC_TLS env vars.
      mtls: endpoint.mtls ?? (MTLS_ENABLED || undefined),
      tls: endpoint.tls ?? (TLS_ENABLED || undefined),
      deadlineMs: this._healthTimeoutMs,
    });

    /** @type {ServiceEntry} */
    const entry = {
      name,
      endpoint,
      health: 'unknown',
      registeredAt: Date.now(),
      lastCheckedAt: 0,
      _client: client,
    };

    this._services.get(name).push(entry);
    this.emit('registered', { name, endpoint });
  }

  /**
   * Deregister a specific endpoint.
   *
   * @param {string} name
   * @param {ServiceEndpoint} endpoint
   */
  deregister(name, endpoint) {
    const entries = this._services.get(name);
    if (!entries) return;

    const idx = entries.findIndex(
      (e) =>
        e.endpoint.host === endpoint.host && e.endpoint.port === endpoint.port
    );
    if (idx === -1) return;

    entries[idx]._client?.close();
    entries.splice(idx, 1);
    this.emit('deregistered', { name, endpoint });
  }

  // ── Resolution ──────────────────────────────────────────────────────────────

  /**
   * Resolve the next healthy endpoint for a service using round-robin.
   *
   * @param {string} name
   * @returns {ServiceEndpoint|null}
   */
  resolve(name) {
    const healthy = (this._services.get(name) ?? []).filter(
      (e) => e.health === 'healthy'
    );
    if (healthy.length === 0) return null;

    const cursor = (this._cursors.get(name) ?? 0) % healthy.length;
    this._cursors.set(name, cursor + 1);
    return healthy[cursor].endpoint;
  }

  /**
   * List all registered endpoints for a service (healthy or not).
   *
   * @param {string} name
   * @returns {ServiceEntry[]}
   */
  list(name) {
    return this._services.get(name) ?? [];
  }

  /**
   * Snapshot of all services and their health.
   *
   * @returns {object}
   */
  snapshot() {
    const out = {};
    for (const [name, entries] of this._services.entries()) {
      out[name] = entries.map(
        ({ endpoint, health, registeredAt, lastCheckedAt }) => ({
          endpoint,
          health,
          registeredAt,
          lastCheckedAt,
        })
      );
    }
    return out;
  }

  // ── Health polling ──────────────────────────────────────────────────────────

  async _pollAll() {
    const now = Date.now();
    for (const entries of this._services.values()) {
      // Evict stale entries
      for (let i = entries.length - 1; i >= 0; i--) {
        if (now - entries[i].registeredAt > this._ttlMs) {
          entries[i]._client?.close();
          entries.splice(i, 1);
        }
      }
      // Health-check remaining entries
      for (const entry of entries) {
        this._checkEntry(entry);
      }
    }
  }

  /**
   * @param {ServiceEntry} entry
   */
  async _checkEntry(entry) {
    if (!entry._client) return;
    const prev = entry.health;
    try {
      await entry._client.healthCheck();
      entry.health = 'healthy';
      entry.lastCheckedAt = Date.now();
    } catch {
      entry.health = 'unhealthy';
      entry.lastCheckedAt = Date.now();
    }
    if (entry.health !== prev) {
      this.emit('health_change', {
        name: entry.name,
        endpoint: entry.endpoint,
        health: entry.health,
      });
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const serviceRegistry = new ServiceRegistry();
