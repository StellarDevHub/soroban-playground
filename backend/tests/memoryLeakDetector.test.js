import { jest } from '@jest/globals';
import path from 'path';
import os from 'os';
import fs from 'fs';

jest.mock('../src/utils/alerting.js', () => ({
  alertManager: { alert: jest.fn() },
}));

jest.mock('v8', () => ({
  getHeapSnapshot: jest.fn(),
}));

jest.mock('stream/promises', () => ({
  pipeline: jest.fn().mockResolvedValue(undefined),
}));

// Mock fs.createWriteStream so _captureSnapshot doesn't open real files;
// keep the rest of fs intact for test setup/teardown.
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  const { PassThrough } = require('stream');
  return {
    ...actual,
    createWriteStream: jest.fn(() => new PassThrough()),
    mkdirSync: jest.fn(),
  };
});

// Must be prefixed with "mock" so Babel hoists the variable alongside jest.mock()
const mockDumpDir = path.join(os.tmpdir(), `heap-test-${process.pid}`);

jest.mock('../src/config/index.js', () => ({
  __esModule: true,
  default: {
    memory: {
      heapLimitMb: 100,
      heapThresholdPct: 85,
      heapDumpDir: mockDumpDir,
      heapDumpIntervalMs: 10000,
      heapDumpS3Bucket: undefined,
    },
  },
}));

let v8Mock;
let pipelineMock;
let alertManagerMock;
let MemoryLeakDetector;
let startMemoryLeakDetector;

beforeAll(async () => {
  v8Mock = (await import('v8')).default ?? (await import('v8'));
  pipelineMock = (await import('stream/promises')).pipeline;
  alertManagerMock = (await import('../src/utils/alerting.js')).alertManager;

  const mod = await import('../src/services/memoryLeakDetector.js');
  MemoryLeakDetector = mod.default.constructor;
  startMemoryLeakDetector = mod.startMemoryLeakDetector;
});

function makeDetector(overrides = {}) {
  const cfg = {
    heapLimitMb: 100,
    heapThresholdPct: 85,
    heapDumpDir: mockDumpDir,
    heapDumpIntervalMs: 10000,
    heapDumpS3Bucket: undefined,
    ...overrides,
  };

  const detector = Object.create(MemoryLeakDetector.prototype);
  detector._limitBytes = cfg.heapLimitMb * 1024 * 1024;
  detector._thresholdPct = cfg.heapThresholdPct;
  detector._dumpDir = cfg.heapDumpDir;
  detector._intervalMs = cfg.heapDumpIntervalMs;
  detector._s3Bucket = cfg.heapDumpS3Bucket;
  detector._timer = null;
  detector._lastDumpAt = -Infinity;
  return detector;
}

describe('MemoryLeakDetector', () => {
  let memorySpy;

  beforeEach(() => {
    jest.clearAllMocks();
    memorySpy = jest.spyOn(process, 'memoryUsage');
    v8Mock.getHeapSnapshot.mockReturnValue({ pipe: jest.fn() });
    pipelineMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    memorySpy.mockRestore();
  });

  it('triggers snapshot when rss exceeds threshold', async () => {
    const detector = makeDetector();
    // 90MB > 85% of 100MB (85MB)
    memorySpy.mockReturnValue({ rss: 90 * 1024 * 1024 });

    const captureSpy = jest
      .spyOn(detector, '_captureSnapshot')
      .mockResolvedValue();
    detector._check();

    expect(captureSpy).toHaveBeenCalledTimes(1);
    expect(captureSpy).toHaveBeenCalledWith(90 * 1024 * 1024);
  });

  it('does not trigger snapshot when under threshold', () => {
    const detector = makeDetector();
    // 80MB < 85% of 100MB
    memorySpy.mockReturnValue({ rss: 80 * 1024 * 1024 });

    const captureSpy = jest
      .spyOn(detector, '_captureSnapshot')
      .mockResolvedValue();
    detector._check();

    expect(captureSpy).not.toHaveBeenCalled();
  });

  it('respects cooldown - no duplicate snapshots within 2x interval', () => {
    const detector = makeDetector({ heapDumpIntervalMs: 10000 });
    memorySpy.mockReturnValue({ rss: 90 * 1024 * 1024 });

    const captureSpy = jest
      .spyOn(detector, '_captureSnapshot')
      .mockResolvedValue();

    // First check should trigger
    detector._check();
    // Simulate that first dump just happened
    detector._lastDumpAt = Date.now();

    // Second check within cooldown (2x interval = 20s) should NOT trigger
    detector._check();

    expect(captureSpy).toHaveBeenCalledTimes(1);
  });

  it('calls alertManager.alert with heap_snapshot_captured on capture', async () => {
    const detector = makeDetector();
    await detector._captureSnapshot(90 * 1024 * 1024);

    expect(alertManagerMock.alert).toHaveBeenCalledWith(
      'heap_snapshot_captured',
      expect.objectContaining({
        rssBytes: 90 * 1024 * 1024,
        limitMb: 100,
        thresholdPct: 85,
      })
    );
  });

  it('start creates an unreffed timer and stop clears it', () => {
    const detector = makeDetector();
    jest.spyOn(detector, '_check').mockImplementation(() => {});

    detector.start();
    expect(detector._timer).not.toBeNull();

    detector.stop();
    expect(detector._timer).toBeNull();
  });

  it('pipes v8.getHeapSnapshot stream through gzip to output file', async () => {
    const detector = makeDetector();
    const mockStream = { pipe: jest.fn() };
    v8Mock.getHeapSnapshot.mockReturnValue(mockStream);

    await detector._captureSnapshot(90 * 1024 * 1024);

    expect(v8Mock.getHeapSnapshot).toHaveBeenCalled();
    expect(pipelineMock).toHaveBeenCalled();
  });
});
