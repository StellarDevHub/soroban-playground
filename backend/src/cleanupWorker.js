// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import fs from 'fs';
import path from 'path';

const CLEANUP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const OLD_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
const TEMP_DIR_PREFIX = '.tmp_compile_';

/**
 * Scans a directory for temporary compilation folders
 * and deletes those older than a specified threshold.
 */
function scanAndCleanupDir(baseDir) {
  try {
    const files = fs.readdirSync(baseDir, { withFileTypes: true });

    for (const file of files) {
      if (file.isDirectory() && file.name.startsWith(TEMP_DIR_PREFIX)) {
        const dirPath = path.join(baseDir, file.name);
        try {
          const stats = fs.statSync(dirPath);
          const now = Date.now();
          const birthtimeMs = stats.birthtimeMs;

          if (now - birthtimeMs > OLD_THRESHOLD_MS) {
            console.log(`Deleting old temporary directory: ${dirPath}`);
            fs.rmSync(dirPath, { recursive: true, force: true });
            console.log(`Successfully deleted: ${dirPath}`);
          }
        } catch (err) {
          console.error(
            `Failed to process or delete directory ${dirPath}: ${err.message}`
          );
        }
      }
    }
  } catch (err) {
    console.error(`Error scanning directory ${baseDir}: ${err.message}`);
  }
}

/**
 * Scans the root and src directories for temporary compilation folders
 * and deletes those older than a specified threshold.
 */
function cleanupTempDirectories() {
  console.log('Starting temporary directory cleanup...');

  const rootDir = process.cwd();
  const srcDir = path.join(rootDir, 'src');

  // Scan root directory
  scanAndCleanupDir(rootDir);

  // Scan src directory if it exists
  if (fs.existsSync(srcDir)) {
    scanAndCleanupDir(srcDir);
  }

  console.log('Temporary directory cleanup finished.');
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
  cleanupTempDirectories();
  // Then run at intervals
  setInterval(cleanupTempDirectories, CLEANUP_INTERVAL_MS);
}
