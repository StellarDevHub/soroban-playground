// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { getDatabase } from '../database/connection.js';

export async function listOrigins() {
  const db = getDatabase();
  return db.all(
    'SELECT id, origin, added_by, created_at FROM cors_whitelist WHERE active = 1 ORDER BY created_at DESC'
  );
}

export async function addOrigin(origin, addedBy = null) {
  const db = getDatabase();
  await db.run(
    `INSERT INTO cors_whitelist (origin, added_by)
     VALUES (?, ?)
     ON CONFLICT(origin) DO UPDATE SET active = 1, added_by = excluded.added_by`,
    [origin, addedBy]
  );
  return db.get('SELECT * FROM cors_whitelist WHERE origin = ?', [origin]);
}

export async function removeOrigin(origin) {
  const db = getDatabase();
  const { changes } = await db.run(
    'UPDATE cors_whitelist SET active = 0 WHERE origin = ? AND active = 1',
    [origin]
  );
  return changes > 0;
}

// Loads the active origin list for use in dynamic CORS validation
export async function loadActiveOrigins() {
  const db = getDatabase();
  const rows = await db.all(
    'SELECT origin FROM cors_whitelist WHERE active = 1'
  );
  return rows.map((r) => r.origin);
}
