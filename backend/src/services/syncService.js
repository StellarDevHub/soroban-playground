// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { getDatabase } from '../database/connection.js';

export const SYNC_STATUS = {
  PENDING: 'pending',
  APPLIED: 'applied',
  CONFLICT: 'conflict',
  ERROR: 'error',
};

/**
 * Process an array of offline transaction logs from a client.
 * Uses last-write-wins conflict resolution based on client_timestamp.
 * Returns a batch report with per-entry results.
 *
 * @param {Array<{table: string, record_id: string, operation: string, payload: object, client_timestamp: string}>} entries
 * @returns {{ applied: number, skipped: number, errors: Array<{index: number, record_id: string, reason: string}> }}
 */
export async function processSyncBatch(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { applied: 0, skipped: 0, errors: [] };
  }

  const db = await getDatabase();
  let applied = 0;
  let skipped = 0;
  const errors = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    try {
      validateEntry(entry);
      const result = await applySyncEntry(db, entry);
      if (result === 'applied') applied++;
      else skipped++;
    } catch (err) {
      errors.push({ index: i, record_id: entry?.record_id ?? null, reason: err.message });
    }
  }

  return { applied, skipped, errors };
}

function validateEntry(entry) {
  if (!entry || typeof entry !== 'object') throw new Error('Entry must be an object');
  if (!entry.table || typeof entry.table !== 'string') throw new Error('Missing or invalid table');
  if (!entry.record_id || typeof entry.record_id !== 'string') throw new Error('Missing or invalid record_id');
  if (!['insert', 'update', 'delete'].includes(entry.operation)) {
    throw new Error(`Invalid operation: ${entry.operation}`);
  }
  if (!entry.client_timestamp || isNaN(Date.parse(entry.client_timestamp))) {
    throw new Error('Missing or invalid client_timestamp (ISO 8601 required)');
  }
  if (entry.operation !== 'delete' && (!entry.payload || typeof entry.payload !== 'object')) {
    throw new Error('Payload required for insert/update operations');
  }
}

async function applySyncEntry(db, entry) {
  const { table, record_id, operation, payload, client_timestamp } = entry;

  // Check for an existing sync log for this record to apply last-write-wins
  const existing = await db.get(
    'SELECT client_timestamp FROM sync_logs WHERE table_name = ? AND record_id = ? AND status = ?',
    [table, record_id, SYNC_STATUS.APPLIED]
  );

  if (existing) {
    const existingTs = new Date(existing.client_timestamp).getTime();
    const incomingTs = new Date(client_timestamp).getTime();
    if (incomingTs <= existingTs) {
      // Incoming is older or same — skip (last-write-wins)
      await db.run(
        `INSERT INTO sync_logs (table_name, record_id, operation, payload, client_timestamp, status, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [table, record_id, operation, JSON.stringify(payload ?? {}), client_timestamp, SYNC_STATUS.CONFLICT, 'Skipped: newer record already applied']
      );
      return 'skipped';
    }
  }

  // Apply the operation
  await applyOperation(db, table, record_id, operation, payload);

  await db.run(
    `INSERT INTO sync_logs (table_name, record_id, operation, payload, client_timestamp, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [table, record_id, operation, JSON.stringify(payload ?? {}), client_timestamp, SYNC_STATUS.APPLIED]
  );

  return 'applied';
}

// Allowlist of tables that can be mutated via sync to prevent arbitrary table writes.
const SYNCABLE_TABLES = new Set(['favorites', 'feature_flags', 'sync_logs']);

function assertSyncable(table) {
  if (!SYNCABLE_TABLES.has(table)) {
    throw new Error(`Table '${table}' is not syncable`);
  }
}

async function applyOperation(db, table, record_id, operation, payload) {
  assertSyncable(table);

  if (operation === 'delete') {
    await db.run(`DELETE FROM ${table} WHERE id = ?`, [record_id]);
    return;
  }

  const columns = Object.keys(payload);
  if (!columns.length) throw new Error('Payload has no fields');

  if (operation === 'insert') {
    const placeholders = columns.map(() => '?').join(', ');
    await db.run(
      `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
      columns.map((c) => payload[c])
    );
  } else if (operation === 'update') {
    const setClause = columns.map((c) => `${c} = ?`).join(', ');
    await db.run(
      `UPDATE ${table} SET ${setClause} WHERE id = ?`,
      [...columns.map((c) => payload[c]), record_id]
    );
  }
}

/**
 * Return all sync log entries for a given table/record.
 */
export async function getSyncHistory(table, record_id) {
  const db = await getDatabase();
  return db.all(
    'SELECT * FROM sync_logs WHERE table_name = ? AND record_id = ? ORDER BY synced_at DESC',
    [table, record_id]
  );
}

/**
 * Return pending sync entries (useful for retry queues).
 */
export async function getPendingEntries() {
  const db = await getDatabase();
  return db.all(
    "SELECT * FROM sync_logs WHERE status = 'pending' ORDER BY client_timestamp ASC"
  );
}
