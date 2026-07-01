// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// Integration tests for the DataLoader-batched GraphQL resolvers (issue #724).
// Asserts that an N-parent fan-out collapses to a single batched SQL query per
// relation — verified by counting exact SQL executions against an in-memory
// SQLite database seeded with N projects x M files.

import { jest } from '@jest/globals';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fs from 'fs/promises';
import path from 'path';
import express from 'express';
import request from 'supertest';

// ── In-memory SQLite mock for the connection module ─────────────────────────
// Same pattern as favorites.test.js / authService.test.js — keeps the test
// isolated from the file-based database used by the running server.

let testDb = null;
let queryLog = [];

jest.doMock('../src/database/connection.js', () => ({
  initializeDatabase: async () => {
    if (testDb) return testDb;
    testDb = await open({
      filename: ':memory:',
      driver: sqlite3.Database,
    });
    const schemaPath = path.resolve(process.cwd(), 'src/database/schema.sql');
    const schema = await fs.readFile(schemaPath, 'utf-8');
    await testDb.exec(schema);
    return testDb;
  },
  getDatabase: () => {
    if (!testDb) {
      throw new Error(
        'Database not initialized. Call initializeDatabase() first.'
      );
    }
    return testDb;
  },
  closeDatabase: async () => {
    if (testDb) {
      await testDb.close();
      testDb = null;
    }
  },
}));

// Compile/deploy services are not exercised here — stub them so importing the
// GraphQL module does not pull in the full compile pipeline.
jest.doMock('../src/services/compileService.js', () => ({
  getCompileSnapshot: jest
    .fn()
    .mockResolvedValue({ history: [], artifacts: [] }),
  compileQueued: jest.fn(),
  compileBatch: jest.fn(),
  compileProgressBus: { on: jest.fn(), off: jest.fn(), emit: jest.fn() },
}));

jest.doMock('../src/services/deployService.js', () => ({
  getDeploymentState: jest.fn().mockReturnValue({ history: [] }),
  deployBatchContracts: jest.fn(),
  deployProgressBus: { on: jest.fn(), off: jest.fn(), emit: jest.fn() },
}));

jest.doMock('../src/services/invokeService.js', () => ({
  invokeSorobanContract: jest.fn(),
  invokeProgressBus: { on: jest.fn(), off: jest.fn(), emit: jest.fn() },
}));

jest.doMock('../src/services/redisService.js', () => ({
  default: {
    isConnected: false,
    isFallbackMode: true,
    client: null,
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
  },
}));

let initializeDatabase;
let closeDatabase;
let setupGraphQL;

// ── Helpers ─────────────────────────────────────────────────────────────────

const NUM_PROJECTS = 5;
const FILES_PER_PROJECT = 3;

async function seedData() {
  // Wipe project/file rows so counts are deterministic. Templates are static
  // reference data (seeded once at schema-load time) so we leave them intact —
  // the templates test relies on those rows being present.
  await testDb.run('DELETE FROM files');
  await testDb.run('DELETE FROM projects');
  await testDb.run(
    "DELETE FROM sqlite_sequence WHERE name IN ('files', 'projects')"
  );

  for (let p = 1; p <= NUM_PROJECTS; p++) {
    await testDb.run(
      `INSERT INTO projects (title, description, category, status, creator_id, creator_name, funding_goal, current_funding, completion_rate, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `Project ${p}`,
        `Description ${p}`,
        'DeFi',
        'active',
        p,
        `creator${p}`,
        10000,
        5000,
        50.0,
        '["tag-a","tag-b"]',
      ]
    );
    const projectId = (await testDb.get('SELECT last_insert_rowid() as id')).id;
    for (let f = 1; f <= FILES_PER_PROJECT; f++) {
      await testDb.run(
        `INSERT INTO files (project_id, uploader_id, filename, filepath, mimetype, size_bytes)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          projectId,
          p,
          `file_${p}_${f}.wasm`,
          `/out/file_${p}_${f}.wasm`,
          'application/wasm',
          1024 * f,
        ]
      );
    }
  }
}

/**
 * Wraps the underlying sqlite handle's `all`/`get`/`run` methods so every SQL
 * statement is appended to `queryLog`. Installed once in beforeAll; tests call
 * `resetQueryLog()` to clear the log between assertions. Reuses the same
 * wrapping pattern as the slow-query profiler in src/database/connection.js.
 */
function installQueryCounter() {
  for (const method of ['all', 'get', 'run']) {
    const original = testDb[method].bind(testDb);
    testDb[method] = async function (...args) {
      const sql = typeof args[0] === 'string' ? args[0] : 'unknown';
      // Skip schema-introspection pragmas so counts reflect business queries.
      if (
        !sql.startsWith('PRAGMA') &&
        !sql.startsWith('SELECT last_insert_rowid')
      ) {
        queryLog.push(sql);
      }
      return original(...args);
    };
  }
}

function resetQueryLog() {
  queryLog = [];
}

function countByTable(table) {
  return queryLog.filter((sql) => new RegExp(`\\b${table}\\b`, 'i').test(sql))
    .length;
}

function gql(app, query) {
  return request(app)
    .post('/graphql')
    .set('Content-Type', 'application/json')
    .send({ query });
}

// ── Test suite ──────────────────────────────────────────────────────────────

describe('GraphQL DataLoader batching (issue #724)', () => {
  let app;

  beforeAll(async () => {
    ({ initializeDatabase, closeDatabase } =
      await import('../src/database/connection.js'));
    ({ setupGraphQL } = await import('../src/graphql/index.js'));

    await initializeDatabase();
    app = express();
    app.use(express.json());
    await setupGraphQL(app);
    installQueryCounter();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    await seedData();
    resetQueryLog();
  });

  it('projects { files } issues exactly 2 SQL queries for N projects', async () => {
    const res = await gql(
      app,
      `{
        projects {
          id
          title
          files { id filename }
        }
      }`
    );

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    const projects = res.body.data.projects;
    expect(projects).toHaveLength(NUM_PROJECTS);
    for (const p of projects) {
      expect(p.files).toHaveLength(FILES_PER_PROJECT);
    }

    // 1 query for the project list + 1 batched query for all files.
    expect(countByTable('projects')).toBe(1);
    expect(countByTable('files')).toBe(1);
    expect(queryLog.length).toBe(2);
  });

  it('files { project } issues exactly 2 SQL queries for N files', async () => {
    const res = await gql(
      app,
      `{
        files {
          id
          filename
          project { id title }
        }
      }`
    );

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    const files = res.body.data.files;
    expect(files.length).toBe(NUM_PROJECTS * FILES_PER_PROJECT);
    for (const f of files) {
      expect(f.project).not.toBeNull();
      expect(f.project.id).not.toBeUndefined();
    }

    // 1 query for files + 1 batched query for the (deduplicated) parent
    // projects. With N+1 the count would be 1 + (N*M).
    expect(countByTable('files')).toBe(1);
    expect(countByTable('projects')).toBe(1);
    expect(queryLog.length).toBe(2);
  });

  it('templates { files } issues exactly 2 SQL queries when templates have files', async () => {
    // Attach files to the seeded templates via template_id.
    const templates = await testDb.all('SELECT id FROM templates');
    expect(templates.length).toBeGreaterThan(0);
    for (const t of templates) {
      await testDb.run(
        `INSERT INTO files (template_id, uploader_id, filename, filepath, mimetype, size_bytes)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          t.id,
          1,
          `template_${t.id}_file.wasm`,
          `/out/template_${t.id}_file.wasm`,
          'application/wasm',
          2048,
        ]
      );
    }
    // Reset the counter so the seed INSERTs above don't pollute the count.
    resetQueryLog();

    const res = await gql(
      app,
      `{
        templates {
          id
          name
          files { id filename }
        }
      }`
    );

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    const list = res.body.data.templates;
    expect(list.length).toBe(templates.length);
    for (const t of list) {
      expect(t.files.length).toBeGreaterThanOrEqual(1);
    }

    expect(countByTable('templates')).toBe(1);
    expect(countByTable('files')).toBe(1);
    expect(queryLog.length).toBe(2);
  });

  it('duplicate project(id) selections in one query hit the cache (1 query)', async () => {
    const res = await gql(
      app,
      `{
        a: project(id: 1) { id title }
        b: project(id: 1) { id title }
        c: project(id: 1) { id title }
      }`
    );

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.a.id).toBe('1');
    expect(res.body.data.b.id).toBe('1');
    expect(res.body.data.c.id).toBe('1');

    // Three .load(1) calls in the same tick coalesce + cache → 1 query total.
    expect(countByTable('projects')).toBe(1);
    expect(queryLog.length).toBe(1);
  });

  it('per-request caches do not leak across GraphQL requests', async () => {
    await gql(app, `{ project(id: 1) { id title } }`);
    const firstCount = countByTable('projects');
    expect(firstCount).toBe(1);

    // Second request must re-issue the query because loaders are per-request.
    await gql(app, `{ project(id: 1) { id title } }`);
    expect(countByTable('projects')).toBe(2);
  });

  it('N+1 baseline: resolving files per-project without a loader would issue 1+N queries', async () => {
    // This test documents the cost the loader is eliminating. It calls the
    // file service once per project (the naive pattern) and proves the query
    // count is 1 + N rather than the loader's flat 2.
    const { listProjects } = await import('../src/services/projectService.js');
    const { getFilesByProjectIds } =
      await import('../src/services/fileService.js');

    resetQueryLog();
    const projects = await listProjects();
    // Naive loop: one query per project (single-id IN clause).
    for (const p of projects) {
      await getFilesByProjectIds([p.id]);
    }

    // 1 (listProjects) + N (one files query per project) = 1 + NUM_PROJECTS.
    expect(countByTable('projects')).toBe(1);
    expect(countByTable('files')).toBe(NUM_PROJECTS);
    expect(queryLog.length).toBe(1 + NUM_PROJECTS);
  });
});
