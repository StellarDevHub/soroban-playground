import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getCompileTempRoot, getCompileTempPrefix } from './buildSandbox.js';

@Injectable()
export class TempCleanupService {
  private readonly logger = new Logger(TempCleanupService.name);
  private readonly tempBaseDir = getCompileTempRoot();
  private readonly tempPrefix = getCompileTempPrefix();
  private readonly maxAgeMs = 30 * 60 * 1000; // 30 minutes threshold

  /**
   * Hourly Cron Job: Purges leftover compile temp directories older than 30
   * minutes. Matches the prefix+root used by compileWorker.js. (issue #1330)
   */
  @Cron(CronExpression.EVERY_HOUR)
  async cleanupWasmTempDirectories(): Promise<{
    deletedDirs: number;
    reclaimedBytes: number;
  }> {
    this.logger.log('Starting WASM build temp directory garbage collection...');

    let deletedDirs = 0;
    let reclaimedBytes = 0;

    try {
      const entries = await fs.readdir(this.tempBaseDir, {
        withFileTypes: true,
      });
      const now = Date.now();

      for (const entry of entries) {
        // Target directories matching the compilation pattern, e.g. '.tmp_compile_*'
        if (entry.isDirectory() && entry.name.startsWith(this.tempPrefix)) {
          const dirPath = path.join(this.tempBaseDir, entry.name);

          try {
            const stats = await fs.stat(dirPath);
            const dirAgeMs = now - stats.mtimeMs;

            if (dirAgeMs > this.maxAgeMs) {
              const dirSizeBytes = await this.calculateDirectorySize(dirPath);

              // Safely delete stale temp build folder recursively
              await fs.rm(dirPath, { recursive: true, force: true });

              deletedDirs++;
              reclaimedBytes += dirSizeBytes;

              this.logger.debug(
                `Purged temp directory: ${entry.name} (Age: ${Math.round(dirAgeMs / 60000)}m, Size: ${(
                  dirSizeBytes /
                  (1024 * 1024)
                ).toFixed(2)} MB)`
              );
            }
          } catch (statOrRmError) {
            this.logger.error(
              `Failed to process or delete temp dir ${dirPath}:`,
              statOrRmError
            );
          }
        }
      }

      const reclaimedMb = (reclaimedBytes / (1024 * 1024)).toFixed(2);
      this.logger.log(
        `WASM Garbage Collection finished. Reclaimed ${reclaimedMb} MB across ${deletedDirs} temp directories.`
      );

      return { deletedDirs, reclaimedBytes };
    } catch (error) {
      this.logger.error(
        'Error scanning base temp directory for WASM cleanup:',
        error
      );
      return { deletedDirs: 0, reclaimedBytes: 0 };
    }
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
