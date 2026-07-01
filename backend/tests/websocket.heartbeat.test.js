/**
 * Tests for WebSocket heartbeat / stale-session reaper (#734)
 */

// Module-level state captured by the mock
let connectionHandler = null;
let closeHandler = null;

jest.mock('ws', () => {
  const { EventEmitter } = require('events');
  return {
    __esModule: true,
    WebSocketServer: jest.fn(function MockWss() {
      this.on = (event, handler) => {
        if (event === 'connection') connectionHandler = handler;
        if (event === 'close') closeHandler = handler;
      };
    }),
  };
});

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
    const { setupWebsocketServer } = await import('../src/websocket.js');
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
