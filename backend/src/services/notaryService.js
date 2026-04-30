// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import DatabaseService from './databaseService.js';

const db = new DatabaseService();

async function ensureTable() {
  await db.connect();
  await db.run(`
    CREATE TABLE IF NOT EXISTS notary_records (
      file_hash TEXT PRIMARY KEY,
      owner     TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      metadata  TEXT NOT NULL,
      verified  INTEGER NOT NULL DEFAULT 1,
      record_id INTEGER NOT NULL
    )
  `);
}

const _init = ensureTable();

/**
 * Notarize a file: call Soroban contract (stubbed) and cache in DB.
 * @param {string} fileHash  64-char hex string
 * @param {string} metadata  arbitrary string
 * @param {string} callerAddress  Stellar address
 * @returns {{ recordId: number, timestamp: number }}
 */
export async function notarizeFile(fileHash, metadata, callerAddress) {
  await _init;

  const existing = await db.get(
    'SELECT file_hash FROM notary_records WHERE file_hash = ?',
    [fileHash]
  );
  if (existing) {
    const err = new Error('File already notarized');
    err.statusCode = 409;
    throw err;
  }

  // In production this would invoke the Soroban contract via CLI.
  // We use the current Unix timestamp as the record_id (mirrors contract behaviour).
  const timestamp = Math.floor(Date.now() / 1000);
  const recordId = timestamp;

  await db.run(
    `INSERT INTO notary_records (file_hash, owner, timestamp, metadata, verified, record_id)
     VALUES (?, ?, ?, ?, 1, ?)`,
    [fileHash, callerAddress, timestamp, metadata, recordId]
  );

  return { recordId, timestamp };
}

/**
 * Verify a file: read from cache first, fall back to contract if not cached.
 * @param {string} fileHash
 * @returns {object} NotaryRecord
 */
export async function verifyFile(fileHash) {
  await _init;

  const row = await db.get(
    'SELECT * FROM notary_records WHERE file_hash = ?',
    [fileHash]
  );

  if (!row) {
    const err = new Error('File not found');
    err.statusCode = 404;
    throw err;
  }

  return {
    fileHash: row.file_hash,
    owner: row.owner,
    timestamp: row.timestamp,
    metadata: row.metadata,
    verified: row.verified === 1,
    recordId: row.record_id,
  };
}

/**
 * Revoke a notarization: call contract and update cache.
 * @param {string} fileHash
 * @param {string} callerAddress
 */
export async function revokeNotarization(fileHash, callerAddress) {
  await _init;

  const row = await db.get(
    'SELECT owner FROM notary_records WHERE file_hash = ?',
    [fileHash]
  );

  if (!row) {
    const err = new Error('File not found');
    err.statusCode = 404;
    throw err;
  }

  if (row.owner !== callerAddress) {
    const err = new Error('Unauthorized');
    err.statusCode = 403;
    throw err;
  }

  await db.run(
    'UPDATE notary_records SET verified = 0 WHERE file_hash = ?',
    [fileHash]
  );
}

/**
 * Return paginated list of notarizations.
 * @param {number} page   1-based
 * @param {number} limit  records per page
 * @returns {{ records: object[], total: number, page: number, limit: number }}
 */
export async function listNotarizations(page = 1, limit = 20) {
  await _init;

  const offset = (page - 1) * limit;
  const [rows, countRow] = await Promise.all([
    db.all(
      'SELECT * FROM notary_records ORDER BY timestamp DESC LIMIT ? OFFSET ?',
      [limit, offset]
    ),
    db.get('SELECT COUNT(*) as total FROM notary_records'),
  ]);

  return {
    records: rows.map((r) => ({
      fileHash: r.file_hash,
      owner: r.owner,
      timestamp: r.timestamp,
      metadata: r.metadata,
      verified: r.verified === 1,
      recordId: r.record_id,
    })),
    total: countRow?.total ?? 0,
    page,
    limit,
  };
}
