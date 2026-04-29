import crypto from 'crypto';
import redisService from './redisService.js';
import { oracleTasksEnqueued, oracleQueueDepth } from '../routes/metrics.js';

export class ProofTask {
  constructor(
    payload,
    priority = 1,
    maxRetries = 3,
    deadline = Date.now() + 3600000
  ) {
    this.id = crypto.randomUUID();
    this.payload = payload;
    this.priority = priority;
    this.maxRetries = maxRetries;
    this.currentRetries = 0;
    this.deadline = deadline;
    this.state = 'Pending';
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
  }
}

class OracleQueueService {
  constructor() {
    this.PENDING_QUEUE = 'oracle:queue:pending';
    this.DLQ = 'oracle:queue:dlq';
    this.TASK_PREFIX = 'oracle:task:';
  }

  get client() {
    return redisService.client;
  }

  async enqueue(payload, priority = 1, maxRetries = 3, deadline = null) {
    if (!this.client || redisService.isFallbackMode) {
      throw new Error('Redis is required for Oracle task queue');
    }

    const task = new ProofTask(
      payload,
      priority,
      maxRetries,
      deadline || Date.now() + 3600000
    );

    const pipeline = this.client.pipeline();

    // Store task metadata
    pipeline.hset(
      `${this.TASK_PREFIX}${task.id}`,
      'data',
      JSON.stringify(task)
    );

    // Push to pending queue
    // In a real priority queue we might use a Sorted Set, but for simplicity
    // and BRPOPLPUSH support, we'll use a List and optionally separate queues per priority.
    // Here we use a single list for horizontal scaling simplicity.
    if (priority > 1) {
      // High priority tasks get pushed to the front
      pipeline.lpush(this.PENDING_QUEUE, task.id);
    } else {
      pipeline.rpush(this.PENDING_QUEUE, task.id);
    }

    await pipeline.exec();

    // Update Metrics
    oracleTasksEnqueued.inc();
    this.updateQueueDepthMetric();

    return task.id;
  }

  async enqueueBatch(payloads, priority = 1, maxRetries = 3) {
    if (!this.client || redisService.isFallbackMode) {
      throw new Error('Redis is required for Oracle task queue');
    }

    const pipeline = this.client.pipeline();
    const taskIds = [];

    for (const payload of payloads) {
      const task = new ProofTask(payload, priority, maxRetries);
      taskIds.push(task.id);

      pipeline.hset(
        `${this.TASK_PREFIX}${task.id}`,
        'data',
        JSON.stringify(task)
      );

      if (priority > 1) {
        pipeline.lpush(this.PENDING_QUEUE, task.id);
      } else {
        pipeline.rpush(this.PENDING_QUEUE, task.id);
      }
    }

    await pipeline.exec();

    // Update Metrics
    oracleTasksEnqueued.inc(payloads.length);
    this.updateQueueDepthMetric();

    return taskIds;
  }

  async getTaskStatus(taskId) {
    if (!this.client || redisService.isFallbackMode) return null;

    const taskData = await this.client.hget(
      `${this.TASK_PREFIX}${taskId}`,
      'data'
    );
    if (!taskData) return null;

    return JSON.parse(taskData);
  }

  async updateTaskState(taskId, state, updates = {}) {
    if (!this.client || redisService.isFallbackMode) return;

    const taskData = await this.client.hget(
      `${this.TASK_PREFIX}${taskId}`,
      'data'
    );
    if (!taskData) return;

    const task = JSON.parse(taskData);
    task.state = state;
    task.updatedAt = Date.now();
    Object.assign(task, updates);

    const pipeline = this.client.pipeline();
    pipeline.hset(`${this.TASK_PREFIX}${taskId}`, 'data', JSON.stringify(task));

    if (state === 'DeadLetter') {
      pipeline.zadd(this.DLQ, Date.now(), taskId);
    } else if (state === 'Completed' || state === 'DeadLetter') {
      // Set expiration for completed/failed tasks metadata to avoid memory leaks
      pipeline.expire(`${this.TASK_PREFIX}${taskId}`, 60 * 60 * 24 * 7); // 7 days
    }

    await pipeline.exec();
  }

  async getQueueMetrics() {
    if (!this.client || redisService.isFallbackMode) {
      return { pending: 0, dlq: 0 };
    }

    const pending = await this.client.llen(this.PENDING_QUEUE);
    const dlq = await this.client.zcard(this.DLQ);
    return { pending, dlq };
  }

  async updateQueueDepthMetric() {
    if (!this.client || redisService.isFallbackMode) return;
    try {
      const pending = await this.client.llen(this.PENDING_QUEUE);
      oracleQueueDepth.set(pending);
    } catch (err) {
      console.error('Failed to update queue depth metric', err);
    }
  }
}

export const oracleQueueService = new OracleQueueService();
