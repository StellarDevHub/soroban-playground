// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// Batch-friendly data access for the `templates` table.
// JSON columns (tags, dependencies, functionalities, features) are parsed into
// arrays on read so GraphQL resolvers never have to touch raw SQL strings.

import { getDatabase } from '../database/connection.js';

function parseJsonArray(value) {
  if (value == null) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function shapeTemplate(row) {
  if (!row) return null;
  return {
    id: row.id,
    dirName: row.dir_name,
    name: row.name,
    description: row.description,
    category: row.category,
    complexity: row.complexity,
    deploymentStatus: row.deployment_status,
    tags: parseJsonArray(row.tags),
    dependencies: parseJsonArray(row.dependencies),
    functionalities: parseJsonArray(row.functionalities),
    features: parseJsonArray(row.features),
    createdAt: row.created_at,
  };
}

/**
 * Returns all templates ordered by id. Single SQL query.
 */
export async function listTemplates() {
  const db = getDatabase();
  const rows = await db.all('SELECT * FROM templates ORDER BY id ASC');
  return rows.map(shapeTemplate);
}

/**
 * Batch-loads templates by id. One SQL query regardless of how many ids are
 * passed. Returns a Map<number, template> keyed by template id.
 */
export async function getTemplatesByIds(ids) {
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const db = getDatabase();
  const rows = await db.all(
    `SELECT * FROM templates WHERE id IN (${placeholders})`,
    ids
  );
  const byId = new Map();
  for (const row of rows) {
    byId.set(String(row.id), shapeTemplate(row));
  }
  return byId;
}
