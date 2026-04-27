import os from 'os';
import Redis from 'ioredis';
import { oracleQueueService } from './oracleQueueService.js';
import redisService from './redisService.js';
import { oracleTasksProcessed, oracleProcessingDuration } from '../routes/metrics.js';

export class OracleWorkerPool {
  constructor(workerCount = os.cpus().length) {
    this.workerCount = workerCount;
    this.workers = [];
    this.isRunning = false;
    this.sweeperInterval = null;
    this.workerIdPrefix = `worker:${os.hostname()}:${process.pid}`;
  }

  /**
   * Mock processing function for a ProofTask
   */
  async processProof(task) {
    // In a real application, this would verify the cryptographic proof
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (Math.random() < 0.1) {
          reject(new Error('Simulated processing failure'));
        } else {
          resolve('Proof verified successfully');
        }
      }, 500); // simulate 500ms processing
    });
  }

  async start() {
    if (this.isRunning || redisService.isFallbackMode) return;
    this.isRunning = true;

    console.log(`Starting Oracle Worker Pool with ${this.workerCount} workers`);

    for (let i = 0; i < this.workerCount; i++) {
      const workerId = `${this.workerIdPrefix}:${i}`;
      this.workers.push(this.runWorker(workerId));
    }

    // Start background sweeper for fault tolerance (every 1 minute)
    this.sweeperInterval = setInterval(() => this.recoverOrphanedTasks(), 60000);
  }

  async stop() {
    this.isRunning = false;
    if (this.sweeperInterval) {
      clearInterval(this.sweeperInterval);
    }
    console.log('Stopping Oracle Worker Pool...');
    // We don't await this.workers here because BRPOPLPUSH might be blocking,
    // in a real prod app we'd close the redis clients to break the block.
  }

  async runWorker(workerId) {
    const processingQueue = `oracle:queue:processing:${workerId}`;
    
    // We need a dedicated Redis client for each worker since BRPOPLPUSH blocks
    // and cannot share the same client as regular commands
    const blockingClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 1
    });

    try {
      while (this.isRunning) {
        // Atomic pop from pending and push to this worker's processing queue
        // Blocks for up to 5 seconds waiting for a task
        const taskId = await blockingClient.brpoplpush(
          oracleQueueService.PENDING_QUEUE,
          processingQueue,
          5
        );

        if (!taskId) continue; // Timeout, loop again

        await this.handleTask(taskId, processingQueue);
      }
    } catch (err) {
      console.error(`Worker ${workerId} error:`, err);
    } finally {
      blockingClient.quit();
    }
  }

  async handleTask(taskId, processingQueue) {
    try {
      const task = await oracleQueueService.getTaskStatus(taskId);
      if (!task) {
        // Task metadata missing, discard
        await oracleQueueService.client.lrem(processingQueue, 1, taskId);
        return;
      }

      if (Date.now() > task.deadline) {
        await oracleQueueService.updateTaskState(taskId, 'DeadLetter', {
          error: 'Deadline exceeded'
        });
        await oracleQueueService.client.lrem(processingQueue, 1, taskId);
        return;
      }

      await oracleQueueService.updateTaskState(taskId, 'Processing');

      // Process the actual proof
      const timer = oracleProcessingDuration.startTimer();
      await this.processProof(task);
      timer();

      // Success
      await oracleQueueService.updateTaskState(taskId, 'Completed');
      await oracleQueueService.client.lrem(processingQueue, 1, taskId);
      oracleTasksProcessed.labels('success').inc();

    } catch (err) {
      // Failure logic
      const task = await oracleQueueService.getTaskStatus(taskId);
      if (task) {
        const currentRetries = task.currentRetries + 1;
        if (currentRetries <= task.maxRetries) {
          // Retry: Update state and push back to pending queue
          await oracleQueueService.updateTaskState(taskId, 'Pending', {
            currentRetries,
            error: err.message
          });
          
          const pipeline = oracleQueueService.client.pipeline();
          pipeline.lrem(processingQueue, 1, taskId);
          pipeline.rpush(oracleQueueService.PENDING_QUEUE, taskId);
          await pipeline.exec();
        } else {
          // Max retries exceeded -> DLQ
          await oracleQueueService.updateTaskState(taskId, 'DeadLetter', {
            currentRetries,
            error: `Max retries reached: ${err.message}`
          });
          await oracleQueueService.client.lrem(processingQueue, 1, taskId);
          oracleTasksProcessed.labels('failure').inc();
        }
      } else {
        await oracleQueueService.client.lrem(processingQueue, 1, taskId);
      }
    }
  }

  /**
   * Fault Tolerance: Recovers tasks from workers that crashed mid-processing
   */
  async recoverOrphanedTasks() {
    if (!oracleQueueService.client || redisService.isFallbackMode) return;

    try {
      const keys = await oracleQueueService.client.keys('oracle:queue:processing:*');
      for (const queue of keys) {
        // Here we could check if the worker is still alive via heartbeats
        // For simplicity, we assume any task sitting in a processing queue
        // for more than a set time (e.g., 5 mins) without completing is orphaned.
        
        const tasks = await oracleQueueService.client.lrange(queue, 0, -1);
        for (const taskId of tasks) {
          const task = await oracleQueueService.getTaskStatus(taskId);
          if (task && (Date.now() - task.updatedAt > 5 * 60 * 1000)) {
            console.log(`Recovering orphaned task ${taskId} from ${queue}`);
            
            const pipeline = oracleQueueService.client.pipeline();
            pipeline.lrem(queue, 1, taskId);
            pipeline.rpush(oracleQueueService.PENDING_QUEUE, taskId);
            await pipeline.exec();
            
            await oracleQueueService.updateTaskState(taskId, 'Pending', {
              error: 'Recovered from crashed worker'
            });
          }
        }
      }
    } catch (err) {
      console.error('Error in recovery sweeper:', err);
    }
  }
}

export const oracleWorkerPool = new OracleWorkerPool();
