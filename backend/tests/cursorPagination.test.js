// Tests for cursor-based pagination (issue #737).
// - Unit: cursor encode/decode, WHERE-clause generation (incl. mixed ASC/DESC),
//   and pageInfo derivation.
// - Integration: paginate a real in-memory SQLite table end-to-end and prove no
//   duplication/skipping across page boundaries, even with a concurrent insert.
// - Route: /api/v1/events/query returns cursor metadata and uses WHERE (no OFFSET).

import { createRequire } from 'module';
import express from 'express';
import request from 'supertest';

import {
  encodeCursor,
  decodeCursor,
  cursorForRow,
  normalizeSort,
  buildCursorClause,
  buildPageInfo,
} from '../src/utils/cursorPagination.js';

const nodeRequire = createRequire(import.meta.url);
const sqlite3 = nodeRequire('sqlite3');
const { open } = nodeRequire('sqlite');

jest.mock('../src/services/cacheService.js', () => ({
  __esModule: true,
  default: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
  },
}));

import eventsRouter from '../src/routes/v1/events.js';

describe('cursor encode/decode', () => {
  it('round-trips a key map', () => {
    const keys = { created_at: '2026-01-01T00:00:00Z', id: 42 };
    expect(decodeCursor(encodeCursor(keys))).toEqual(keys);
  });

  it('produces an opaque Base64 string', () => {
    const cursor = encodeCursor({ id: 7 });
    expect(cursor).toBe(Buffer.from('{"id":7}', 'utf8').toString('base64'));
    expect(/^[A-Za-z0-9+/=]+$/.test(cursor)).toBe(true);
  });

  it('rejects non-object input to encodeCursor', () => {
    expect(() => encodeCursor(null)).toThrow(TypeError);
    expect(() => encodeCursor([1, 2])).toThrow(TypeError);
    expect(() => encodeCursor('nope')).toThrow(TypeError);
  });

  it('throws clear errors for malformed cursors', () => {
    expect(() => decodeCursor('')).toThrow('Invalid cursor');
    expect(() => decodeCursor(123)).toThrow('Invalid cursor');
    expect(() => decodeCursor('@@not-base64@@')).toThrow('Invalid cursor');
    // valid base64 but not an object payload
    const arrCursor = Buffer.from('[1,2,3]', 'utf8').toString('base64');
    expect(() => decodeCursor(arrCursor)).toThrow('malformed payload');
  });
});

describe('normalizeSort & cursorForRow', () => {
  it('normalizes direction and always appends the id tiebreaker', () => {
    expect(normalizeSort([{ field: 'created_at', direction: 'desc' }])).toEqual(
      [
        { field: 'created_at', direction: 'DESC' },
        { field: 'id', direction: 'ASC' },
      ]
    );
  });

  it('does not duplicate id when already present, and defaults to ASC', () => {
    expect(normalizeSort([{ field: 'id', order: 'weird' }])).toEqual([
      { field: 'id', direction: 'ASC' },
    ]);
    expect(normalizeSort()).toEqual([{ field: 'id', direction: 'ASC' }]);
  });

  it('rejects unsafe field identifiers (SQL injection guard)', () => {
    expect(() => normalizeSort([{ field: 'id; DROP TABLE items' }])).toThrow(
      'Invalid sort field'
    );
    expect(() => normalizeSort([{ field: 'created_at)--' }])).toThrow(
      'Invalid sort field'
    );
    expect(() =>
      buildCursorClause({
        sort: [{ field: 'a OR 1=1' }],
        cursor: encodeCursor({ id: 1 }),
      })
    ).toThrow('Invalid sort field');
  });

  it('tolerates a non-array sort and a field with no direction', () => {
    expect(normalizeSort('nonsense')).toEqual([
      { field: 'id', direction: 'ASC' },
    ]);
    expect(normalizeSort([{ field: 'created_at' }])).toEqual([
      { field: 'created_at', direction: 'ASC' },
      { field: 'id', direction: 'ASC' },
    ]);
  });

  it('extracts only the active sort fields (+id) into a cursor', () => {
    const row = { id: 9, score: 100, name: 'x', extra: 'ignored' };
    const cursor = cursorForRow(row, [{ field: 'score', direction: 'DESC' }]);
    expect(decodeCursor(cursor)).toEqual({ score: 100, id: 9 });
  });
});

describe('buildCursorClause', () => {
  it('returns an empty clause when no cursor is given', () => {
    expect(buildCursorClause({ sort: [], cursor: null })).toEqual({
      clause: '',
      params: [],
    });
  });

  it('builds a single-column ASC clause (id tiebreaker)', () => {
    const cursor = encodeCursor({ id: 5 });
    expect(buildCursorClause({ sort: [], cursor })).toEqual({
      clause: 'id > ?',
      params: [5],
    });
  });

  it('builds a mixed ASC/DESC clause via OR-expansion', () => {
    const cursor = encodeCursor({ score: 50, id: 5 });
    const { clause, params } = buildCursorClause({
      sort: [{ field: 'score', direction: 'DESC' }],
      cursor,
    });
    expect(clause).toBe('(score < ? OR (score = ? AND id > ?))');
    expect(params).toEqual([50, 50, 5]);
  });

  it('honors a custom placeholder style and param offset', () => {
    const cursor = encodeCursor({ score: 50, id: 5 });
    const { clause, params } = buildCursorClause({
      sort: [{ field: 'score', direction: 'DESC' }],
      cursor,
      paramOffset: 2,
      placeholder: (i) => `$${i}`,
    });
    expect(clause).toBe('(score < $3 OR (score = $4 AND id > $5))');
    expect(params).toEqual([50, 50, 5]);
  });
});

describe('buildPageInfo', () => {
  const sort = [{ field: 'id', direction: 'ASC' }];

  it('detects a next page from an over-fetched row set and trims it', () => {
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }]; // limit 2 + 1 extra
    const { edges, pageInfo } = buildPageInfo(rows, 2, sort, null);
    expect(edges.map((e) => e.node.id)).toEqual([1, 2]);
    expect(pageInfo.hasNextPage).toBe(true);
    expect(pageInfo.hasPreviousPage).toBe(false);
    expect(decodeCursor(pageInfo.startCursor)).toEqual({ id: 1 });
    expect(decodeCursor(pageInfo.endCursor)).toEqual({ id: 2 });
  });

  it('reports no next page and previous page when a cursor was supplied', () => {
    const { pageInfo } = buildPageInfo([{ id: 5 }], 2, sort, 'someCursor');
    expect(pageInfo.hasNextPage).toBe(false);
    expect(pageInfo.hasPreviousPage).toBe(true);
  });

  it('handles an empty / non-array result set', () => {
    const { edges, pageInfo } = buildPageInfo(null, 2, sort, null);
    expect(edges).toEqual([]);
    expect(pageInfo).toMatchObject({
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: null,
      endCursor: null,
    });
  });
});

describe('integration: paginating a real SQLite table', () => {
  let db;

  // Rows include duplicate scores so the id tiebreaker is genuinely exercised.
  const seed = [
    { score: 30, name: 'a' },
    { score: 10, name: 'b' },
    { score: 30, name: 'c' },
    { score: 20, name: 'd' },
    { score: 10, name: 'e' },
    { score: 30, name: 'f' },
    { score: 20, name: 'g' },
  ];

  beforeAll(async () => {
    db = await open({ filename: ':memory:', driver: sqlite3.Database });
    await db.exec(
      'CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, score INTEGER NOT NULL, name TEXT NOT NULL)'
    );
    for (const row of seed) {
      await db.run('INSERT INTO items (score, name) VALUES (?, ?)', [
        row.score,
        row.name,
      ]);
    }
  });

  afterAll(async () => {
    if (db) await db.close();
  });

  async function fetchPage(sort, cursor, limit) {
    const { clause, params } = buildCursorClause({ sort, cursor });
    const order = normalizeSort(sort)
      .map((s) => `${s.field} ${s.direction}`)
      .join(', ');
    const where = clause ? `WHERE ${clause}` : '';
    const sql = `SELECT * FROM items ${where} ORDER BY ${order} LIMIT ${limit + 1}`;
    const rows = await db.all(sql, params);
    return buildPageInfo(rows, limit, sort, cursor);
  }

  async function collectAll(sort, limit) {
    const ids = [];
    let cursor = null;
    // bound the loop defensively
    for (let guard = 0; guard < 100; guard++) {
      const { edges, pageInfo } = await fetchPage(sort, cursor, limit);
      ids.push(...edges.map((e) => e.node.id));
      if (!pageInfo.hasNextPage) break;
      cursor = pageInfo.endCursor;
    }
    return ids;
  }

  it('walks every row exactly once with a mixed-direction sort', async () => {
    const sort = [{ field: 'score', direction: 'DESC' }];
    const expected = (
      await db.all('SELECT id FROM items ORDER BY score DESC, id ASC')
    ).map((r) => r.id);

    const got = await collectAll(sort, 2);

    expect(got).toEqual(expected); // ordered, no duplicates, no gaps
    expect(new Set(got).size).toBe(seed.length);
  });

  it('does not duplicate or skip already-seen rows when a row is inserted mid-pagination', async () => {
    const sort = [{ field: 'id', direction: 'ASC' }];

    const page1 = await fetchPage(sort, null, 3);
    const seen = page1.edges.map((e) => e.node.id);

    // Concurrent insert: a brand-new row lands AFTER the current page boundary.
    await db.run('INSERT INTO items (score, name) VALUES (?, ?)', [99, 'late']);

    const rest = [];
    let cursor = page1.pageInfo.endCursor;
    let info = page1.pageInfo;
    while (info.hasNextPage) {
      const next = await fetchPage(sort, cursor, 3);
      rest.push(...next.edges.map((e) => e.node.id));
      cursor = next.pageInfo.endCursor;
      info = next.pageInfo;
    }

    const all = [...seen, ...rest];
    // No id appears twice (no duplication), and the new row is picked up once.
    expect(new Set(all).size).toBe(all.length);
    expect(all).toContain(8); // the late row's id
    // Clean up so the suite's other expectations on seed size hold if reordered.
    await db.run('DELETE FROM items WHERE name = ?', ['late']);
  });
});

describe('route: POST /api/v1/events/query', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/events', eventsRouter);
  });

  it('returns cursor pagination metadata and uses WHERE (not OFFSET)', async () => {
    const cursor = encodeCursor({ id: 5 });
    const res = await request(app)
      .post('/api/v1/events/query')
      .send({
        filter: {},
        sort: [{ field: 'id', direction: 'ASC' }],
        limit: 10,
        cursor,
        useCache: false,
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('pageInfo');
    expect(res.body).toHaveProperty('edges');
    expect(res.body.meta.sql).toContain('ORDER BY id ASC');
    expect(res.body.meta.sql).toContain('id > $1');
    expect(res.body.meta.sql).not.toMatch(/OFFSET/i);
    // over-fetch: limit 10 -> LIMIT 11
    expect(res.body.meta.sql).toContain('LIMIT 11');
  });
});
