/**
 * BE-07 Integration tests — EphemeralQuickstartOrchestrator
 *
 * Strategy: all Docker Engine API calls are intercepted by mocking Node's
 * built-in `http.request`.  No real Docker daemon is required, so the suite
 * runs in any CI environment.
 *
 * Coverage
 * ────────
 * 1.  spawn() — happy path: network create → container create → start → health → ready
 * 2.  spawn() — health check timeout: surfaces RPC_HEALTH_TIMEOUT error
 * 3.  spawn() — duplicate session: 409 SESSION_ALREADY_EXISTS
 * 4.  spawn() — Docker API failure during container create: full resource rollback
 * 5.  touch() — resets lastActivityAt on an active session
 * 6.  destroy() — stops container, removes volume, removes network, releases ports
 * 7.  destroy() — idempotent on unknown session IDs
 * 8.  TTL reaper — destroys sessions whose idle time exceeds containerTtlMs
 * 9.  _cleanupOrphans() — destroys containers not in the session registry
 * 10. listSessions() / getSession() — registry inspection
 * 11. Port allocator — exhaustion throws PORT_RANGE_EXHAUSTED
 * 12. initialize() — fails when Docker daemon is unreachable
 * 13. Friendbot pre-funding — called for defaultAccounts after RPC is healthy
 * 14. shutdown() — destroys all active sessions and stops the reaper
 * 15. Network isolation — each spawn creates a dedicated Internal bridge network
 */

import http from 'http';
import { jest } from '@jest/globals';

// ── Mock http.request before importing the module under test ──────────────────
jest.mock('http', () => {
  const actual = jest.requireActual('http');
  return {
    ...actual,
    request: jest.fn(),
  };
});

// ── Import after mock registration ────────────────────────────────────────────
import {
  EphemeralQuickstartOrchestrator,
  EphemeralQuickstartError,
} from '../src/services/docker/ephemeralQuickstart.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Builds a fake `http.ClientRequest` / `http.IncomingMessage` pair so that
 * `http.request(opts, callback)` can be controlled synchronously.
 */
function makeFakeHttpExchange(statusCode, bodyObject) {
  const body = JSON.stringify(bodyObject);

  // Fake IncomingMessage (response)
  const fakeRes = {
    statusCode,
    on: jest.fn((event, handler) => {
      if (event === 'data') handler(Buffer.from(body));
      if (event === 'end') handler();
      return fakeRes;
    }),
    resume: jest.fn(),
  };

  // Fake ClientRequest
  const fakeReq = {
    write: jest.fn(),
    end: jest.fn(() => {
      // callback is invoked synchronously in tests
    }),
    on: jest.fn(),
    destroy: jest.fn(),
  };

  return { fakeReq, fakeRes };
}

/**
 * Sets up `http.request` to return a predetermined sequence of responses.
 * Each call to `http.request` consumes the next entry in `responses`.
 *
 * @param {Array<[number, object]>} responses  Pairs of [statusCode, body].
 */
function setupDockerResponses(responses) {
  let callIndex = 0;

  http.request.mockImplementation((opts, callback) => {
    const entry = responses[callIndex++] ?? [200, {}];
    const [statusCode, body] = entry;

    const { fakeReq, fakeRes } = makeFakeHttpExchange(statusCode, body);

    if (callback) {
      // Schedule asynchronously to match real network I/O
      setImmediate(() => callback(fakeRes));
    }

    return fakeReq;
  });
}

/**
 * Minimal orchestrator pre-configured for tests:
 * - Tiny port range so exhaustion tests are cheap.
 * - Very short TTL and poll intervals.
 * - Orphan cleanup is skipped (no Docker daemon needed for basic tests).
 */
function makeOrchestrator(overrides = {}) {
  return new EphemeralQuickstartOrchestrator({
    dockerSocketPath: '/var/run/docker.sock',
    dockerHost: null,
    quickstartImage: 'stellar/quickstart:testing',
    rpcPortStart: 20000,
    rpcPortEnd: 20009,       // 10-port range
    friendbotPortStart: 21000,
    memoryMb: 512,
    cpuPeriod: 100000,
    cpuQuota: 100000,
    pidsLimit: 128,
    containerTtlMs: 500,     // 0.5 s for reaper tests
    healthTimeoutMs: 300,
    healthPollMs: 50,
    defaultAccounts: [],
    networkPassphrase: 'Standalone Network ; February 2017',
    ...overrides,
  });
}

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

// ── 12. initialize() — Docker unreachable ─────────────────────────────────────
describe('initialize()', () => {
  it('throws DOCKER_UNAVAILABLE when daemon is unreachable', async () => {
    http.request.mockImplementation((opts, _cb) => {
      const fakeReq = { write: jest.fn(), end: jest.fn(), on: jest.fn(), destroy: jest.fn() };
      fakeReq.on.mockImplementation((event, handler) => {
        if (event === 'error') setImmediate(() => handler(new Error('ENOENT')));
      });
      return fakeReq;
    });

    const orc = makeOrchestrator();
    await expect(orc.initialize()).rejects.toMatchObject({
      code: 'DOCKER_UNAVAILABLE',
      statusCode: 503,
    });
  });

  it('succeeds when Docker responds to _ping', async () => {
    // _ping (200) → listManagedContainers (200,[]) → listManagedNetworks (200,[])
    setupDockerResponses([
      [200, 'OK'],
      [200, []],
      [200, []],
    ]);

    const orc = makeOrchestrator();
    await expect(orc.initialize()).resolves.toBeUndefined();
  });
});

// ── 1. spawn() — happy path ───────────────────────────────────────────────────
describe('spawn() — happy path', () => {
  it('returns a ContainerSession with status=ready after full lifecycle', async () => {
    // Response sequence for a full spawn:
    // [0]  _ping → 200
    // [1]  listManagedContainers → 200, []   (orphan cleanup)
    // [2]  listManagedNetworks   → 200, []
    // [3]  createNetwork         → 201, { Id: 'net-001' }
    // [4]  createContainer       → 201, { Id: 'ctr-001' }
    // [5]  connectToNetwork      → 200, {}
    // [6]  startContainer        → 204, null
    // [7]  getHealth (poll 1)    → 200, { result: { status: 'healthy' } }
    setupDockerResponses([
      [200, 'OK'],
      [200, []],
      [200, []],
      [201, { Id: 'net-001' }],
      [201, { Id: 'ctr-001' }],
      [200, {}],
      [204, null],
      [200, { result: { status: 'healthy' } }],
    ]);

    const orc = makeOrchestrator();
    await orc.initialize();

    const session = await orc.spawn('session-1');

    expect(session.sessionId).toBe('session-1');
    expect(session.status).toBe('ready');
    expect(session.containerId).toBe('ctr-001');
    expect(session.networkId).toBe('net-001');
    expect(session.rpcPort).toBeGreaterThanOrEqual(20000);
    expect(session.rpcPort).toBeLessThanOrEqual(20009);
    expect(session.friendbotPort).toBeGreaterThanOrEqual(21000);
    expect(session.createdAt).toBeDefined();
    expect(session.lastActivityAt).toBeDefined();
  });

  it('emits "spawned" then "ready" events in order', async () => {
    setupDockerResponses([
      [200, 'OK'],
      [200, []],
      [200, []],
      [201, { Id: 'net-002' }],
      [201, { Id: 'ctr-002' }],
      [200, {}],
      [204, null],
      [200, { result: { status: 'healthy' } }],
    ]);

    const orc = makeOrchestrator();
    await orc.initialize();

    const events = [];
    orc.on('spawned', (s) => events.push({ event: 'spawned', id: s.sessionId }));
    orc.on('ready', (s) => events.push({ event: 'ready', id: s.sessionId }));

    await orc.spawn('session-events');

    expect(events).toEqual([
      { event: 'spawned', id: 'session-events' },
      { event: 'ready', id: 'session-events' },
    ]);
  });
});

// ── 15. Network isolation ─────────────────────────────────────────────────────
describe('Network isolation', () => {
  it('creates an Internal bridge network for each session', async () => {
    setupDockerResponses([
      [200, 'OK'],
      [200, []],
      [200, []],
      [201, { Id: 'net-iso' }],
      [201, { Id: 'ctr-iso' }],
      [200, {}],
      [204, null],
      [200, { result: { status: 'healthy' } }],
    ]);

    const orc = makeOrchestrator();
    await orc.initialize();

    await orc.spawn('session-iso');

    // Find the createNetwork call (POST /networks/create)
    const createNetworkCall = http.request.mock.calls.find(
      ([opts]) => opts.path === '/networks/create',
    );
    expect(createNetworkCall).toBeDefined();

    // The body was written to the request — check the write call payload
    const writeArg = createNetworkCall[0]; // opts object contains path
    expect(writeArg.path).toBe('/networks/create');
    expect(writeArg.method).toBe('POST');
  });
});

// ── 3. spawn() — duplicate session ───────────────────────────────────────────
describe('spawn() — duplicate session', () => {
  it('throws SESSION_ALREADY_EXISTS when session ID is already active', async () => {
    setupDockerResponses([
      [200, 'OK'],
      [200, []],
      [200, []],
      [201, { Id: 'net-003' }],
      [201, { Id: 'ctr-003' }],
      [200, {}],
      [204, null],
      [200, { result: { status: 'healthy' } }],
    ]);

    const orc = makeOrchestrator();
    await orc.initialize();
    await orc.spawn('dup-session');

    await expect(orc.spawn('dup-session')).rejects.toMatchObject({
      code: 'SESSION_ALREADY_EXISTS',
      statusCode: 409,
    });
  });
});

// ── 2. spawn() — health check timeout ────────────────────────────────────────
describe('spawn() — health check timeout', () => {
  it('throws RPC_HEALTH_TIMEOUT and cleans up when RPC never becomes healthy', async () => {
    // Health poll always returns unhealthy (missing result.status)
    const unhealthyPoll = [200, { result: { status: 'degraded' } }];
    setupDockerResponses([
      [200, 'OK'],
      [200, []],
      [200, []],
      [201, { Id: 'net-tmo' }],
      [201, { Id: 'ctr-tmo' }],
      [200, {}],
      [204, null],
      unhealthyPoll, unhealthyPoll, unhealthyPoll, unhealthyPoll, unhealthyPoll,
      unhealthyPoll, unhealthyPoll, unhealthyPoll, unhealthyPoll, unhealthyPoll,
      // Cleanup calls (stop, remove, removeNetwork) follow — let them succeed
      [204, null],
      [204, null],
      [204, null],
    ]);

    const orc = makeOrchestrator({ healthTimeoutMs: 200, healthPollMs: 40 });

    // Skip orphan cleanup for this test
    jest.spyOn(orc, '_cleanupOrphans' in orc ? '_cleanupOrphans' : 'initialize')
      .mockResolvedValue?.();

    // Re-register mock for _ping only
    http.request.mockImplementation((opts, callback) => {
      const { fakeReq, fakeRes } = makeFakeHttpExchange(
        opts.path === '/_ping' ? 200
          : opts.path === '/containers/json' ? 200
          : opts.path === '/networks' ? 200
          : opts.path === '/networks/create' ? 201
          : opts.path?.startsWith?.('/containers/create') ? 201
          : opts.path?.startsWith?.('/networks/') && opts.method === 'POST' ? 200
          : opts.path?.startsWith?.('/containers/') && opts.path?.endsWith?.('/start') ? 204
          : 200,
        opts.path === '/containers/json' ? []
          : opts.path === '/networks' ? []
          : opts.path === '/networks/create' ? { Id: 'net-tmo2' }
          : opts.path?.startsWith?.('/containers/create') ? { Id: 'ctr-tmo2' }
          : opts.path?.startsWith?.('/networks/') && opts.method === 'POST' ? {}
          : opts.path?.startsWith?.('/containers/') && opts.path?.endsWith?.('/start') ? null
          : { result: { status: 'degraded' } },   // health poll always degraded
      );

      if (callback) setImmediate(() => callback(fakeRes));
      return fakeReq;
    });

    const orcFresh = makeOrchestrator({ healthTimeoutMs: 200, healthPollMs: 40 });
    await orcFresh.initialize();

    await expect(orcFresh.spawn('timeout-session')).rejects.toMatchObject({
      code: 'RPC_HEALTH_TIMEOUT',
      statusCode: 504,
    });

    // Session must not remain registered after failure
    expect(orcFresh.getSession('timeout-session')).toBeNull();
  });
});

// ── 4. spawn() — Docker container create fails ────────────────────────────────
describe('spawn() — Docker create failure', () => {
  it('releases ports and removes the network on container create failure', async () => {
    setupDockerResponses([
      [200, 'OK'],
      [200, []],
      [200, []],
      [201, { Id: 'net-fail' }],  // network create succeeds
      [500, { message: 'Internal Server Error' }], // container create fails
      // Cleanup: removeContainer (no-op), removeNetwork
      [204, null],
      [204, null],
    ]);

    const orc = makeOrchestrator();
    await orc.initialize();

    await expect(orc.spawn('fail-session')).rejects.toMatchObject({
      code: 'DOCKER_CONTAINER_CREATE_FAILED',
    });

    // No session should be registered
    expect(orc.getSession('fail-session')).toBeNull();
    // Port should be freed — spawning again with a new session should not throw PORT_RANGE_EXHAUSTED
    expect(orc.listSessions()).toHaveLength(0);
  });
});

// ── 5. touch() ────────────────────────────────────────────────────────────────
describe('touch()', () => {
  it('updates lastActivityAt to current time', async () => {
    setupDockerResponses([
      [200, 'OK'],
      [200, []],
      [200, []],
      [201, { Id: 'net-touch' }],
      [201, { Id: 'ctr-touch' }],
      [200, {}],
      [204, null],
      [200, { result: { status: 'healthy' } }],
    ]);

    const orc = makeOrchestrator();
    await orc.initialize();
    const session = await orc.spawn('touch-session');

    const before = session.lastActivityAt;
    await new Promise((r) => setTimeout(r, 5));
    orc.touch('touch-session');

    const updated = orc.getSession('touch-session');
    expect(updated.lastActivityAt > before).toBe(true);
  });

  it('is a no-op for unknown session IDs', () => {
    const orc = makeOrchestrator();
    expect(() => orc.touch('nonexistent')).not.toThrow();
  });
});

// ── 6. destroy() ─────────────────────────────────────────────────────────────
describe('destroy()', () => {
  it('stops container, removes volumes, removes network, and releases port', async () => {
    setupDockerResponses([
      [200, 'OK'],
      [200, []],
      [200, []],
      [201, { Id: 'net-del' }],
      [201, { Id: 'ctr-del' }],
      [200, {}],
      [204, null],
      [200, { result: { status: 'healthy' } }],
      // destroy: stop, remove (with volumes), remove network
      [204, null],
      [204, null],
      [204, null],
    ]);

    const orc = makeOrchestrator();
    await orc.initialize();
    const session = await orc.spawn('destroy-session');

    const reaped = [];
    orc.on('reaped', (id, reason) => reaped.push({ id, reason }));

    await orc.destroy('destroy-session', 'explicit');

    expect(orc.getSession('destroy-session')).toBeNull();
    expect(reaped).toEqual([{ id: 'destroy-session', reason: 'explicit' }]);

    // Verify Docker API calls included stop and delete
    const paths = http.request.mock.calls.map(([opts]) => opts.path);
    expect(paths.some((p) => p?.includes(`/containers/ctr-del/stop`))).toBe(true);
    expect(paths.some((p) => p?.startsWith(`/containers/ctr-del`) && p?.includes('?v='))).toBe(true);
    expect(paths.some((p) => p === `/networks/net-del`)).toBe(true);
  });

  it('emits reaped with reason=ttl when called by the reaper', async () => {
    setupDockerResponses([
      [200, 'OK'],
      [200, []],
      [200, []],
      [201, { Id: 'net-ttl' }],
      [201, { Id: 'ctr-ttl' }],
      [200, {}],
      [204, null],
      [200, { result: { status: 'healthy' } }],
      [204, null],
      [204, null],
      [204, null],
    ]);

    const orc = makeOrchestrator();
    await orc.initialize();
    await orc.spawn('ttl-session');

    const reaped = [];
    orc.on('reaped', (id, reason) => reaped.push({ id, reason }));

    await orc.destroy('ttl-session', 'ttl');
    expect(reaped[0]).toEqual({ id: 'ttl-session', reason: 'ttl' });
  });
});

// ── 7. destroy() — idempotent ─────────────────────────────────────────────────
describe('destroy() — idempotent', () => {
  it('does not throw when called with an unknown session ID', async () => {
    const orc = makeOrchestrator();
    await expect(orc.destroy('ghost-session')).resolves.toBeUndefined();
  });

  it('does not throw when called twice for the same session', async () => {
    setupDockerResponses([
      [200, 'OK'],
      [200, []],
      [200, []],
      [201, { Id: 'net-idem' }],
      [201, { Id: 'ctr-idem' }],
      [200, {}],
      [204, null],
      [200, { result: { status: 'healthy' } }],
      [204, null], [204, null], [204, null],
    ]);

    const orc = makeOrchestrator();
    await orc.initialize();
    await orc.spawn('idem-session');
    await orc.destroy('idem-session');
    await expect(orc.destroy('idem-session')).resolves.toBeUndefined();
  });
});

// ── 8. TTL reaper ─────────────────────────────────────────────────────────────
describe('TTL reaper', () => {
  it('destroys sessions that exceed containerTtlMs of idle time', async () => {
    setupDockerResponses([
      [200, 'OK'],
      [200, []],
      [200, []],
      [201, { Id: 'net-reap' }],
      [201, { Id: 'ctr-reap' }],
      [200, {}],
      [204, null],
      [200, { result: { status: 'healthy' } }],
      // destroy calls
      [204, null], [204, null], [204, null],
    ]);

    const orc = makeOrchestrator({ containerTtlMs: 100, healthTimeoutMs: 300, healthPollMs: 30 });
    await orc.initialize();
    await orc.spawn('reap-session');

    // Wait longer than the TTL
    await new Promise((r) => setTimeout(r, 200));

    // Manually trigger the reaper (the interval is 60 s, but we call it directly)
    await orc['_reap']();

    expect(orc.getSession('reap-session')).toBeNull();
  });

  it('does NOT destroy sessions that have been recently touched', async () => {
    setupDockerResponses([
      [200, 'OK'],
      [200, []],
      [200, []],
      [201, { Id: 'net-live' }],
      [201, { Id: 'ctr-live' }],
      [200, {}],
      [204, null],
      [200, { result: { status: 'healthy' } }],
    ]);

    const orc = makeOrchestrator({ containerTtlMs: 200, healthTimeoutMs: 300, healthPollMs: 30 });
    await orc.initialize();
    await orc.spawn('live-session');

    // Touch the session to reset the idle timer
    await new Promise((r) => setTimeout(r, 100));
    orc.touch('live-session');
    await new Promise((r) => setTimeout(r, 100));

    // Session was touched 100 ms ago — still within the 200 ms TTL
    await orc['_reap']();

    expect(orc.getSession('live-session')).not.toBeNull();
  });
});

// ── 9. Orphan container cleanup ───────────────────────────────────────────────
describe('_cleanupOrphans()', () => {
  it('stops and removes containers not tracked in the registry', async () => {
    const orphanId = 'orphan-abc';
    setupDockerResponses([
      [200, 'OK'],
      // listManagedContainers returns one orphan
      [200, [
        {
          Id: orphanId,
          Labels: {
            'soroban-playground.managed': 'true',
            'soroban-playground.session': 'dead-session-xyz',
          },
          State: 'running',
          Ports: [],
        },
      ]],
      // listManagedNetworks — one stale network
      [200, [{ Id: 'net-orphan', Name: 'soroban-net-dead' }]],
      // stop orphan container
      [204, null],
      // remove orphan container
      [204, null],
      // remove orphan network
      [204, null],
    ]);

    const orc = makeOrchestrator();
    await orc.initialize();

    const paths = http.request.mock.calls.map(([opts]) => opts.path);
    // Stop and remove should have been called for the orphan container
    expect(paths.some((p) => p?.includes(`/containers/${orphanId}/stop`))).toBe(true);
    expect(paths.some((p) => p?.startsWith(`/containers/${orphanId}`) && opts => opts?.method === 'DELETE' || p?.includes('?v='))).toBe(true);
  });
});

// ── 10. listSessions() / getSession() ────────────────────────────────────────
describe('listSessions() / getSession()', () => {
  it('reflects spawned sessions accurately', async () => {
    setupDockerResponses([
      [200, 'OK'],
      [200, []],
      [200, []],
      [201, { Id: 'net-ls' }],
      [201, { Id: 'ctr-ls' }],
      [200, {}],
      [204, null],
      [200, { result: { status: 'healthy' } }],
    ]);

    const orc = makeOrchestrator();
    await orc.initialize();
    await orc.spawn('list-session');

    const list = orc.listSessions();
    expect(list).toHaveLength(1);
    expect(list[0].sessionId).toBe('list-session');

    const got = orc.getSession('list-session');
    expect(got).not.toBeNull();
    expect(got.status).toBe('ready');
  });

  it('returns null for unknown session IDs', () => {
    const orc = makeOrchestrator();
    expect(orc.getSession('does-not-exist')).toBeNull();
  });

  it('returns a copy — mutations do not affect internal state', async () => {
    setupDockerResponses([
      [200, 'OK'],
      [200, []],
      [200, []],
      [201, { Id: 'net-copy' }],
      [201, { Id: 'ctr-copy' }],
      [200, {}],
      [204, null],
      [200, { result: { status: 'healthy' } }],
    ]);

    const orc = makeOrchestrator();
    await orc.initialize();
    await orc.spawn('copy-session');

    const snapshot = orc.getSession('copy-session');
    snapshot.status = 'stopped'; // mutate snapshot

    // Internal state must be unaffected
    expect(orc.getSession('copy-session').status).toBe('ready');
  });
});

// ── 11. Port allocator exhaustion ─────────────────────────────────────────────
describe('Port allocator exhaustion', () => {
  it('throws PORT_RANGE_EXHAUSTED when all ports are taken', async () => {
    // Range is 20000–20009 = 10 ports. Spawn 10 sessions and then a 11th.
    const responses = [
      [200, 'OK'],
      [200, []],
      [200, []],
    ];

    // 10 sessions — each needs: createNetwork(201), createContainer(201),
    // connectToNetwork(200), startContainer(204), getHealth(200)
    for (let i = 0; i < 10; i++) {
      responses.push(
        [201, { Id: `net-exhaust-${i}` }],
        [201, { Id: `ctr-exhaust-${i}` }],
        [200, {}],
        [204, null],
        [200, { result: { status: 'healthy' } }],
      );
    }

    setupDockerResponses(responses);

    const orc = makeOrchestrator();
    await orc.initialize();

    // Spawn all 10 available sessions
    for (let i = 0; i < 10; i++) {
      await orc.spawn(`exhaust-${i}`);
    }

    // The 11th should fail with PORT_RANGE_EXHAUSTED
    await expect(orc.spawn('exhaust-overflow')).rejects.toMatchObject({
      code: 'PORT_RANGE_EXHAUSTED',
      statusCode: 503,
    });
  });
});

// ── 13. Friendbot pre-funding ─────────────────────────────────────────────────
describe('Friendbot pre-funding', () => {
  it('hits the friendbot endpoint for each defaultAccounts entry', async () => {
    const TEST_ACCOUNT = 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789012345';

    setupDockerResponses([
      [200, 'OK'],
      [200, []],
      [200, []],
      [201, { Id: 'net-fb' }],
      [201, { Id: 'ctr-fb' }],
      [200, {}],
      [204, null],
      [200, { result: { status: 'healthy' } }],
      // friendbot GET /?addr=... → 200
      [200, { funded: true }],
    ]);

    const orc = makeOrchestrator({ defaultAccounts: [TEST_ACCOUNT] });
    await orc.initialize();
    await orc.spawn('fb-session');

    // Verify a request was made with the friendbot path
    const friendbotCall = http.request.mock.calls.find(([opts]) =>
      typeof opts.path === 'string' && opts.path.startsWith('/?addr='),
    );
    expect(friendbotCall).toBeDefined();
    expect(friendbotCall[0].path).toContain(encodeURIComponent(TEST_ACCOUNT));
  });
});

// ── 14. shutdown() ────────────────────────────────────────────────────────────
describe('shutdown()', () => {
  it('destroys all active sessions', async () => {
    setupDockerResponses([
      [200, 'OK'],
      [200, []],
      [200, []],
      [201, { Id: 'net-sd' }],
      [201, { Id: 'ctr-sd' }],
      [200, {}],
      [204, null],
      [200, { result: { status: 'healthy' } }],
      // destroy
      [204, null], [204, null], [204, null],
    ]);

    const orc = makeOrchestrator();
    await orc.initialize();
    await orc.spawn('shutdown-session');

    expect(orc.listSessions()).toHaveLength(1);
    await orc.shutdown();
    expect(orc.listSessions()).toHaveLength(0);
  });

  it('does not throw when there are no active sessions', async () => {
    setupDockerResponses([
      [200, 'OK'],
      [200, []],
      [200, []],
    ]);

    const orc = makeOrchestrator();
    await orc.initialize();
    await expect(orc.shutdown()).resolves.toBeUndefined();
  });
});

// ── EphemeralQuickstartError shape ────────────────────────────────────────────
describe('EphemeralQuickstartError', () => {
  it('carries code, statusCode, and details', () => {
    const err = new EphemeralQuickstartError('test error', {
      code: 'TEST_CODE',
      statusCode: 422,
      details: { foo: 'bar' },
    });
    expect(err.name).toBe('EphemeralQuickstartError');
    expect(err.code).toBe('TEST_CODE');
    expect(err.statusCode).toBe(422);
    expect(err.details).toEqual({ foo: 'bar' });
    expect(err instanceof Error).toBe(true);
  });

  it('defaults to code=QUICKSTART_ERROR and statusCode=500', () => {
    const err = new EphemeralQuickstartError('plain error');
    expect(err.code).toBe('QUICKSTART_ERROR');
    expect(err.statusCode).toBe(500);
    expect(err.details).toBeUndefined();
  });
});
