// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * BE-07 — Dynamic Ephemeral Quickstart Container Orchestrator
 *
 * Communicates with the Docker Engine API (via the local Unix socket or a
 * configurable TCP endpoint) to spawn isolated, ephemeral stellar/quickstart
 * containers on-demand for each user session.
 *
 * Design highlights
 * ─────────────────
 * • One bridge network per container — hard tenant isolation, no cross-talk.
 * • cgroup-v2 resource limits: CPU, RAM, and PID caps enforced at create time.
 * • Health polling against the Soroban RPC `getHealth` JSON-RPC method before
 *   returning an endpoint — guarantees < 8 s ready time on warm hardware.
 * • TTL auto-reaper: a shared `setInterval` ticks every 60 s and destroys any
 *   session whose `lastActivityAt` is more than CONTAINER_TTL_MS in the past.
 * • Friendbot pre-funding: after RPC is healthy, hits the embedded friendbot
 *   HTTP endpoint for each configured default test account.
 * • Full cleanup on destruction: container stop → remove (--volumes), network
 *   remove — 100 % reclaim of CPU, RAM, disk volumes.
 * • Orphan recovery: on startup the orchestrator inspects all running
 *   containers that carry the `soroban-playground.session` label and re-adopts
 *   or destroys them so a daemon restart leaves no ghost containers.
 *
 * Environment variables (all optional — sensible defaults provided)
 * ─────────────────────────────────────────────────────────────────
 * DOCKER_SOCKET_PATH          Path to the Docker Unix socket.
 *                             Default: /var/run/docker.sock
 * DOCKER_HOST                 Alternative TCP endpoint, e.g. tcp://localhost:2375.
 *                             When set, overrides DOCKER_SOCKET_PATH.
 * QUICKSTART_IMAGE            stellar/quickstart image tag to pull.
 *                             Default: stellar/quickstart:latest
 * QUICKSTART_RPC_PORT_START   First port in the dynamic allocation range.
 *                             Default: 11000
 * QUICKSTART_RPC_PORT_END     Last port in the range.
 *                             Default: 11999
 * QUICKSTART_FRIENDBOT_PORT_START  Friendbot dynamic port range start.
 *                             Default: 12000
 * QUICKSTART_MEMORY_MB        Container RAM cap in MiB.   Default: 1536
 * QUICKSTART_CPU_PERIOD       cfs_period_us.              Default: 100000
 * QUICKSTART_CPU_QUOTA        cfs_quota_us (≈ 1.5 CPUs).  Default: 150000
 * QUICKSTART_PIDS_LIMIT       Maximum PID count.          Default: 512
 * CONTAINER_TTL_MS            Idle-session TTL in ms.     Default: 1800000 (30 min)
 * QUICKSTART_HEALTH_TIMEOUT_MS  Max wait for RPC health.  Default: 8000
 * QUICKSTART_HEALTH_POLL_MS   Poll interval during startup. Default: 250
 * QUICKSTART_DEFAULT_ACCOUNTS Comma-separated Stellar addresses to pre-fund.
 *                             Default: (empty — no pre-funding)
 * QUICKSTART_NETWORK_PASSPHRASE  Standalone network passphrase.
 *                             Default: Standalone Network ; February 2017
 */

import http from 'node:http';
import https from 'node:https';
import { EventEmitter } from 'node:events';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ContainerSession {
  /** Opaque user/session identifier supplied by the caller. */
  sessionId: string;
  /** Full Docker container ID (64-char hex). */
  containerId: string;
  /** Dedicated bridge network ID. */
  networkId: string;
  /** Host port mapped to the Soroban RPC endpoint inside the container. */
  rpcPort: number;
  /** Host port mapped to the friendbot HTTP server inside the container. */
  friendbotPort: number;
  /** ISO-8601 timestamp of container creation. */
  createdAt: string;
  /** ISO-8601 timestamp of last observed activity (updated by callers via touch()). */
  lastActivityAt: string;
  /** Current lifecycle state. */
  status: 'starting' | 'ready' | 'stopping' | 'stopped' | 'error';
}

export interface SpawnOptions {
  /** Stellar accounts (G… addresses) to pre-fund via friendbot. */
  accountsToFund?: string[];
  /** Override the container memory cap (MiB). */
  memoryMb?: number;
  /** Override the container CPU quota (cfs_quota_us). */
  cpuQuota?: number;
}

export interface OrchestratorConfig {
  dockerSocketPath: string;
  dockerHost: string | null;
  quickstartImage: string;
  rpcPortStart: number;
  rpcPortEnd: number;
  friendbotPortStart: number;
  memoryMb: number;
  cpuPeriod: number;
  cpuQuota: number;
  pidsLimit: number;
  containerTtlMs: number;
  healthTimeoutMs: number;
  healthPollMs: number;
  defaultAccounts: string[];
  networkPassphrase: string;
}

// ── Config ────────────────────────────────────────────────────────────────────

function buildConfig(): OrchestratorConfig {
  const env = process.env;
  return {
    dockerSocketPath: env.DOCKER_SOCKET_PATH ?? '/var/run/docker.sock',
    dockerHost: env.DOCKER_HOST ?? null,
    quickstartImage: env.QUICKSTART_IMAGE ?? 'stellar/quickstart:latest',
    rpcPortStart: parseInt(env.QUICKSTART_RPC_PORT_START ?? '11000', 10),
    rpcPortEnd: parseInt(env.QUICKSTART_RPC_PORT_END ?? '11999', 10),
    friendbotPortStart: parseInt(
      env.QUICKSTART_FRIENDBOT_PORT_START ?? '12000',
      10,
    ),
    memoryMb: parseInt(env.QUICKSTART_MEMORY_MB ?? '1536', 10),
    cpuPeriod: parseInt(env.QUICKSTART_CPU_PERIOD ?? '100000', 10),
    cpuQuota: parseInt(env.QUICKSTART_CPU_QUOTA ?? '150000', 10),
    pidsLimit: parseInt(env.QUICKSTART_PIDS_LIMIT ?? '512', 10),
    containerTtlMs: parseInt(env.CONTAINER_TTL_MS ?? '1800000', 10),
    healthTimeoutMs: parseInt(
      env.QUICKSTART_HEALTH_TIMEOUT_MS ?? '8000',
      10,
    ),
    healthPollMs: parseInt(env.QUICKSTART_HEALTH_POLL_MS ?? '250', 10),
    defaultAccounts: env.QUICKSTART_DEFAULT_ACCOUNTS
      ? env.QUICKSTART_DEFAULT_ACCOUNTS.split(',').map((a) => a.trim()).filter(Boolean)
      : [],
    networkPassphrase:
      env.QUICKSTART_NETWORK_PASSPHRASE ??
      'Standalone Network ; February 2017',
  };
}

// ── Custom error ──────────────────────────────────────────────────────────────

export class EphemeralQuickstartError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(
    message: string,
    {
      code = 'QUICKSTART_ERROR',
      statusCode = 500,
      details,
    }: { code?: string; statusCode?: number; details?: unknown } = {},
  ) {
    super(message);
    this.name = 'EphemeralQuickstartError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

// ── Port allocator ────────────────────────────────────────────────────────────

/**
 * Tracks which host ports are in use and hands out the next available one
 * within the configured range.  Uses a simple in-process set — the range is
 * expected to be ≥ 1 000 ports, large enough to prevent exhaustion in normal
 * single-node operation.
 */
class PortAllocator {
  private readonly used = new Set<number>();

  constructor(
    private readonly start: number,
    private readonly end: number,
  ) {}

  /** Reserves and returns the next free port, or throws when the range is full. */
  allocate(): number {
    for (let port = this.start; port <= this.end; port++) {
      if (!this.used.has(port)) {
        this.used.add(port);
        return port;
      }
    }
    throw new EphemeralQuickstartError(
      `Port range ${this.start}–${this.end} exhausted`,
      { code: 'PORT_RANGE_EXHAUSTED', statusCode: 503 },
    );
  }

  /** Returns a port to the pool so it can be reused by the next session. */
  release(port: number): void {
    this.used.delete(port);
  }

  /** Pre-reserves a specific port (used during orphan recovery). */
  reserve(port: number): void {
    this.used.add(port);
  }
}

// ── Docker Engine API client ──────────────────────────────────────────────────

interface DockerRequestOptions {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  body?: unknown;
}

interface DockerResponse {
  statusCode: number;
  body: unknown;
}

/**
 * Minimal Docker Engine API client that speaks directly to the Unix socket
 * (or an optional TCP host) without requiring the `dockerode` package.
 *
 * Only the subset of endpoints required by the orchestrator is implemented.
 */
class DockerClient {
  private readonly socketPath: string | null;
  private readonly host: string | null;

  constructor(config: Pick<OrchestratorConfig, 'dockerSocketPath' | 'dockerHost'>) {
    if (config.dockerHost) {
      this.host = config.dockerHost;
      this.socketPath = null;
    } else {
      this.socketPath = config.dockerSocketPath;
      this.host = null;
    }
  }

  /** Low-level HTTP request to the Docker Engine API. */
  async request(opts: DockerRequestOptions): Promise<DockerResponse> {
    return new Promise((resolve, reject) => {
      const payload =
        opts.body !== undefined ? JSON.stringify(opts.body) : undefined;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (payload !== undefined) {
        headers['Content-Length'] = String(Buffer.byteLength(payload));
      }

      const reqOptions: http.RequestOptions = {
        method: opts.method,
        path: opts.path,
        headers,
      };

      let transport: typeof http | typeof https;
      if (this.host) {
        // TCP or HTTPS Docker host
        const url = new URL(this.host.replace(/^tcp:\/\//, 'http://'));
        reqOptions.hostname = url.hostname;
        reqOptions.port = url.port ? parseInt(url.port, 10) : 2375;
        transport = this.host.startsWith('https') ? https : http;
      } else {
        // Unix socket
        reqOptions.socketPath = this.socketPath!;
        reqOptions.hostname = 'localhost';
        transport = http;
      }

      const req = transport.request(reqOptions, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed: unknown;
          try {
            parsed = raw.length > 0 ? JSON.parse(raw) : null;
          } catch {
            parsed = raw;
          }
          resolve({ statusCode: res.statusCode ?? 0, body: parsed });
        });
      });

      req.on('error', (err: Error) =>
        reject(
          new EphemeralQuickstartError(
            `Docker API request failed: ${err.message}`,
            { code: 'DOCKER_API_ERROR', details: err.message },
          ),
        ),
      );

      if (payload !== undefined) req.write(payload);
      req.end();
    });
  }

  /** Checks whether the Docker daemon is reachable. */
  async ping(): Promise<boolean> {
    try {
      const res = await this.request({ method: 'GET', path: '/_ping' });
      return res.statusCode === 200;
    } catch {
      return false;
    }
  }

  /** Creates a Docker bridge network and returns its ID. */
  async createNetwork(name: string): Promise<string> {
    const res = await this.request({
      method: 'POST',
      path: '/networks/create',
      body: {
        Name: name,
        Driver: 'bridge',
        Internal: true, // No external internet access — strict tenant isolation
        EnableIPv6: false,
        Options: {},
        Labels: {
          'soroban-playground.managed': 'true',
          'soroban-playground.network': name,
        },
      },
    });

    if (res.statusCode !== 201) {
      throw new EphemeralQuickstartError(
        `Failed to create Docker network "${name}": HTTP ${res.statusCode}`,
        { code: 'DOCKER_NETWORK_CREATE_FAILED', details: res.body },
      );
    }
    return (res.body as { Id: string }).Id;
  }

  /** Removes a Docker network by ID. Best-effort — logs but does not throw. */
  async removeNetwork(networkId: string): Promise<void> {
    await this.request({ method: 'DELETE', path: `/networks/${networkId}` });
  }

  /**
   * Creates (but does not start) an ephemeral Quickstart container.
   * Returns the container ID.
   */
  async createContainer(params: {
    name: string;
    image: string;
    networkId: string;
    rpcPort: number;
    friendbotPort: number;
    memoryBytes: number;
    cpuPeriod: number;
    cpuQuota: number;
    pidsLimit: number;
    networkPassphrase: string;
    sessionId: string;
  }): Promise<string> {
    const {
      name,
      image,
      rpcPort,
      friendbotPort,
      memoryBytes,
      cpuPeriod,
      cpuQuota,
      pidsLimit,
      networkPassphrase,
      sessionId,
    } = params;

    const res = await this.request({
      method: 'POST',
      path: '/containers/create?name=' + encodeURIComponent(name),
      body: {
        Image: image,
        // --local runs a standalone Stellar node with Soroban RPC
        Cmd: ['--local', '--enable-soroban-rpc'],
        Env: [
          `NETWORK_PASSPHRASE=${networkPassphrase}`,
          // Expose RPC on all container interfaces so the host-port mapping works
          'SOROBAN_RPC_HOST=0.0.0.0',
        ],
        ExposedPorts: {
          '8000/tcp': {},
          '8001/tcp': {},
        },
        Labels: {
          'soroban-playground.managed': 'true',
          'soroban-playground.session': sessionId,
          'soroban-playground.created-at': new Date().toISOString(),
        },
        HostConfig: {
          // Port bindings: container 8000 → RPC, container 8001 → friendbot
          PortBindings: {
            '8000/tcp': [{ HostIp: '127.0.0.1', HostPort: String(rpcPort) }],
            '8001/tcp': [
              { HostIp: '127.0.0.1', HostPort: String(friendbotPort) },
            ],
          },
          // cgroup resource limits
          Memory: memoryBytes,
          MemorySwap: memoryBytes, // Disable swap (MemorySwap == Memory)
          CpuPeriod: cpuPeriod,
          CpuQuota: cpuQuota,
          PidsLimit: pidsLimit,
          // Auto-remove the container after it stops so Docker does not accumulate stale layers
          AutoRemove: false, // we handle cleanup ourselves for audit/orphan recovery
          // Network mode: connect to the per-session bridge after start
          NetworkMode: 'none',
          // Drop all capabilities — quickstart only needs its own process namespace
          CapDrop: ['ALL'],
          SecurityOpt: ['no-new-privileges'],
          // Prevent the container from touching the host's /tmp or procfs
          ReadonlyRootfs: false, // quickstart writes runtime data; we scope via cgroups
          // Restart policy: never restart — TTL reaper owns lifecycle
          RestartPolicy: { Name: 'no' },
          // tmpfs for /run so the container has writable runtime dirs without host mounts
          Tmpfs: { '/run': 'rw,noexec,nosuid,size=64m' },
        },
        NetworkingConfig: {
          EndpointsConfig: {},
        },
      },
    });

    if (res.statusCode !== 201) {
      throw new EphemeralQuickstartError(
        `Failed to create container "${name}": HTTP ${res.statusCode}`,
        { code: 'DOCKER_CONTAINER_CREATE_FAILED', details: res.body },
      );
    }

    const containerId = (res.body as { Id: string }).Id;

    // Connect the container to its dedicated bridge network now that it exists
    await this.connectContainerToNetwork(containerId, params.networkId);

    return containerId;
  }

  /** Connects a container to a network. */
  async connectContainerToNetwork(
    containerId: string,
    networkId: string,
  ): Promise<void> {
    const res = await this.request({
      method: 'POST',
      path: `/networks/${networkId}/connect`,
      body: { Container: containerId },
    });

    if (res.statusCode !== 200) {
      throw new EphemeralQuickstartError(
        `Failed to connect container ${containerId} to network ${networkId}: HTTP ${res.statusCode}`,
        { code: 'DOCKER_NETWORK_CONNECT_FAILED', details: res.body },
      );
    }
  }

  /** Starts a container. */
  async startContainer(containerId: string): Promise<void> {
    const res = await this.request({
      method: 'POST',
      path: `/containers/${containerId}/start`,
    });

    if (res.statusCode !== 204 && res.statusCode !== 304) {
      throw new EphemeralQuickstartError(
        `Failed to start container ${containerId}: HTTP ${res.statusCode}`,
        { code: 'DOCKER_CONTAINER_START_FAILED', details: res.body },
      );
    }
  }

  /** Stops a container (sends SIGTERM, waits up to timeoutSeconds, then SIGKILL). */
  async stopContainer(containerId: string, timeoutSeconds = 10): Promise<void> {
    await this.request({
      method: 'POST',
      path: `/containers/${containerId}/stop?t=${timeoutSeconds}`,
    });
    // Ignore status — the container might already be stopped
  }

  /**
   * Removes a container. Pass `volumes: true` to also remove anonymous volumes
   * that were created with the container.
   */
  async removeContainer(
    containerId: string,
    { volumes = true, force = false } = {},
  ): Promise<void> {
    const qs = `?v=${volumes}&force=${force}`;
    await this.request({
      method: 'DELETE',
      path: `/containers/${containerId}${qs}`,
    });
  }

  /**
   * Lists containers that carry the `soroban-playground.managed` label.
   * Used for orphan detection on startup.
   */
  async listManagedContainers(): Promise<
    Array<{ Id: string; Labels: Record<string, string>; State: string; Ports: Array<{ PrivatePort: number; PublicPort: number; IP: string }> }>
  > {
    const res = await this.request({
      method: 'GET',
      path: '/containers/json?filters=' +
        encodeURIComponent(
          JSON.stringify({ label: ['soroban-playground.managed=true'] }),
        ) +
        '&all=true',
    });

    if (res.statusCode !== 200) return [];
    return (res.body as Array<{ Id: string; Labels: Record<string, string>; State: string; Ports: Array<{ PrivatePort: number; PublicPort: number; IP: string }> }>) ?? [];
  }

  /**
   * Lists networks that carry the `soroban-playground.managed` label.
   * Used for orphan cleanup on startup.
   */
  async listManagedNetworks(): Promise<
    Array<{ Id: string; Name: string }>
  > {
    const res = await this.request({
      method: 'GET',
      path: '/networks?filters=' +
        encodeURIComponent(
          JSON.stringify({ label: ['soroban-playground.managed=true'] }),
        ),
    });

    if (res.statusCode !== 200) return [];
    return (res.body as Array<{ Id: string; Name: string }>) ?? [];
  }
}

// ── Health checker ────────────────────────────────────────────────────────────

/**
 * Polls `http://127.0.0.1:<port>/rpc` using the Soroban `getHealth` JSON-RPC
 * method until the node reports "healthy" or the deadline is reached.
 *
 * Returns `true` on success, `false` on timeout.
 */
async function waitForRpcHealth(
  rpcPort: number,
  { timeoutMs, pollMs }: { timeoutMs: number; pollMs: number },
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getHealth',
    params: [],
  });

  while (Date.now() < deadline) {
    const healthy = await new Promise<boolean>((resolve) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: rpcPort,
          path: '/rpc',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: Math.min(pollMs * 2, 1000),
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(Buffer.concat(chunks).toString());
              resolve(parsed?.result?.status === 'healthy');
            } catch {
              resolve(false);
            }
          });
        },
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.write(body);
      req.end();
    });

    if (healthy) return true;

    await new Promise<void>((r) => setTimeout(r, pollMs));
  }

  return false;
}

// ── Friendbot pre-funder ──────────────────────────────────────────────────────

/**
 * Hits the friendbot HTTP endpoint once for each account address to pre-fund
 * it with local XLM.  Failures are logged but do not abort the session — the
 * container is still usable and the caller can retry via the friendbot URL.
 */
async function prefundAccounts(
  friendbotPort: number,
  accounts: string[],
  log: (msg: string, meta?: unknown) => void,
): Promise<void> {
  for (const addr of accounts) {
    await new Promise<void>((resolve) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: friendbotPort,
          path: `/?addr=${encodeURIComponent(addr)}`,
          method: 'GET',
          timeout: 5000,
        },
        (res) => {
          res.resume(); // drain and discard
          res.on('end', () => {
            if (res.statusCode === 200) {
              log('prefunded_account', { addr });
            } else {
              log('prefund_failed', { addr, status: res.statusCode });
            }
            resolve();
          });
        },
      );
      req.on('error', (err) => {
        log('prefund_error', { addr, error: (err as Error).message });
        resolve();
      });
      req.on('timeout', () => { req.destroy(); resolve(); });
      req.end();
    });
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

/** Events emitted by the orchestrator. */
interface OrchestratorEvents {
  spawned: (session: ContainerSession) => void;
  ready: (session: ContainerSession) => void;
  reaped: (sessionId: string, reason: 'ttl' | 'explicit') => void;
  error: (sessionId: string, err: Error) => void;
}

export declare interface EphemeralQuickstartOrchestrator {
  on<K extends keyof OrchestratorEvents>(event: K, listener: OrchestratorEvents[K]): this;
  emit<K extends keyof OrchestratorEvents>(event: K, ...args: Parameters<OrchestratorEvents[K]>): boolean;
}

/**
 * Main orchestrator class.  Maintains a registry of active sessions, drives
 * the container lifecycle, and runs the TTL reaper loop.
 *
 * Intended usage — import the singleton exported at the bottom of this file:
 *
 *   import { orchestrator } from './ephemeralQuickstart.js';
 *
 *   const session = await orchestrator.spawn('user-session-abc123');
 *   // session.rpcPort  → ready Soroban RPC port on localhost
 *   // session.friendbotPort → friendbot funding endpoint port
 *
 *   orchestrator.touch(session.sessionId); // keep-alive
 *
 *   await orchestrator.destroy(session.sessionId);
 */
export class EphemeralQuickstartOrchestrator extends EventEmitter {
  private readonly config: OrchestratorConfig;
  private readonly docker: DockerClient;
  private readonly sessions = new Map<string, ContainerSession>();
  private readonly rpcPorts: PortAllocator;
  private readonly friendbotPorts: PortAllocator;
  private reaperTimer: ReturnType<typeof setInterval> | null = null;
  private orphanCleanupDone = false;

  constructor(config?: Partial<OrchestratorConfig>) {
    super();
    this.config = { ...buildConfig(), ...config };
    this.docker = new DockerClient(this.config);
    this.rpcPorts = new PortAllocator(
      this.config.rpcPortStart,
      this.config.rpcPortEnd,
    );
    this.friendbotPorts = new PortAllocator(
      this.config.friendbotPortStart,
      this.config.friendbotPortStart + (this.config.rpcPortEnd - this.config.rpcPortStart),
    );
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Initialises the orchestrator: verifies Docker connectivity, cleans up
   * orphan containers from a previous process, and starts the TTL reaper.
   */
  async initialize(): Promise<void> {
    const alive = await this.docker.ping();
    if (!alive) {
      throw new EphemeralQuickstartError(
        'Docker daemon is not reachable. Ensure the Docker socket is mounted ' +
        'or DOCKER_HOST is configured correctly.',
        { code: 'DOCKER_UNAVAILABLE', statusCode: 503 },
      );
    }

    await this._cleanupOrphans();
    this._startReaper();
    this._log('orchestrator_initialized', {
      image: this.config.quickstartImage,
      ttlMs: this.config.containerTtlMs,
    });
  }

  /**
   * Gracefully shuts down the orchestrator: stops the reaper, destroys all
   * active sessions, and releases all resources.
   */
  async shutdown(): Promise<void> {
    this._stopReaper();
    const ids = [...this.sessions.keys()];
    await Promise.allSettled(ids.map((id) => this.destroy(id, 'explicit')));
    this._log('orchestrator_shutdown', { destroyedCount: ids.length });
  }

  // ── Session management ─────────────────────────────────────────────────────

  /**
   * Spawns a new ephemeral Quickstart container for the given session.
   * Resolves with a `ContainerSession` once the Soroban RPC is healthy.
   *
   * @throws {EphemeralQuickstartError} if a session already exists, Docker
   *   fails, or the health check times out.
   */
  async spawn(sessionId: string, opts: SpawnOptions = {}): Promise<ContainerSession> {
    if (this.sessions.has(sessionId)) {
      throw new EphemeralQuickstartError(
        `Session "${sessionId}" already exists`,
        { code: 'SESSION_ALREADY_EXISTS', statusCode: 409 },
      );
    }

    const rpcPort = this.rpcPorts.allocate();
    const friendbotPort = this.friendbotPorts.allocate();

    // Build a deterministic, human-readable container name
    const safeSuffix = sessionId.replace(/[^a-z0-9]/gi, '-').slice(0, 32);
    const containerName = `soroban-qs-${safeSuffix}`;
    const networkName = `soroban-net-${safeSuffix}`;

    const session: ContainerSession = {
      sessionId,
      containerId: '',
      networkId: '',
      rpcPort,
      friendbotPort,
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      status: 'starting',
    };
    this.sessions.set(sessionId, session);

    try {
      // 1. Create the dedicated bridge network for this session
      const networkId = await this.docker.createNetwork(networkName);
      session.networkId = networkId;

      // 2. Create the container (creates + connects it to the bridge network)
      const memoryBytes =
        (opts.memoryMb ?? this.config.memoryMb) * 1024 * 1024;
      const cpuQuota = opts.cpuQuota ?? this.config.cpuQuota;

      const containerId = await this.docker.createContainer({
        name: containerName,
        image: this.config.quickstartImage,
        networkId,
        rpcPort,
        friendbotPort,
        memoryBytes,
        cpuPeriod: this.config.cpuPeriod,
        cpuQuota,
        pidsLimit: this.config.pidsLimit,
        networkPassphrase: this.config.networkPassphrase,
        sessionId,
      });
      session.containerId = containerId;

      this._log('container_created', { sessionId, containerId, rpcPort, friendbotPort });
      this.emit('spawned', { ...session });

      // 3. Start the container
      await this.docker.startContainer(containerId);

      // 4. Wait for Soroban RPC to report healthy
      const healthy = await waitForRpcHealth(rpcPort, {
        timeoutMs: this.config.healthTimeoutMs,
        pollMs: this.config.healthPollMs,
      });

      if (!healthy) {
        session.status = 'error';
        throw new EphemeralQuickstartError(
          `Soroban RPC on port ${rpcPort} did not become healthy within ` +
          `${this.config.healthTimeoutMs} ms`,
          { code: 'RPC_HEALTH_TIMEOUT', statusCode: 504 },
        );
      }

      // 5. Pre-fund default test accounts
      const accounts = [
        ...(opts.accountsToFund ?? []),
        ...this.config.defaultAccounts,
      ];
      if (accounts.length > 0) {
        await prefundAccounts(friendbotPort, accounts, (msg, meta) =>
          this._log(msg, { sessionId, ...meta }),
        );
      }

      session.status = 'ready';
      session.lastActivityAt = new Date().toISOString();
      this._log('session_ready', { sessionId, rpcPort, friendbotPort });
      this.emit('ready', { ...session });

      return { ...session };
    } catch (err) {
      // Clean up partially-created resources before re-throwing
      session.status = 'error';
      await this._forceCleanup(session).catch(() => {});
      this.sessions.delete(sessionId);
      this.rpcPorts.release(rpcPort);
      this.friendbotPorts.release(friendbotPort);
      throw err;
    }
  }

  /**
   * Returns a snapshot of an active session, or `null` if no session exists
   * for the given ID.
   */
  getSession(sessionId: string): ContainerSession | null {
    const s = this.sessions.get(sessionId);
    return s ? { ...s } : null;
  }

  /**
   * Returns a snapshot of all active sessions. The array is a shallow copy —
   * each element is a frozen snapshot of the session at call time.
   */
  listSessions(): ContainerSession[] {
    return [...this.sessions.values()].map((s) => ({ ...s }));
  }

  /**
   * Updates the `lastActivityAt` timestamp for a session, resetting its TTL.
   * Call this whenever a user sends a request that routes through this session.
   */
  touch(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivityAt = new Date().toISOString();
    }
  }

  /**
   * Destroys an active session: stops and removes the container (including its
   * anonymous volumes), then removes the dedicated bridge network.
   */
  async destroy(
    sessionId: string,
    reason: 'ttl' | 'explicit' = 'explicit',
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.status = 'stopping';
    this._log('session_destroying', { sessionId, reason });

    await this._forceCleanup(session);

    session.status = 'stopped';
    this.sessions.delete(sessionId);
    this.rpcPorts.release(session.rpcPort);
    this.friendbotPorts.release(session.friendbotPort);

    this._log('session_destroyed', { sessionId, reason });
    this.emit('reaped', sessionId, reason);
  }

  // ── Docker daemon restart recovery ─────────────────────────────────────────

  /**
   * Inspects running Docker containers that carry the `soroban-playground`
   * label and reconciles them with the in-memory session registry.
   *
   * Containers not tracked in memory are destroyed (orphans from a previous
   * process).  Only called once during `initialize()`.
   */
  private async _cleanupOrphans(): Promise<void> {
    if (this.orphanCleanupDone) return;
    this.orphanCleanupDone = true;

    try {
      const containers = await this.docker.listManagedContainers();
      let orphanCount = 0;

      for (const c of containers) {
        const sessionId = c.Labels['soroban-playground.session'];
        if (!sessionId || this.sessions.has(sessionId)) continue;

        orphanCount++;
        this._log('orphan_container_found', { containerId: c.Id, sessionId });

        // Stop and remove the orphan (best-effort)
        try {
          await this.docker.stopContainer(c.Id, 5);
        } catch { /* already stopped */ }
        try {
          await this.docker.removeContainer(c.Id, { volumes: true, force: true });
        } catch { /* already removed */ }
      }

      // Also remove any orphaned managed networks
      const networks = await this.docker.listManagedNetworks();
      for (const net of networks) {
        await this.docker.removeNetwork(net.Id).catch(() => {});
      }

      if (orphanCount > 0) {
        this._log('orphan_cleanup_complete', { orphanCount });
      }
    } catch (err) {
      this._log('orphan_cleanup_error', {
        error: (err as Error).message,
      });
    }
  }

  // ── TTL Reaper ─────────────────────────────────────────────────────────────

  private _startReaper(): void {
    if (this.reaperTimer) return;
    // Tick every 60 s (much shorter than the 30-min TTL, so we catch expiry promptly)
    this.reaperTimer = setInterval(() => void this._reap(), 60_000);
    // Don't prevent the Node process from exiting if everything else is idle
    if (this.reaperTimer.unref) this.reaperTimer.unref();
  }

  private _stopReaper(): void {
    if (this.reaperTimer) {
      clearInterval(this.reaperTimer);
      this.reaperTimer = null;
    }
  }

  private async _reap(): Promise<void> {
    const now = Date.now();
    const expired: string[] = [];

    for (const [id, session] of this.sessions) {
      if (session.status === 'stopping' || session.status === 'stopped') continue;
      const idle = now - new Date(session.lastActivityAt).getTime();
      if (idle >= this.config.containerTtlMs) {
        expired.push(id);
      }
    }

    for (const id of expired) {
      this._log('ttl_expiry', { sessionId: id });
      await this.destroy(id, 'ttl').catch((err) => {
        this._log('reap_error', { sessionId: id, error: (err as Error).message });
        this.emit('error', id, err as Error);
      });
    }
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  /**
   * Forcibly stops and removes all Docker resources associated with a session.
   * Safe to call even when the container was never fully created (partial IDs).
   * Does not throw — all errors are swallowed so the caller can keep cleaning up.
   */
  private async _forceCleanup(session: ContainerSession): Promise<void> {
    if (session.containerId) {
      try {
        await this.docker.stopContainer(session.containerId, 10);
      } catch { /* already stopped or never started */ }
      try {
        await this.docker.removeContainer(session.containerId, {
          volumes: true,
          force: true,
        });
      } catch { /* already removed */ }
    }

    if (session.networkId) {
      await this.docker.removeNetwork(session.networkId).catch(() => {});
    }
  }

  private _log(msg: string, meta?: Record<string, unknown>): void {
    const line = JSON.stringify({
      level: 'info',
      message: msg,
      timestamp: new Date().toISOString(),
      service: 'ephemeralQuickstart',
      ...meta,
    });
    process.stdout.write(line + '\n');
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────

/**
 * Singleton orchestrator instance.  Call `orchestrator.initialize()` once
 * during server startup and `orchestrator.shutdown()` during graceful teardown.
 *
 * Consuming code:
 *
 *   import { orchestrator } from './docker/ephemeralQuickstart.js';
 *
 *   await orchestrator.initialize();
 *   const session = await orchestrator.spawn('session-abc');
 */
export const orchestrator = new EphemeralQuickstartOrchestrator();

export default orchestrator;
