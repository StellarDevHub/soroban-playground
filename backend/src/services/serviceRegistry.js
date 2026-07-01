// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { EventEmitter } from 'events';

const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000;
const DEFAULT_TTL_MS = 30_000; // remove instance if no heartbeat within this window

/**
 * In-process service registry with heartbeat-based health tracking.
 *
 * Services register themselves on startup; they must send periodic
 * heartbeats or be pruned as unhealthy. The registry supports multiple
 * instances per service name and simple round-robin load balancing.
 *
 * This is the default adapter used when no external registry (Consul,
 * etcd, etc.) is configured. Replace the exported singleton or swap the
 * adapter via environment configuration to use an external registry.
 *
 * Emits:
 *   'registered'   { name, instanceId }
 *   'deregistered' { name, instanceId }
 *   'pruned'       { name, instanceId, reason }
 */
export class ServiceRegistry extends EventEmitter {
  #services = new Map(); // name → Map<instanceId, ServiceEntry>
  #ttlMs;
  #pruneTimer = null;

  constructor({ ttlMs = DEFAULT_TTL_MS } = {}) {
    super();
    this.#ttlMs = ttlMs;
  }

  /**
   * Register a service instance.
   *
   * @param {object} opts
   * @param {string} opts.name - logical service name (e.g. 'compile-service')
   * @param {string} opts.instanceId - unique instance id
   * @param {string} opts.host
   * @param {number} opts.port
   * @param {object} [opts.metadata]
   * @returns {string} instanceId
   */
  register({ name, instanceId, host, port, metadata = {} }) {
    if (!name || !instanceId || !host || !port) {
      throw new Error('name, instanceId, host, and port are required');
    }
    if (!this.#services.has(name)) {
      this.#services.set(name, new Map());
    }
    const entry = {
      instanceId,
      host,
      port,
      metadata,
      lastHeartbeat: Date.now(),
      healthy: true,
    };
    this.#services.get(name).set(instanceId, entry);
    this.#startPruneTimer();
    this.emit('registered', { name, instanceId });
    return instanceId;
  }

  /** Update heartbeat timestamp for an instance. */
  heartbeat(name, instanceId) {
    const entry = this.#services.get(name)?.get(instanceId);
    if (!entry)
      throw new Error(`Unknown instance ${instanceId} for service ${name}`);
    entry.lastHeartbeat = Date.now();
    entry.healthy = true;
  }

  /** Explicitly deregister an instance. */
  deregister(name, instanceId) {
    const removed = this.#services.get(name)?.delete(instanceId);
    if (removed) this.emit('deregistered', { name, instanceId });
  }

  /**
   * Resolve a healthy instance for a service.
   * Uses round-robin across healthy instances.
   *
   * @param {string} name
   * @returns {{ host: string, port: number, instanceId: string } | null}
   */
  lookup(name) {
    const instances = this.#services.get(name);
    if (!instances) return null;
    const healthy = [...instances.values()].filter((e) => e.healthy);
    if (healthy.length === 0) return null;
    const entry = healthy[Date.now() % healthy.length];
    return { host: entry.host, port: entry.port, instanceId: entry.instanceId };
  }

  /** List all instances for a service (healthy and unhealthy). */
  list(name) {
    const instances = this.#services.get(name);
    if (!instances) return [];
    return [...instances.values()].map((e) => ({ ...e }));
  }

  /** List all registered service names. */
  listServices() {
    return [...this.#services.keys()];
  }

  #startPruneTimer() {
    if (this.#pruneTimer) return;
    this.#pruneTimer = setInterval(() => this.#pruneStale(), this.#ttlMs / 2);
    if (this.#pruneTimer.unref) this.#pruneTimer.unref();
  }

  #pruneStale() {
    const now = Date.now();
    for (const [name, instances] of this.#services) {
      for (const [instanceId, entry] of instances) {
        if (now - entry.lastHeartbeat > this.#ttlMs) {
          entry.healthy = false;
          instances.delete(instanceId);
          this.emit('pruned', {
            name,
            instanceId,
            reason: 'heartbeat_timeout',
          });
        }
      }
    }
  }

  stopPruning() {
    if (this.#pruneTimer) {
      clearInterval(this.#pruneTimer);
      this.#pruneTimer = null;
    }
  }
}

export const serviceRegistry = new ServiceRegistry();

/**
 * Register this backend instance on startup and start sending heartbeats.
 *
 * @param {object} opts
 * @param {ServiceRegistry} [opts.registry]
 * @param {string} [opts.name]
 * @param {string} [opts.instanceId]
 * @param {string} [opts.host]
 * @param {number} [opts.port]
 * @param {number} [opts.heartbeatIntervalMs]
 * @returns {{ instanceId: string, stop: function }}
 */
export function registerSelf({
  registry = serviceRegistry,
  name = process.env.SERVICE_NAME ?? 'soroban-playground-backend',
  instanceId = `${name}-${process.pid}`,
  host = process.env.HOST ?? 'localhost',
  port = Number(process.env.PORT) || 5000,
  heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
} = {}) {
  registry.register({ name, instanceId, host, port });

  const timer = setInterval(() => {
    try {
      registry.heartbeat(name, instanceId);
    } catch {
      // If the instance was pruned, re-register
      registry.register({ name, instanceId, host, port });
    }
  }, heartbeatIntervalMs);

  if (timer.unref) timer.unref();

  return {
    instanceId,
    stop() {
      clearInterval(timer);
      registry.deregister(name, instanceId);
    },
  };
}
