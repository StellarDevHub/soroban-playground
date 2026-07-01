// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// Batch-friendly data access for the `files` table.
// `getFilesByProjectIds` and `getFilesByTemplateIds` issue a single SQL query
// for N parent ids and group rows in JS — the core pattern that lets DataLoader
// collapse an N+1 fan-out into 2 total queries (issue #724).

import { getDatabase } from '../database/connection.js';

function shapeFile(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id ?? null,
    templateId: row.template_id ?? null,
    uploaderId: row.uploader_id,
    filename: row.filename,
    filepath: row.filepath,
    mimetype: row.mimetype,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  };
}

/**
 * Returns all files ordered by id. Single SQL query.
 */
export async function listFiles() {
  const db = getDatabase();
  const rows = await db.all('SELECT * FROM files ORDER BY id ASC');
  return rows.map(shapeFile);
}

/**
 * Batch-loads files by id. One SQL query regardless of how many ids are passed.
 * Returns a Map<number, file> keyed by file id.
 */
export async function getFilesByIds(ids) {
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const db = getDatabase();
  const rows = await db.all(
    `SELECT * FROM files WHERE id IN (${placeholders})`,
    ids
  );
  const byId = new Map();
  for (const row of rows) {
    byId.set(String(row.id), shapeFile(row));
  }
  return byId;
}

/**
 * Returns a Map<projectId, File[]> from a single SQL query.
 * Parents with no files get an empty array entry, so DataLoader returns `[]`
 * (not null) to GraphQL — matching the `files: [File!]!` schema contract.
 */
export async function getFilesByProjectIds(projectIds) {
  if (!projectIds.length) return new Map();
  const placeholders = projectIds.map(() => '?').join(',');
  const db = getDatabase();
  const rows = await db.all(
    `SELECT * FROM files WHERE project_id IN (${placeholders}) ORDER BY id ASC`,
    projectIds
  );
  const byProject = new Map();
  for (const id of projectIds) byProject.set(String(id), []);
  for (const row of rows) {
    const shaped = shapeFile(row);
    const list = byProject.get(String(row.project_id));
    if (list) list.push(shaped);
  }
  return byProject;
}

/**
 * Returns a Map<templateId, File[]> from a single SQL query.
 */
export async function getFilesByTemplateIds(templateIds) {
  if (!templateIds.length) return new Map();
  const placeholders = templateIds.map(() => '?').join(',');
  const db = getDatabase();
  const rows = await db.all(
    `SELECT * FROM files WHERE template_id IN (${placeholders}) ORDER BY id ASC`,
    templateIds
  );
  const byTemplate = new Map();
  for (const id of templateIds) byTemplate.set(String(id), []);
  for (const row of rows) {
    const shaped = shapeFile(row);
    const list = byTemplate.get(String(row.template_id));
    if (list) list.push(shaped);
  }
  return byTemplate;
}
