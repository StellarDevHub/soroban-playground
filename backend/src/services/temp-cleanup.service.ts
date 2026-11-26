import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getCompileTempRoot, getCompileTempPrefix } from './buildSandbox.js';

/**
 * Name of the lock marker file that an active compilation keeps inside its
 * temp directory. While the file exists and its mtime is fresh, the directory
 * is considered in use and must not be removed.
 */
export const COMPILE_LOCK_FILENAME = '.compile.lock';

@Injectable()
export class TempCleanupService {
  private readonly logger = new Logger(TempCleanupService.name);
  private readonly tempBaseDir = getCompileTempRoot();
  private readonly tempPrefix = getCompileTempPrefix();
  private readonly maxAgeMs = 60 * 60 * 1000; // 1 hour threshold
  private readonly lockStaleMs = 15 * 60 * 1000; // lock considered abandoned after 15 minutes

  /**
   * Runs every 15 minutes: purges compile temp directories older than 1 hour
   * that are not held by an active compilation lock.
   */
  @Cron('0 */15 * * * *')
  async cleanupWasmTempDirectories(): Promise<{
    deletedDirs: number;
    reclaimedBytes: number;
    skippedLocked: number;
    failed: number;
  }> {
    this.logger.log('Starting WASM build temp directory garbage collection...');

    let deletedDirs = 0;
    let reclaimedBytes = 0;
    let skippedLocked = 0;
    let failed = 0;

    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(this.tempBaseDir, { withFileTypes: true });
    } catch (error) {
      this.logger.error(
        'Error scanning base temp directory for WASM cleanup:',
        error as Error,
      );
      return { deletedDirs, reclaimedBytes, skippedLocked, failed: 1 };
    }

    const now = Date.now();

    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith(this.tempPrefix)) {
        continue;
      }

      const dirPath = path.join(this.tempBaseDir, entry.name);

      try {
        const stats = await fs.stat(dirPath);
        const dirAgeMs = now - stats.mtimeMs;

        if (dirAgeMs <= this.maxAgeMs) {
          continue;
        }

        if (await this.isLocked(dirPath, now)) {
          skippedLocked++;
          this.logger.debug(`Skipping actively locked temp dir: ${entry.name}`);
          continue;
        }

        const dirSizeBytes = await this.calculateDirectorySize(dirPath);

        await this.removeWithRetry(dirPath);

        deletedDirs++;
        reclaimedBytes += dirSizeBytes;

        this.logger.debug(
          `Purged temp directory: ${entry.name} (Age: ${Math.round(
            dirAgeMs / 60000,
          )}m, Size: ${(dirSizeBytes / (1024 * 1024)).toFixed(2)} MB)`,
        );
      } catch (error) {
        failed++;
        this.logger.error(
          `Failed to process or delete temp dir ${dirPath}:`,
          error as Error,
        );
      }
    }

    const reclaimedMb = (reclaimedBytes / (1024 * 1024)).toFixed(2);
    this.logger.log(
      `WASM Garbage Collection finished. Reclaimed ${reclaimedMb} MB across ${deletedDirs} temp directories (skipped locked: ${skippedLocked}, failed: ${failed}).`,
    );

    return { deletedDirs, reclaimedBytes, skippedLocked, failed };
  }

  /**
   * A directory is locked when it contains a lock marker whose mtime is
   * within the stale window. The lock is acquired atomically by compile
   * workers using the 'wx' flag (O_CREAT|O_EXCL), so a lock file that
   * exists is a lock held by another process.
   */
  private async isLocked(dirPath: string, now: number): Promise<boolean> {
    const lockPath = path.join(dirPath, COMPILE_LOCK_FILENAME);
    try {
      const stats = await fs.stat(lockPath);
      return now - stats.mtimeMs <= this.lockStaleMs;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      // Unknown error reading the lock: be conservative and treat as locked.
      return true;
    }
  }

  /**
   * Removes a directory recursively, retrying briefly on transient EBUSY /
   * EPERM / ENOTEMPTY errors that occur when files are still held open.
   */
  private async removeWithRetry(dirPath: string, attempts = 3): Promise<void> {
    let lastError: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        await fs.rm(dirPath, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
        return;
      } catch (error) {
        lastError = error;
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'ENOTEMPTY') {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 200 * (i + 1)));
      }
    }
    throw lastError;
  }

  /**
   * Helper to recursively sum file sizes within a directory before deletion.
   */
  private async calculateDirectorySize(dirPath: string): Promise<number> {
    let totalSize = 0;
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          totalSize += await this.calculateDirectorySize(fullPath);
        } else if (entry.isFile()) {
          const stats = await fs.stat(fullPath);
          totalSize += stats.size;
        }
      }
    } catch {
      // Return accumulated size if sub-path fails during calculation
    }
    return totalSize;
  }
}
