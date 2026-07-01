// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// Batch-friendly data access for the `projects` table.
// Each function maps directly to a single SQL query so DataLoader can coalesce
// per-id `.load()` calls into one round-trip (issue #724).

import { getDatabase } from '../database/connection.js';

function parseTags(row) {
  if (!row || row.tags == null) return [];
  try {
    const parsed = JSON.parse(row.tags);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function shapeProject(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    status: row.status,
    creatorId: row.creator_id,
    creatorName: row.creator_name,
    fundingGoal: row.funding_goal,
    currentFunding: row.current_funding,
    completionRate: row.completion_rate,
    tags: parseTags(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Returns all projects ordered by id. Single SQL query.
 */
export async function listProjects() {
  const db = getDatabase();
  const rows = await db.all('SELECT * FROM projects ORDER BY id ASC');
  return rows.map(shapeProject);
}

/**
 * Batch-loads projects by id. One SQL query regardless of how many ids are
 * passed. Returns a Map<number, project> so DataLoader can re-key by input id.
 */
export async function getProjectsByIds(ids) {
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const db = getDatabase();
  const rows = await db.all(
    `SELECT * FROM projects WHERE id IN (${placeholders})`,
    ids
  );
  const byId = new Map();
  for (const row of rows) {
    byId.set(String(row.id), shapeProject(row));
  }
  return byId;
}
