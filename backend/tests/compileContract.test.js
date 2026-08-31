import { jest } from '@jest/globals';

// The real compileService module creates a WorkerPool at load time and its
// compileContract() calls the real (module-scoped) compileQueued(). We mock
// worker_threads so the pool never spawns real threads, and have the fake
// worker answer each job with a scripted result.
let resultPayload = null;

jest.mock('worker_threads', () => {
  const { EventEmitter } = require('events');
  class FakeWorker extends EventEmitter {
    constructor() {
      super();
      this.threadId = 1;
      this.exitCode = undefined;
    }
    postMessage() {
      setImmediate(() => {
        this.emit('message', {
          type: 'result',
          payload: global.__compileResultPayload,
        });
      });
    }
    terminate() {
      this.exitCode = 0;
    }
  }
  return { Worker: FakeWorker, parentPort: null };
});

jest.mock('lru-cache', () => {
  class MockLRUCache {
    constructor() {
      this.store = new Map();
    }
    get(k) {
      return this.store.get(k);
    }
    set(k, v) {
      this.store.set(k, v);
    }
    has(k) {
      return this.store.has(k);
    }
    delete(k) {
      return this.store.delete(k);
    }
    entries() {
      return this.store.entries();
    }
    values() {
      return this.store.values();
    }
    keys() {
      return this.store.keys();
    }
    clear() {
      this.store.clear();
    }
  }
  return { LRUCache: MockLRUCache };
});

// Avoid reading/writing real state files during tests.
jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  rm: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn().mockRejectedValue({ code: 'ENOENT' }),
  writeFile: jest.fn().mockResolvedValue(undefined),
  stat: jest.fn().mockResolvedValue({ size: 4096 }),
  copyFile: jest.fn().mockResolvedValue(undefined),
}));

let compileContract;

beforeAll(async () => {
  ({ compileContract } = await import('../src/services/compileService.js'));
});

describe('compileContract (async BullMQ worker entrypoint)', () => {
  beforeEach(() => {
    global.__compileResultPayload = null;
  });

  it('returns the compact worker-facing result shape on success', async () => {
    global.__compileResultPayload = {
      success: true,
      cached: false,
      hash: 'abc123',
      durationMs: 250,
      artifact: {
        name: 'soroban_contract.wasm',
        sizeBytes: 4096,
        path: '/tmp/x.wasm',
      },
      logs: [],
      memoryPeakBytes: 0,
    };

    const result = await compileContract({
      source: 'pub fn hello() {}',
      contractName: 'hello_contract',
    });

    expect(result.hash).toBe('abc123');
    expect(result.wasmUrl).toBe('/tmp/x.wasm');
    expect(result.sizeBytes).toBe(4096);
    expect(result.durationMs).toBe(250);
  });

  it('throws a COMPILE_FAILED error when the compile does not succeed', async () => {
    global.__compileResultPayload = {
      success: false,
      cached: false,
      hash: 'abc123',
      durationMs: 250,
      artifact: { name: 'x.wasm', sizeBytes: 0, path: '' },
      logs: ['error: compilation bomb exploded'],
      memoryPeakBytes: 0,
    };

    await expect(compileContract({ source: 'bomb' })).rejects.toMatchObject({
      code: 'COMPILE_FAILED',
      message: expect.stringContaining('compilation bomb exploded'),
    });
  });
});
