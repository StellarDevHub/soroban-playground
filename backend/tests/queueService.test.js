// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { jest } from '@jest/globals';

// ─── Setup Mocks ─────────────────────────────────────────────────────────────

const mockQueueAdd = jest.fn();
const mockQueueClose = jest.fn();
const mockWorkerClose = jest.fn();
const mockFlowProducerAdd = jest.fn();
const mockFlowProducerClose = jest.fn();

class MockQueue {
  constructor(name, opts) {
    this.name = name;
    this.opts = opts;
    this.add = mockQueueAdd;
    this.close = mockQueueClose;
  }
}

class MockWorker {
  constructor(name, processor, opts) {
    this.name = name;
    this.processor = processor;
    this.opts = opts;
    this.close = mockWorkerClose;
    this.eventListeners = {};
  }
  on(event, handler) {
    this.eventListeners[event] = handler;
  }
}

class MockFlowProducer {
  constructor(opts) {
    this.opts = opts;
    this.add = mockFlowProducerAdd;
    this.close = mockFlowProducerClose;
  }
}

jest.unstable_mockModule('bullmq', () => ({
  Queue: MockQueue,
  Worker: MockWorker,
  FlowProducer: MockFlowProducer,
}));

// Mock ioredis
const mockRedisQuit = jest.fn();
class MockRedis {
  constructor(url, opts) {
    this.url = url;
    this.opts = opts;
    this.quit = mockRedisQuit;
  }
  on() {}
}

jest.unstable_mockModule('ioredis', () => ({
  default: MockRedis,
  Redis: MockRedis,
}));

// Mock Bull Board
const mockCreateBullBoard = jest.fn(() => ({
  setQueues: jest.fn(),
  replaceQueues: jest.fn(),
  addQueue: jest.fn(),
  removeQueue: jest.fn(),
}));

jest.unstable_mockModule('@bull-board/api', () => ({
  createBullBoard: mockCreateBullBoard,
}));

jest.unstable_mockModule('@bull-board/api/bullMQAdapter', () => ({
  BullMQAdapter: class MockBullMQAdapter {
    constructor(queue) {
      this.queue = queue;
    }
  },
}));

jest.unstable_mockModule('@bull-board/express', () => ({
  ExpressAdapter: class MockExpressAdapter {
    constructor() {
      this.basePath = '';
    }
    setBasePath(path) {
      this.basePath = path;
    }
    getRouter() {
      return { router: true };
    }
  },
}));

// Import target under test dynamically after mocking
const queueService = await import('../src/services/queueService.js');

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('queueService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear queues & workers objects
    for (const key of Object.keys(queueService.queues)) delete queueService.queues[key];
    for (const key of Object.keys(queueService.workers)) delete queueService.workers[key];
  });

  afterEach(async () => {
    // Reset NODE_ENV just in case
    process.env.NODE_ENV = 'test';
  });

  it('initializes queues, FlowProducer, and dashboard in test mode (without starting workers)', () => {
    process.env.NODE_ENV = 'test';
    queueService.initializeQueues();

    expect(queueService.queues.indexing).toBeDefined();
    expect(queueService.queues.email).toBeDefined();
    expect(queueService.queues.cron).toBeDefined();
    
    // Workers should not start in test mode
    expect(Object.keys(queueService.workers).length).toBe(0);
    expect(queueService.queueDashboard).toEqual({ router: true });
    expect(mockCreateBullBoard).toHaveBeenCalled();
  });

  it('initializes workers and schedules repeatable cron jobs in non-test mode', async () => {
    process.env.NODE_ENV = 'production';
    queueService.initializeQueues();

    expect(queueService.workers.indexing).toBeDefined();
    expect(queueService.workers.email).toBeDefined();
    expect(queueService.workers.cron).toBeDefined();

    // Verify repeatable job added
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'daily-cleanup',
      { task: 'cleanup' },
      expect.objectContaining({
        repeat: { pattern: '0 0 * * *' },
        jobId: 'daily-cleanup',
      })
    );
  });

  it('correctly executes the linear backoff strategy', () => {
    const linearBackoff = queueService.backoffStrategies.linear;
    expect(linearBackoff(1, null, { delay: 1000 })).toBe(1000);
    expect(linearBackoff(3, null, { delay: 1000 })).toBe(3000);
    expect(linearBackoff(2, null, null)).toBe(2000); // defaults to 1000
  });

  it('addJob delegates to the correct queue and forwards arguments', async () => {
    process.env.NODE_ENV = 'test';
    queueService.initializeQueues();

    const jobData = { contractId: 'C123' };
    const jobOpts = { priority: 10 };
    mockQueueAdd.mockResolvedValue({ id: 'job_123' });

    const result = await queueService.addJob('indexing', 'contract-indexing', jobData, jobOpts);

    expect(mockQueueAdd).toHaveBeenCalledWith('contract-indexing', jobData, jobOpts);
    expect(result.id).toBe('job_123');
  });

  it('addJob throws if the requested queue is not initialized', async () => {
    await expect(queueService.addJob('non-existent', 'job', {})).rejects.toThrow(
      'Queue "non-existent" not found'
    );
  });

  it('addFlow delegates to FlowProducer', async () => {
    process.env.NODE_ENV = 'test';
    queueService.initializeQueues();

    const flowDef = {
      name: 'parent',
      queueName: 'indexing',
      children: [{ name: 'child', queueName: 'email' }],
    };
    mockFlowProducerAdd.mockResolvedValue({ job: { id: 'parent_123' } });

    const result = await queueService.addFlow(flowDef);
    expect(mockFlowProducerAdd).toHaveBeenCalledWith(flowDef);
    expect(result.job.id).toBe('parent_123');
  });

  it('gracefully shuts down all workers, queues, FlowProducer, and Redis connections without leaking', async () => {
    process.env.NODE_ENV = 'production';
    queueService.initializeQueues();

    await queueService.shutdownQueues();

    expect(mockWorkerClose).toHaveBeenCalledTimes(3);
    expect(mockQueueClose).toHaveBeenCalledTimes(3);
    expect(mockFlowProducerClose).toHaveBeenCalledTimes(1);
    expect(mockRedisQuit).toHaveBeenCalled();
  });
});
