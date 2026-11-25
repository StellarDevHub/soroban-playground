/**
 * Tests for WebSocket heartbeat / stale-session reaper (#734)
 */

// Module-level state captured by the mock
let connectionHandler = null;
let closeHandler = null;
let lastServiceWss = null;

jest.mock('ws', () => {
  const MockWsServer = jest.fn(function MockServiceWss() {
    this.clients = new Set();
    this.handlers = {};
    this.on = (event, handler) => {
      this.handlers[event] = handler;
    };
    this.close = jest.fn();
    lastServiceWss = this;
  });

  const MockWebSocket = {
    OPEN: 1,
    Server: MockWsServer,
  };

  return {
    __esModule: true,
    default: MockWebSocket,
    WebSocketServer: jest.fn(function MockWss() {
      this.on = (event, handler) => {
        if (event === 'connection') connectionHandler = handler;
        if (event === 'close') closeHandler = handler;
      };
    }),
  };
});

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn().mockResolvedValue(undefined),
    publish: jest.fn().mockResolvedValue(1),
    disconnect: jest.fn(),
  })),
}));

jest.mock(
  '../src/websocket/jsonPatchSync.ts',
  () => ({
    attachPatchSync: jest.fn(() => ({ id: 'mock-session' })),
    broadcastState: jest.fn(),
    syncMetrics: { snapshotMetrics: jest.fn(() => ({})) },
    decodeMessage: jest.fn(),
    MSG_TYPE: {},
  }),
  { virtual: true }
);

jest.mock('../src/services/invokeService.js', () => {
  const { EventEmitter } = require('events');
  return { invokeProgressBus: new EventEmitter() };
});
jest.mock('../src/services/deployService.js', () => {
  const { EventEmitter } = require('events');
  return { deployProgressBus: new EventEmitter() };
});
jest.mock('../src/services/compileService.js', () => {
  const { EventEmitter } = require('events');
  return { compileProgressBus: new EventEmitter() };
});
jest.mock('../src/services/oracleProofQueueService.js', () => {
  const { EventEmitter } = require('events');
  const ee = new EventEmitter();
  return { __esModule: true, default: ee };
});
jest.mock('../src/services/redisService.js', () => ({
  default: { isFallbackMode: true, client: null },
}));
jest.mock('../src/services/oracle/oracleEvents.js', () => ({
  sharedOracleEventBus: { on: jest.fn() },
}));
jest.mock('../src/services/contractEventParser.js', () => ({
  registerHandler: jest.fn(),
  dispatchEvent: jest.fn(),
}));

function makeSocket(overrides = {}) {
  const { EventEmitter } = require('events');
  const sock = new EventEmitter();
  sock.readyState = 1;
  sock.OPEN = 1;
  sock.ping = jest.fn();
  sock.terminate = jest.fn();
  sock.send = jest.fn();
  return Object.assign(sock, overrides);
}

describe('WebSocket heartbeat reaper (#734)', () => {
  let tick30s;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetModules();
    connectionHandler = null;
    closeHandler = null;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function loadAndSetup() {
    const { setupWebsocketServer } = require('../src/websocket.js');
    setupWebsocketServer({ on: jest.fn() });
  }

  it('assigns missedPongs = 0 on new connection', async () => {
    await loadAndSetup();
    const sock = makeSocket();
    connectionHandler(sock, { url: '/ws', headers: {} });
    expect(sock.missedPongs).toBe(0);
  });

  it('resets missedPongs to 0 on pong', async () => {
    await loadAndSetup();
    const sock = makeSocket();
    connectionHandler(sock, { url: '/ws', headers: {} });
    sock.missedPongs = 1;
    sock.emit('pong');
    expect(sock.missedPongs).toBe(0);
  });

  it('sends a ping and increments missedPongs each heartbeat tick', async () => {
    await loadAndSetup();
    const sock = makeSocket();
    connectionHandler(sock, { url: '/ws', headers: {} });

    jest.advanceTimersByTime(30_000);

    expect(sock.ping).toHaveBeenCalledTimes(1);
    expect(sock.missedPongs).toBe(1);
  });

  it('terminates connection after 2 missed pongs', async () => {
    await loadAndSetup();
    const sock = makeSocket();
    connectionHandler(sock, { url: '/ws', headers: {} });

    jest.advanceTimersByTime(30_000); // tick 1 → missedPongs=1
    jest.advanceTimersByTime(30_000); // tick 2 → missedPongs=2
    jest.advanceTimersByTime(30_000); // tick 3 → >= 2 → terminate

    expect(sock.terminate).toHaveBeenCalledTimes(1);
  });

  it('does not terminate a connection that keeps ponging back', async () => {
    await loadAndSetup();
    const sock = makeSocket();
    connectionHandler(sock, { url: '/ws', headers: {} });

    for (let i = 0; i < 5; i++) {
      jest.advanceTimersByTime(30_000);
      sock.emit('pong'); // resets missedPongs before next tick
    }

    expect(sock.terminate).not.toHaveBeenCalled();
  });
});

describe('WebSocketService heartbeat, cleanup, and resume handshake', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetModules();
    lastServiceWss = null;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function makeServiceSocket(overrides = {}) {
    const sock = makeSocket({
      close: jest.fn(),
      ...overrides,
    });
    return sock;
  }

  function makeReq(overrides = {}) {
    return {
      url: '/ws',
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
      ...overrides,
    };
  }

  function createService(options = {}) {
    const { WebSocketService } = require('../src/services/websocketService.js');
    return new WebSocketService({}, options);
  }

  it('sends ping every 30s and terminates unresponsive socket after 5s pong timeout', () => {
    const service = createService();
    const sock = makeServiceSocket();
    lastServiceWss.clients.add(sock);
    service.handleConnection(sock, makeReq());

    // Advance 30s -> ping sent, not yet terminated
    jest.advanceTimersByTime(30_000);
    expect(sock.ping).toHaveBeenCalledTimes(1);
    expect(sock.terminate).not.toHaveBeenCalled();

    // Advance 4.9s -> still within 5s grace window
    jest.advanceTimersByTime(4_900);
    expect(sock.terminate).not.toHaveBeenCalled();

    // Advance past 5s -> socket terminated and resources cleaned up
    jest.advanceTimersByTime(100);
    expect(sock.terminate).toHaveBeenCalledTimes(1);
    expect(service.sessionCache.has(sock)).toBe(false);
    expect(service.syncSessions.has(sock)).toBe(false);
    expect(service.ipCounts.has('127.0.0.1')).toBe(false);

    service.close();
  });

  it('keeps socket alive when pong arrives within 5 seconds', () => {
    const service = createService();
    const sock = makeServiceSocket();
    lastServiceWss.clients.add(sock);
    service.handleConnection(sock, makeReq());

    for (let i = 0; i < 3; i++) {
      jest.advanceTimersByTime(i === 0 ? 30_000 : 23_000);
      expect(sock.ping).toHaveBeenCalledTimes(i + 1);
      jest.advanceTimersByTime(2_000);
      sock.emit('pong');
      jest.advanceTimersByTime(5_000);
      expect(sock.terminate).not.toHaveBeenCalled();
    }

    service.close();
  });

  it('cleans up user subscription channels and session caches on connection close', () => {
    const service = createService();
    const sock = makeServiceSocket();
    lastServiceWss.clients.add(sock);
    service.handleConnection(
      sock,
      makeReq({ headers: { 'x-user-id': 'user-42' } })
    );

    service.subscribeChannel(sock, 'contract:abc');
    service.subscribeChannel(sock, 'deploy:logs');
    expect(service.channelSubscribers.get('contract:abc').has(sock)).toBe(true);
    expect(service.sessionCache.get(sock).userId).toBe('user-42');

    sock.emit('close');

    expect(service.socketChannels.has(sock)).toBe(false);
    expect(service.channelSubscribers.has('contract:abc')).toBe(false);
    expect(service.channelSubscribers.has('deploy:logs')).toBe(false);
    expect(service.sessionCache.has(sock)).toBe(false);
    expect(service.syncSessions.has(sock)).toBe(false);
    expect(service.ipCounts.has('127.0.0.1')).toBe(false);

    service.close();
  });

  it('supports reconnect authorization handshake with valid resume tokens', () => {
    const service = createService();
    const sock1 = makeServiceSocket();
    lastServiceWss.clients.add(sock1);
    service.handleConnection(
      sock1,
      makeReq({ headers: { 'x-user-id': 'user-99' } })
    );
    service.subscribeChannel(sock1, 'room:soroban');

    const resumeToken = sock1.resumeToken;
    expect(typeof resumeToken).toBe('string');

    // Simulate network drop and cleanup
    sock1.emit('close');
    lastServiceWss.clients.delete(sock1);

    // Reconnect with resume token in query string
    const sock2 = makeServiceSocket();
    lastServiceWss.clients.add(sock2);
    service.handleConnection(
      sock2,
      makeReq({ url: `/ws?resumeToken=${encodeURIComponent(resumeToken)}` })
    );

    expect(sock2.close).not.toHaveBeenCalled();
    expect(sock2.resumed).toBe(true);
    expect(sock2.userId).toBe('user-99');
    expect(service.channelSubscribers.get('room:soroban').has(sock2)).toBe(
      true
    );
    expect(sock2.resumeToken).not.toBe(resumeToken);

    // Reusing the old single-use resume token is rejected
    const sock3 = makeServiceSocket();
    service.handleConnection(
      sock3,
      makeReq({ headers: { 'x-resume-token': resumeToken } })
    );
    expect(sock3.close).toHaveBeenCalledWith(
      4001,
      'Invalid or expired resume token'
    );

    service.close();
  });

  it('rejects reconnect handshake with invalid or expired resume tokens', () => {
    const service = createService({ resumeTokenTtlMs: 10_000 });
    const sock1 = makeServiceSocket();
    service.handleConnection(sock1, makeReq());
    const token = sock1.resumeToken;
    sock1.emit('close');

    // Invalid token
    const badSock = makeServiceSocket();
    service.handleConnection(
      badSock,
      makeReq({ headers: { authorization: 'Resume forged.token' } })
    );
    expect(badSock.close).toHaveBeenCalledWith(
      4001,
      'Invalid or expired resume token'
    );

    // Expired token
    jest.advanceTimersByTime(15_000);
    const expiredSock = makeServiceSocket();
    service.handleConnection(
      expiredSock,
      makeReq({ headers: { 'x-resume-token': token } })
    );
    expect(expiredSock.close).toHaveBeenCalledWith(
      4001,
      'Invalid or expired resume token'
    );

    service.close();
  });
});
