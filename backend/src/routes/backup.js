// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { Router } from 'express';
import {
  runBackup,
  getLastBackupResult,
  runWalGBaseBackup,
  getWalGStatus,
  restoreToTimestamp,
  runRestoreDrill,
} from '../services/backupService.js';

const router = Router();

/**
 * POST /api/backup/trigger
 * Manually trigger a backup. Returns immediately with 202 while the backup runs,
 * or 200 once complete (depends on the timeout of the caller).
 */
router.post('/trigger', async (_req, res) => {
  try {
    const result = await runBackup();
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/backup/status
 * Returns the result of the most recent backup attempt (success or failure).
 */
router.get('/status', (_req, res) => {
  const last = getLastBackupResult();
  if (!last) {
    return res.status(200).json({
      success: true,
      data: {
        status: 'no_backup_yet',
        message: 'No backup has run in this process lifetime.',
      },
    });
  }
  return res.status(200).json({ success: true, data: last });
});

/**
 * POST /api/backup/walg/base
 * Trigger a WAL-G full base backup (encrypted, uploaded to object storage).
 */
router.post('/walg/base', async (_req, res) => {
  try {
    const result = await runWalGBaseBackup();
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/backup/walg/status
 * Returns WAL archiving status including lag and Prometheus-style alert state.
 */
router.get('/walg/status', async (_req, res) => {
  try {
    const status = await getWalGStatus();
    return res.status(200).json({ success: true, data: status });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/backup/walg/restore
 * Restore the database to a specific point in time (PITR).
 * Body: { targetTime: ISO8601 string, targetName?: string }
 */
router.post('/walg/restore', async (req, res) => {
  const { targetTime, targetName } = req.body || {};
  if (!targetTime || Number.isNaN(Date.parse(targetTime))) {
    return res.status(400).json({
      success: false,
      error: 'A valid ISO8601 targetTime is required.',
    });
  }
  try {
    const result = await restoreToTimestamp(targetTime, targetName);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/backup/walg/drill
 * Run an isolated restore drill with integrity verification.
 */
router.post('/walg/drill', async (_req, res) => {
  try {
    const result = await runRestoreDrill();
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
