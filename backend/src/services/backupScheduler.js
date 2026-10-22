// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import cron from 'node-cron';
import { runBackup } from './backupService.js';
import logger from '../utils/logger.js';
import { alertManager } from '../utils/alerting.js';

// Daily at 02:00 server time — low-traffic window, avoids midnight log spikes.
const DEFAULT_SCHEDULE = process.env.BACKUP_CRON_SCHEDULE || '0 2 * * *';
// Weekly restore drill — Sunday 03:00 server time.
const DEFAULT_DRILL_SCHEDULE = process.env.BACKUP_DRILL_CRON_SCHEDULE || '0 3 * * 0';

const WAL_LAG_THRESHOLD = Number.parseInt(
  process.env.WAL_LAG_THRESHOLD_SEGMENTS || '3',
  10
);

let _task = null;
let _drillTask = null;

function _log (level, msg, extra = {}) {
  const payload = { level, msg, ...extra };
  if (level === 'error') {
    logger.error(JSON.stringify(payload));
  } else if (level === 'warn') {
    logger.warn ? logger.warn(JSON.stringify(payload)) : logger.info(JSON.stringify(payload));
  } else {
    logger.info(JSON.stringify(payload));
  }
}

/**
 * Runs the WAL-G WEAL archive lag check and emits a Prometheus alert
 * if archiving has fallen behind by more than the configured threshold of
 * consecutive segments. This is called after every backup run and on a
 * dedicated interval via the WAL-G scripts.
 */
export async function checkWalArchiveLag () {
  try {
    const { checkWalLag } = await import('./backupService.js');
    if (typeof checkWalLag !== 'function') {
      _log('warn', 'backup:wal_lag:check_unavailable');
      return { lagged: false };
    }
    const result = await checkWalLag();
    const lag = Number(result?.lagSegments ?? 0);
    if (lag > WAL_LAG_THRESHOLD) {
      _log('error', 'backup:wal_lag:exceeded', {
        lagSegments: lag,
        threshold: WAL_LAG_THRESHOLD,
      });
      alertManager.alert('wal_archive_lag_exceeded', {
        lagSegments: lag,
        threshold: WAL_LAG_THRESHOLD,
        lastArchivedSegment: result?.lastArchivedSegment,
        lastArchivedAt: result?.lastArchivedAt,
      });
      return { lagged: true, lagSegments: lag };
    }
    _log('info', 'backup:wal_lag:ok', { lagSegments: lag });
    return { lagged: false, lagSegments: lag };
  } catch (err) {
    _log('error', 'backup:wal_lag:error', { error: err.message });
    alertManager.alert('wal_archive_lag_check_failed', { error: err.message });
    return { lagged: true, error: err.message };
  }
}

/**
 * Runs the weekly restore drill in an isolated test environment and
 * verifies integrity of the restored database.
 */
export async function runRestoreDrill () {
  _log('info', 'backup:drill:triggered');
  try {
    const mod = await import('./backupService.js');
    if (typeof mod.runRestoreDrill !== 'function') {
      _log('warn', 'backup:drill:unavailable');
      return null;
    }
    const result = await mod.runRestoreDrill();
    _log('info', 'backup:drill:success', {
      verified: result?.verified,
      restoredAt: result?.restoredAt,
    });
    return result;
  } catch (err) {
    _log('error', 'backup:drill:error', { error: err.message });
    alertManager.alert('restore_drill_failed', { error: err.message });
    throw err;
  }
}

export function startBackupScheduler (schedule = DEFAULT_SCHEDULE) {
  if (!process.env.BACKUP_ENABLED || process.env.BACKUP_ENABLED === 'false') {
    _log('info', 'backup:scheduler:disabled', {
      hint: 'Set BACKUP_ENABLED=true to enable automated backups',
    });
    return null;
  }

  if (_task) {
    _log('info', 'backup:scheduler:already_running');
    return _task;
  }

  if (!cron.validate(schedule)) {
    throw new Error(`Invalid backup cron expression: "${schedule}"`);
  }

  _log('info', 'backup:scheduler:start', { schedule });

  _task = cron.schedule(schedule, async () => {
    _log('info', 'backup:scheduler:triggered');
    try {
      const result = await runBackup();
      _log('info', 'backup:scheduler:success', {
        s3Key: result?.s3Key,
        encrypted: result?.encrypted,
      });
    } catch (err) {
      _log('error', 'backup:scheduler:error', { error: err.message });
      alertManager.alert('scheduled_backup_failed', { error: err.message });
    } finally {
      // Emit Prometheus alert if WAL archive lag exceeds threshold.
      await checkWalArchiveLag();
    }
  });

  // Schedule weekly restore drill if enabled.
  if (process.env.BACKUP_DRILL_ENABLED !== 'false') {
    if (!cron.validate(DEFAULT_DRILL_SCHEDULE)) {
      _log('error', 'backup:drill:invalid_schedule', {
        schedule: DEFAULT_DRILL_SCHEDULE,
      });
    } else {
      _log('info', 'backup:drill:scheduled', {
        schedule: DEFAULT_DRILL_SCHEDULE,
      });
      _drillTask = cron.schedule(DEFAULT_DRILL_SCHEDULE, async () => {
        try {
          await runRestoreDrill();
        } catch {
          // Alert already emitted inside runRestoreDrill.
        }
      });
    }
  }

  return _task;
}

export function stopBackupScheduler () {
  if (_task) {
    _task.stop();
    _task = null;
    _log('info', 'backup:scheduler:stopped');
  }
  if (_drillTask) {
    _drillTask.stop();
    _drillTask = null;
    _log('info', 'backup:drill:stopped');
  }
}
