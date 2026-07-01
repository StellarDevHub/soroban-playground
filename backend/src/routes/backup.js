// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { Router } from 'express';
import { runBackup, getLastBackupResult } from '../services/backupService.js';

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
      data: { status: 'no_backup_yet', message: 'No backup has run in this process lifetime.' },
    });
  }
  return res.status(200).json({ success: true, data: last });
});

export default router;
