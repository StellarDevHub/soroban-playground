// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Disk quota manager for compile workspaces (Issue #1570).
 *
 * `cleanupWorker.js` already sweeps stale build directories by **age** — older
 * than an hour, delete. That reclaims abandoned workspaces, but it cannot
 * prevent disk exhaustion, which is the other half of what this issue asks for:
 *
 *   If builds arrive faster than the age threshold, every directory in the temp
 *   root is *younger* than the threshold, the age sweep deletes nothing, and the
 *   disk fills anyway.
 *
 * That is the failure this module covers. It works on **total size**, not age:
 * once the temp root exceeds a high-water mark, the oldest workspaces are
 * evicted — regardless of age — until it is back under a low-water mark.
 *
 * # Why two water marks rather than one
 *
 * A single threshold makes the manager oscillate: it evicts one directory,
 * drops just under the limit, the next build pushes it back over, and it evicts
 * again on the next tick. Draining to a lower mark means eviction runs in
 * batches with quiet periods between, which is both cheaper and far easier to
 * read in a log.
 *
 * # Why oldest-first
 *
 * Age is the best available proxy for "least likely to still be in use". A
 * workspace whose build is actively running is by definition recent, so
 * evicting the oldest is the policy least likely to delete a directory out from
 * under a live compile. It is a proxy, not a guarantee — see
 * `QUOTA_MIN_AGE_MS`.
 */

import fsp from 'fs/promises';
import path from 'path';
import { getCompileTempRoot, getCompileTempPrefix } from './buildSandbox.js';

/** Evict once the temp root exceeds this many bytes. Default 4 GiB. */
const QUOTA_HIGH_WATER_BYTES = Number.parseInt(
  process.env.COMPILE_QUOTA_HIGH_WATER_BYTES || String(4 * 1024 * 1024 * 1024),
  10
);

/**
 * Stop evicting once back under this. Default 75% of the high-water mark.
 *
 * See "Why two water marks" above — a single threshold oscillates.
 */
const QUOTA_LOW_WATER_BYTES = Number.parseInt(
  process.env.COMPILE_QUOTA_LOW_WATER_BYTES ||
    String(Math.floor(QUOTA_HIGH_WATER_BYTES * 0.75)),
  10
);

/**
 * Never evict a workspace younger than this, even when over quota.
 *
 * Oldest-first is a proxy for "not in use", and under heavy load the oldest
 * directory may still be an in-flight build. Deleting a live workspace turns a
 * disk-space problem into a failed user compile with a confusing error. Two
 * minutes is longer than a cold cargo build's setup phase, so a workspace this
 * young is almost certainly still being written to.
 *
 * The consequence is that the quota can be exceeded when every workspace is
 * young — that is the correct trade. Over quota with working builds beats under
 * quota with broken ones, and the log line says so explicitly.
 */
const QUOTA_MIN_AGE_MS = Number.parseInt(
  process.env.COMPILE_QUOTA_MIN_AGE_MS || String(2 * 60 * 1000),
  10
);

/** Directories inspected per pass. Bounds the work a single tick can do. */
const QUOTA_MAX_SCAN_ENTRIES = 5000;

/**
 * Best-effort creation time for a directory entry.
 *
 * `birthtimeMs` is unreliable: several Linux filesystems and container overlay
 * mounts report 0 or the epoch, which would make every workspace look ancient
 * and turn the age guard off entirely. `mtimeMs` is the fallback because a
 * compile workspace is written continuously while it is in use, so its mtime is
 * a *better* liveness signal than its birth time anyway.
 */
function entryTimestamp(stats) {
  const birth = stats.birthtimeMs;
  if (Number.isFinite(birth) && birth > 0) {
    return birth;
  }
  return stats.mtimeMs;
}

/**
 * Recursive size of a directory, in bytes.
 *
 * Counts `size` rather than `blocks * 512`: apparent size is what a quota
 * expressed in bytes means to whoever configured it, and block accounting
 * would surprise anyone comparing the number against `du -h --apparent-size`.
 *
 * Unreadable entries are skipped rather than failing the walk — a workspace
 * being torn down concurrently is expected, and a single `ENOENT` must not
 * abort accounting for the whole root.
 */
export async function directorySize(dirPath, depth = 0) {
  // Compile workspaces nest a few levels (crate/src, target/wasm32-.../release).
  // A bound stops a symlink loop from walking forever.
  if (depth > 12) return 0;

  let total = 0;
  let entries;
  try {
    entries = await fsp.readdir(dirPath, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    try {
      if (entry.isDirectory()) {
        total += await directorySize(full, depth + 1);
      } else if (entry.isFile()) {
        const stats = await fsp.stat(full);
        total += stats.size;
      }
      // Symlinks are deliberately not followed — a link into the cargo registry
      // would otherwise be counted as workspace usage, and following one out of
      // the temp root is how a cleanup worker deletes something it shouldn't.
    } catch {
      // Entry vanished mid-walk; skip it.
    }
  }

  return total;
}

/**
 * Lists compile workspaces with their size and age, oldest first.
 */
export async function listWorkspaces(tempRoot = getCompileTempRoot()) {
  const prefix = getCompileTempPrefix();
  let entries;

  try {
    entries = await fsp.readdir(tempRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const workspaces = [];
  let scanned = 0;

  for (const entry of entries) {
    if (scanned >= QUOTA_MAX_SCAN_ENTRIES) break;
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;
    scanned += 1;

    const dirPath = path.join(tempRoot, entry.name);
    try {
      const stats = await fsp.stat(dirPath);
      workspaces.push({
        path: dirPath,
        name: entry.name,
        createdAt: entryTimestamp(stats),
        sizeBytes: await directorySize(dirPath),
      });
    } catch {
      // Vanished between readdir and stat.
    }
  }

  workspaces.sort((a, b) => a.createdAt - b.createdAt);
  return workspaces;
}

/** Current usage of the compile temp root. */
export async function getUsage(tempRoot = getCompileTempRoot()) {
  const workspaces = await listWorkspaces(tempRoot);
  const totalBytes = workspaces.reduce((sum, w) => sum + w.sizeBytes, 0);

  return {
    tempRoot,
    workspaceCount: workspaces.length,
    totalBytes,
    highWaterBytes: QUOTA_HIGH_WATER_BYTES,
    lowWaterBytes: QUOTA_LOW_WATER_BYTES,
    overQuota: totalBytes > QUOTA_HIGH_WATER_BYTES,
    utilisation:
      QUOTA_HIGH_WATER_BYTES > 0 ? totalBytes / QUOTA_HIGH_WATER_BYTES : 0,
  };
}

function formatBytes(bytes) {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/**
 * Evicts oldest-first until usage is under the low-water mark.
 *
 * A no-op when under the high-water mark — this does not run on every tick's
 * worth of normal usage, only when the root has actually grown past its budget.
 *
 * @returns a summary of what was evicted, for logging and tests
 */
export async function enforceQuota({
  tempRoot = getCompileTempRoot(),
  now = Date.now(),
  logger = console,
} = {}) {
  const workspaces = await listWorkspaces(tempRoot);
  let totalBytes = workspaces.reduce((sum, w) => sum + w.sizeBytes, 0);

  const result = {
    tempRoot,
    startBytes: totalBytes,
    endBytes: totalBytes,
    evicted: [],
    skippedTooYoung: 0,
    errors: 0,
    triggered: false,
  };

  if (totalBytes <= QUOTA_HIGH_WATER_BYTES) {
    return result;
  }

  result.triggered = true;
  logger.warn(
    `[quota] ${tempRoot} at ${formatBytes(totalBytes)} exceeds high-water ${formatBytes(
      QUOTA_HIGH_WATER_BYTES
    )} — evicting oldest workspaces down to ${formatBytes(QUOTA_LOW_WATER_BYTES)}`
  );

  for (const workspace of workspaces) {
    if (totalBytes <= QUOTA_LOW_WATER_BYTES) break;

    if (now - workspace.createdAt < QUOTA_MIN_AGE_MS) {
      // Oldest-first is a proxy for "not in use"; this guard is what stops the
      // proxy from deleting a live build. Because the list is sorted oldest
      // first, everything after this is younger too.
      result.skippedTooYoung += 1;
      break;
    }

    try {
      await fsp.rm(workspace.path, { recursive: true, force: true });
      totalBytes -= workspace.sizeBytes;
      result.evicted.push({
        path: workspace.path,
        sizeBytes: workspace.sizeBytes,
        ageMs: now - workspace.createdAt,
      });
      logger.log(
        `[quota] evicted ${workspace.name} (${formatBytes(workspace.sizeBytes)})`
      );
    } catch (err) {
      result.errors += 1;
      logger.error(`[quota] failed to evict ${workspace.path}: ${err.message}`);
    }
  }

  result.endBytes = totalBytes;

  if (totalBytes > QUOTA_HIGH_WATER_BYTES) {
    // Said explicitly rather than left as a silently-unmet target: this is the
    // deliberate trade described at QUOTA_MIN_AGE_MS, and an operator seeing
    // sustained over-quota needs to know it is the age guard holding, not a
    // broken sweeper.
    logger.warn(
      `[quota] still over quota at ${formatBytes(totalBytes)} — ` +
        `${result.skippedTooYoung > 0 ? 'remaining workspaces are too young to evict safely' : 'nothing left to evict'}`
    );
  } else {
    logger.log(
      `[quota] reclaimed ${formatBytes(result.startBytes - totalBytes)} across ${result.evicted.length} workspace(s)`
    );
  }

  return result;
}

export const quotaConfig = {
  highWaterBytes: QUOTA_HIGH_WATER_BYTES,
  lowWaterBytes: QUOTA_LOW_WATER_BYTES,
  minAgeMs: QUOTA_MIN_AGE_MS,
  maxScanEntries: QUOTA_MAX_SCAN_ENTRIES,
};
