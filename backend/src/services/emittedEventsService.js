import { getDatabase } from '../database/connection.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parseInteger(value, name, { min } = {}) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${name} must be an integer`);
  }
  if (min !== undefined && parsed < min) {
    throw new Error(`${name} must be >= ${min}`);
  }
  return parsed;
}

function parseLimit(value) {
  const parsed = parseInteger(value, 'limit', { min: 1 });
  if (!parsed) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function parseText(value) {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeEventData(row) {
  if (typeof row.value === 'string' && row.value.length > 0) {
    return row.value;
  }
  if (row.value && typeof row.value === 'object') {
    return JSON.stringify(row.value);
  }
  return '{}';
}

function mapDbRowToFrontendEvent(row) {
  return {
    type: 'event',
    id: String(row.id),
    contract_id: row.contract_id,
    ledger: row.ledger_sequence,
    ledger_closed_at: row.indexed_at || new Date(0).toISOString(),
    event_type: row.event_type || 'contract',
    data: normalizeEventData(row),
    topics: row.topics,
    raw_xdr: row.raw_xdr,
  };
}

function buildQuery(filters) {
  const where = [];
  const params = [];

  if (filters.contractId) {
    where.push('contract_id = ?');
    params.push(filters.contractId);
  }
  if (filters.eventType) {
    where.push('event_type = ?');
    params.push(filters.eventType);
  }
  if (filters.startLedger !== undefined) {
    where.push('ledger_sequence >= ?');
    params.push(filters.startLedger);
  }
  if (filters.endLedger !== undefined) {
    where.push('ledger_sequence <= ?');
    params.push(filters.endLedger);
  }
  if (filters.cursor !== undefined) {
    where.push('id < ?');
    params.push(filters.cursor);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `
    SELECT id, contract_id, ledger_sequence, topics, value, raw_xdr, event_type, indexed_at
    FROM contract_events
    ${whereClause}
    ORDER BY id DESC
    LIMIT ?
  `
    .trim()
    .replace(/\s+/g, ' ');
  params.push(filters.limit);

  return { sql, params };
}

export function parseEmittedEventsQuery(query = {}) {
  return {
    contractId: parseText(query.contract_id ?? query.contractId),
    eventType: parseText(query.event_type ?? query.eventType),
    startLedger: parseInteger(
      query.start_ledger ?? query.startLedger,
      'start_ledger',
      { min: 0 }
    ),
    endLedger: parseInteger(query.end_ledger ?? query.endLedger, 'end_ledger', {
      min: 0,
    }),
    cursor: parseInteger(query.cursor, 'cursor', { min: 1 }),
    limit: parseLimit(query.limit),
  };
}

export async function listEmittedEvents(rawQuery = {}, db = getDatabase()) {
  const query = parseEmittedEventsQuery(rawQuery);
  if (
    query.startLedger !== undefined &&
    query.endLedger !== undefined &&
    query.startLedger > query.endLedger
  ) {
    throw new Error('start_ledger must be less than or equal to end_ledger');
  }

  const { sql, params } = buildQuery(query);

  try {
    const rows = await db.all(sql, params);
    const events = rows.map(mapDbRowToFrontendEvent);
    const nextCursor =
      events.length === query.limit ? events[events.length - 1].id : null;

    return {
      events,
      pageInfo: {
        nextCursor,
        hasMore: nextCursor !== null,
      },
      filters: query,
    };
  } catch (error) {
    // Keep endpoint backward-compatible when migrations haven't run yet.
    if (/no such table:\s*contract_events/i.test(error.message || '')) {
      return {
        events: [],
        pageInfo: {
          nextCursor: null,
          hasMore: false,
        },
        filters: query,
      };
    }
    throw error;
  }
}
