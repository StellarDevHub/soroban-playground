// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import cron from 'node-cron';
import { runBackup } from './backupService.js';
import logger from '../utils/logger.js';
import { alertManager } from '../utils/alerting.js';

// Daily at 02:00 server time — low-traffic window, avoids midnight log spikes.
const DEFAULT_SCHEDULE = process.env.BACKUP_CRON_SCHEDULE || '0 2 * * *';

let _task = null;

export function startBackupScheduler(schedule = DEFAULT_SCHEDULE) {
  if (!process.env.BACKUP_ENABLED || process.env.BACKUP_ENABLED === 'false') {
    logger.info(
      JSON.stringify({
        level: 'info',
        msg: 'backup:scheduler:disabled',
        hint: 'Set BACKUP_ENABLED=true to enable automated backups',
      })
    );
    return null;
  }

  if (_task) {
    logger.info(JSON.stringify({ level: 'info', msg: 'backup:scheduler:already_running' }));
    return _task;
  }

  if (!cron.validate(schedule)) {
    throw new Error(`Invalid backup cron expression: "${schedule}"`);
  }

  logger.info(
    JSON.stringify({ level: 'info', msg: 'backup:scheduler:start', schedule })
  );

  _task = cron.schedule(schedule, async () => {
    logger.info(JSON.stringify({ level: 'info', msg: 'backup:scheduler:triggered' }));
    try {
      const result = await runBackup();
      logger.info(
        JSON.stringify({ level: 'info', msg: 'backup:scheduler:success', s3Key: result.s3Key })
      );
    } catch (err) {
      logger.error(
        JSON.stringify({ level: 'error', msg: 'backup:scheduler:error', error: err.message })
      );
      alertManager.alert('scheduled_backup_failed', { error: err.message });
    }
  });

  return _task;
}

export function stopBackupScheduler() {
  if (_task) {
    _task.stop();
    _task = null;
    logger.info(JSON.stringify({ level: 'info', msg: 'backup:scheduler:stopped' }));
  }
}
