// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';

const CLEANUP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const OLD_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
const TEMP_DIR_PREFIX = '.tmp_compile_';
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;
let intervalId = null;

/**
 * Scans a directory for temporary compilation folders
 * and deletes those older than a specified threshold.
 * Includes robust error handling and retry logic.
 */
async function scanAndCleanupDir(baseDir) {
  try {
    const startTime = performance.now();
    const files = fs.readdirSync(baseDir, { withFileTypes: true });
    let processedCount = 0;
    let deletedCount = 0;
    let errorCount = 0;

    for (const file of files) {
      if (file.isDirectory() && file.name.startsWith(TEMP_DIR_PREFIX)) {
        const dirPath = path.join(baseDir, file.name);
        try {
          const stats = fs.statSync(dirPath);
          const now = Date.now();
          const birthtimeMs = stats.birthtimeMs;

          if (now - birthtimeMs > OLD_THRESHOLD_MS) {
            console.log(`Deleting old temporary directory: ${dirPath}`);

            // Try deletion with retry logic
            let attempt = 0;
            let deleted = false;
            while (attempt < MAX_RETRY_ATTEMPTS && !deleted) {
              try {
                fs.rmSync(dirPath, { recursive: true, force: true });
                console.log(`Successfully deleted: ${dirPath}`);
                deleted = true;
                deletedCount++;
              } catch (err) {
                attempt++;
                if (attempt < MAX_RETRY_ATTEMPTS) {
                  console.warn(
                    `Attempt ${attempt} failed for ${dirPath}: ${err.message}. Retrying in ${RETRY_DELAY_MS}ms...`
                  );
                  await new Promise((resolve) =>
                    setTimeout(resolve, RETRY_DELAY_MS)
                  );
                } else {
                  console.error(
                    `Failed to delete ${dirPath} after ${MAX_RETRY_ATTEMPTS} attempts: ${err.message}`
                  );
                  errorCount++;
                }
              }
            }
          }
        } catch (err) {
          console.error(
            `Failed to process directory ${dirPath}: ${err.message}`
          );
          errorCount++;
        }
        processedCount++;
      }
    }

    const endTime = performance.now();
    console.log(
      `Cleanup completed for ${baseDir}: ${processedCount} directories processed, ${deletedCount} deleted, ${errorCount} errors. Time: ${(endTime - startTime).toFixed(2)}ms`
    );
  } catch (err) {
    console.error(`Error scanning directory ${baseDir}: ${err.message}`);
    console.error(`Full error stack: ${err.stack}`);
  }
}

/**
 * Scans the root and src directories for temporary compilation folders
 * and deletes those older than a specified threshold.
 * Includes comprehensive error handling and monitoring.
 */
async function cleanupTempDirectories() {
  console.log('Starting temporary directory cleanup...');

  const rootDir = process.cwd();
  const srcDir = path.join(rootDir, 'src');

  // Scan root directory
  await scanAndCleanupDir(rootDir);

  // Scan src directory if it exists
  if (fs.existsSync(srcDir)) {
    await scanAndCleanupDir(srcDir);
  }

  console.log('Temporary directory cleanup finished.');
}

export function stopCleanupWorker() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

/**
 * Starts the background worker for cleaning up temporary directories.
 * It runs immediately upon call and then at regular intervals.
 */
export function startCleanupWorker() {
  console.log(
    `Temporary directory cleanup worker started. Running every ${CLEANUP_INTERVAL_MS / 1000 / 60} minutes.`
  );

  // Run immediately on startup
  cleanupTempDirectories().catch(console.error);

  // Then run at intervals
  intervalId = setInterval(() => {
    cleanupTempDirectories().catch(console.error);
  }, CLEANUP_INTERVAL_MS);
}
