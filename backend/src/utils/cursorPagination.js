// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// Cursor-based pagination utilities (issue #737).
//
// Cursors are opaque, Base64-encoded JSON snapshots of a row's sort-key values
// plus its `id` (the stable tiebreaker). Pages are fetched with WHERE comparison
// operators — never OFFSET — so concurrent inserts/deletes never shift a page
// boundary, and the database can serve each page from an index seek instead of
// counting and discarding rows.
//
// Contract: sort fields must be NOT NULL (the always-appended `id` tiebreaker is
// guaranteed non-null). NULLs in a leading sort column would make tuple
// comparisons evaluate to UNKNOWN and silently drop rows, so callers paginate on
// indexed, non-nullable columns + the primary key.

const ID_FIELD = 'id';

// Sort fields are interpolated into SQL as identifiers (they cannot be bound as
// parameters), so they must be validated against a strict allowlist pattern —
// the same guard QueryBuilder applies to filter columns — to prevent injection.
const SAFE_IDENTIFIER = /^[a-zA-Z0-9_]+$/;

function assertSafeIdentifier(field) {
  if (typeof field !== 'string' || !SAFE_IDENTIFIER.test(field)) {
    throw new Error(`Invalid sort field: ${field}`);
  }
  return field;
}

/**
 * Normalizes a sort spec to `[{ field, direction }]` and guarantees a unique,
 * non-null tiebreaker (`id ASC`) is the last key so ordering — and therefore the
 * cursor — is always deterministic. Throws on an unsafe field identifier.
 */
export function normalizeSort(sort = []) {
  const list = Array.isArray(sort) ? sort : [];
  const normalized = list
    .filter((s) => s && s.field)
    .map((s) => ({
      field: assertSafeIdentifier(s.field),
      direction:
        String(s.direction || s.order || 'ASC').toUpperCase() === 'DESC'
          ? 'DESC'
          : 'ASC',
    }));

  if (!normalized.some((s) => s.field === ID_FIELD)) {
    normalized.push({ field: ID_FIELD, direction: 'ASC' });
  }
  return normalized;
}

/**
 * Encodes a map of sort-key values into an opaque cursor string.
 */
export function encodeCursor(keys) {
  if (!keys || typeof keys !== 'object' || Array.isArray(keys)) {
    throw new TypeError('encodeCursor expects an object of sort-key values');
  }
  return Buffer.from(JSON.stringify(keys), 'utf8').toString('base64');
}

/**
 * Decodes an opaque cursor back into its sort-key map. Throws a clear error on
 * any malformed input so a bad cursor surfaces as a 400, not a 500.
 */
export function decodeCursor(cursor) {
  if (typeof cursor !== 'string' || cursor.length === 0) {
    throw new TypeError('Invalid cursor: expected a non-empty string');
  }

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
  } catch {
    throw new Error('Invalid cursor: not decodable');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid cursor: malformed payload');
  }
  return parsed;
}

/**
 * Builds the opaque cursor for a row given the active sort.
 */
export function cursorForRow(row, sort) {
  const keys = {};
  for (const { field } of normalizeSort(sort)) {
    keys[field] = row[field];
  }
  return encodeCursor(keys);
}

/**
 * Builds the WHERE fragment that selects the rows *after* a cursor, using
 * explicit per-column OR-expansion so mixed ASC/DESC sorts are correct. For a
 * sort of `created_at DESC, id ASC` and cursor values `{ created_at: C, id: I }`
 * this yields: `(created_at < ?) OR (created_at = ? AND id > ?)`.
 *
 * @param {object}   opts
 * @param {Array}    opts.sort         sort spec (id tiebreaker appended automatically)
 * @param {string}   [opts.cursor]     opaque cursor; falsy → empty clause
 * @param {number}   [opts.paramOffset] index of the last param already bound (for $N styles)
 * @param {Function} [opts.placeholder] (paramIndex) => placeholder string; defaults to `?`
 * @returns {{ clause: string, params: any[] }}
 */
export function buildCursorClause({
  sort,
  cursor,
  paramOffset = 0,
  placeholder = () => '?',
} = {}) {
  if (!cursor) return { clause: '', params: [] };

  const keys = decodeCursor(cursor);
  const order = normalizeSort(sort);
  const params = [];
  const ors = [];

  for (let i = 0; i < order.length; i++) {
    const ands = [];

    // Equality on every preceding column.
    for (let j = 0; j < i; j++) {
      const f = order[j].field;
      params.push(keys[f]);
      ands.push(`${f} = ${placeholder(paramOffset + params.length)}`);
    }

    // Strict comparison on the i-th column (direction-aware).
    const { field, direction } = order[i];
    const cmp = direction === 'DESC' ? '<' : '>';
    params.push(keys[field]);
    ands.push(`${field} ${cmp} ${placeholder(paramOffset + params.length)}`);

    ors.push(ands.length > 1 ? `(${ands.join(' AND ')})` : ands[0]);
  }

  const clause = ors.length > 1 ? `(${ors.join(' OR ')})` : ors[0];
  return { clause, params };
}

/**
 * Builds the connection payload (edges + pageInfo) from an *over-fetched* row
 * set. Callers query `limit + 1` rows; the extra row signals `hasNextPage` and
 * is trimmed from the page.
 *
 * `hasPreviousPage` reflects whether the request carried a cursor — a
 * forward-only cursor can't detect prior rows without a second (backward) query,
 * so this is the pragmatic, documented semantic.
 *
 * @returns {{ edges: Array, pageInfo: object }}
 */
export function buildPageInfo(rows, limit, sort, cursor = null) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const hasNextPage = safeRows.length > limit;
  const pageRows = hasNextPage ? safeRows.slice(0, limit) : safeRows;

  const edges = pageRows.map((node) => ({
    cursor: cursorForRow(node, sort),
    node,
  }));

  return {
    edges,
    pageInfo: {
      hasNextPage,
      hasPreviousPage: cursor != null,
      startCursor: edges.length ? edges[0].cursor : null,
      endCursor: edges.length ? edges[edges.length - 1].cursor : null,
    },
  };
}
