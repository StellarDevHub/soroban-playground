// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { jest } from '@jest/globals';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fs from 'fs/promises';
import path from 'path';

let testDb = null;

// Mock database connection to use SQLite in-memory database for tests
jest.unstable_mockModule('../src/database/connection.js', () => ({
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

const { initializeDatabase, closeDatabase } = await import('../src/database/connection.js');
import express from 'express';
import supertest from 'supertest';

let server;
const request = () => supertest(server);

// Import our authorization elements
const { QueryBuilder } = await import('../src/services/queryBuilder.js');
const { default: authService } = await import('../src/services/authService.js');
const {
  authenticate,
  requireRole,
  requirePermission,
} = await import('../src/middleware/auth.js');
const { default: projectsRouter } = await import('../src/routes/projects.js');
const { setupGraphQL } = await import('../src/graphql/index.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');

describe('Role-Based Access Control (RBAC) and Row-Level Security (RLS)', () => {
  let app;
  let adminUser, devUser1, devUser2, guestUser;

  beforeAll(async () => {
    await initializeDatabase();

    // Create an Express App
    app = express();
    app.use(express.json());
    
    // Register projects endpoints
    app.use('/api/projects', projectsRouter);
    
    // Setup GraphQL
    await setupGraphQL(app);

    // Error handling
    app.use(errorHandler);

    server = app.listen(0);
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await closeDatabase();
    try {
      const { default: redisService } = await import('../src/services/redisService.js');
      if (redisService && redisService.client) {
        if (typeof redisService.client.quit === 'function') {
          await redisService.client.quit();
        } else if (typeof redisService.client.disconnect === 'function') {
          redisService.client.disconnect();
        }
      }
    } catch (e) {
      // ignore
    }
  });

  beforeEach(async () => {
    // Reset database state
    await testDb.run('DELETE FROM projects');
    await testDb.run('DELETE FROM users');

    // Create seed users
    const hash = 'hashedpassword';
    
    // Admin user (id: 1)
    await testDb.run(
      'INSERT INTO users (id, username, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
      [1, 'admin_user', 'admin@example.com', hash, 'admin']
    );
    adminUser = { id: 1, role: 'admin', username: 'admin_user' };

    // Developer 1 (id: 2)
    await testDb.run(
      'INSERT INTO users (id, username, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
      [2, 'dev_user_1', 'dev1@example.com', hash, 'developer']
    );
    devUser1 = { id: 2, role: 'developer', username: 'dev_user_1' };

    // Developer 2 (id: 3)
    await testDb.run(
      'INSERT INTO users (id, username, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
      [3, 'dev_user_2', 'dev2@example.com', hash, 'developer']
    );
    devUser2 = { id: 3, role: 'developer', username: 'dev_user_2' };

    // Guest user (id: 4)
    await testDb.run(
      'INSERT INTO users (id, username, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
      [4, 'guest_user', 'guest@example.com', hash, 'guest']
    );
    guestUser = { id: 4, role: 'guest', username: 'guest_user' };
  });

  // ── 1. SCHEMA TESTS ────────────────────────────────────────────────────────
  describe('Database Schema Definitions', () => {
    it('creates roles, permissions, and role_permissions tables', async () => {
      const rolesTable = await testDb.get("SELECT name FROM sqlite_master WHERE type='table' AND name='roles'");
      const permissionsTable = await testDb.get("SELECT name FROM sqlite_master WHERE type='table' AND name='permissions'");
      const rolePermissionsTable = await testDb.get("SELECT name FROM sqlite_master WHERE type='table' AND name='role_permissions'");

      expect(rolesTable).toBeTruthy();
      expect(permissionsTable).toBeTruthy();
      expect(rolePermissionsTable).toBeTruthy();
    });

    it('populates roles and permissions with default RBAC config', async () => {
      const roles = await testDb.all('SELECT name FROM roles ORDER BY name');
      expect(roles.map((r) => r.name)).toEqual(['admin', 'developer', 'guest']);

      const permissions = await testDb.all('SELECT name FROM permissions ORDER BY name');
      expect(permissions.map((p) => p.name)).toContain('project:create');
      expect(permissions.map((p) => p.name)).toContain('project:read');
    });
  });

  // ── 2. DYNAMIC QUERY BUILDER RLS TESTS ──────────────────────────────────────
  describe('QueryBuilder Row-Level Security', () => {
    const qb = new QueryBuilder('projects');

    it('bypasses RLS modifier for admin user', () => {
      const jsonQuery = { filter: { status: 'active' } };
      const { sql, params } = qb.buildFullQuery(jsonQuery, adminUser, 'read');

      expect(sql).toContain('WHERE status = $1');
      expect(params).toEqual(['active']);
    });

    it('applies RLS modifier filter for developer user on projects table', () => {
      const jsonQuery = { filter: { status: 'active' } };
      const { sql, params } = qb.buildFullQuery(jsonQuery, devUser1, 'read');

      // The modifier should inject (status = ?) AND creator_id = ?
      expect(sql).toContain('status = $1');
      expect(sql).toContain('creator_id = $2');
      expect(params).toEqual(['active', 2]);
    });

    it('applies RLS modifier filter for guest user on projects table', () => {
      const jsonQuery = { filter: {} };
      const { sql, params } = qb.buildFullQuery(jsonQuery, guestUser, 'read');

      expect(sql).toContain('WHERE creator_id = $1');
      expect(params).toEqual([4]);
    });
  });

  // ── 3. MIDDLEWARE DECORATORS TESTS ──────────────────────────────────────────
  describe('Authorization Middleware (REST)', () => {
    it('allows access if user has the required permission', async () => {
      const middleware = requirePermission('project:create');
      const req = { user: { role: 'developer', permissions: ['project:create'] } };
      const res = {};
      const next = jest.fn();

      middleware(req, res, next);
      expect(next).toHaveBeenCalledWith(); // called with no errors
    });

    it('denies access if user lacks the required permission', async () => {
      const middleware = requirePermission('project:create');
      const req = { user: { role: 'guest', permissions: ['project:read'] } };
      const res = {};
      const next = jest.fn();

      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
      const err = next.mock.calls[0][0];
      expect(err.statusCode).toBe(403);
      expect(err.message).toMatch(/requires permission/i);
    });

    it('allows admin to bypass permission check', async () => {
      const middleware = requirePermission('project:create');
      const req = { user: { role: 'admin', permissions: [] } };
      const res = {};
      const next = jest.fn();

      middleware(req, res, next);
      expect(next).toHaveBeenCalledWith();
    });
  });

  // ── 4. REST PROJECTS CRUD SECURITY TESTS ────────────────────────────────────
  describe('REST Projects CRUD Endpoint Protection', () => {
    beforeEach(async () => {
      // Seed two projects
      // Project 1 (creator: Dev 1, ID: 2)
      await testDb.run(
        `INSERT INTO projects (id, title, description, category, status, creator_id, creator_name, funding_goal)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [10, 'Dev1 Project', 'Description 1', 'DeFi', 'active', 2, 'dev_user_1', 10000]
      );

      // Project 2 (creator: Dev 2, ID: 3)
      await testDb.run(
        `INSERT INTO projects (id, title, description, category, status, creator_id, creator_name, funding_goal)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [20, 'Dev2 Project', 'Description 2', 'NFT', 'draft', 3, 'dev_user_2', 50000]
      );
    });

    it('blocks access if user is unauthenticated', async () => {
      const res = await request(app).get('/api/projects');
      // Unauthenticated defaults to anonymous guest with read permission but no valid userId.
      // If we attempt listing, it should filter by creator_id = null and return empty list.
      expect(res.status).toBe(200);
      expect(res.body.projects).toEqual([]);
    });

    it('denies creation for guest role', async () => {
      const res = await request(app)
        .post('/api/projects')
        .set('x-user-id', '4') // guestUser ID
        .send({
          title: 'Guest Project',
          description: 'Guest description',
          category: 'Gaming',
          status: 'draft',
          funding_goal: 5000,
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Forbidden/i);
    });

    it('allows creation for developer role', async () => {
      const res = await request(app)
        .post('/api/projects')
        .set('x-user-id', '2') // devUser1 ID
        .send({
          title: 'New Dev Project',
          description: 'Dev description',
          category: 'Payments',
          status: 'draft',
          funding_goal: 15000,
        });

      expect(res.status).toBe(201);
      expect(res.body.project.title).toBe('New Dev Project');
      expect(res.body.project.creator_id).toBe(2);
    });

    it('allows user to view their own projects', async () => {
      const res = await request(app)
        .get('/api/projects')
        .set('x-user-id', '2'); // devUser1 ID

      expect(res.status).toBe(200);
      expect(res.body.projects).toHaveLength(1);
      expect(res.body.projects[0].id).toBe(10);
    });

    it('prevents user from listing other users projects', async () => {
      const res = await request(app)
        .get('/api/projects')
        .set('x-user-id', '2'); // devUser1 ID

      // Should only see Dev1 Project (id 10), not Dev2 Project (id 20)
      expect(res.body.projects.map((p) => p.id)).not.toContain(20);
    });

    it('prevents user from fetching specific project belonging to another user', async () => {
      const res = await request(app)
        .get('/api/projects/20') // Project 20 belongs to Dev 2 (id: 3)
        .set('x-user-id', '2'); // Dev 1 requests

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Forbidden/i);
    });

    it('prevents user from updating specific project belonging to another user', async () => {
      const res = await request(app)
        .put('/api/projects/20')
        .set('x-user-id', '2')
        .send({ title: 'Hacked Title' });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Forbidden/i);

      // Verify not updated in DB
      const project = await testDb.get('SELECT title FROM projects WHERE id = 20');
      expect(project.title).toBe('Dev2 Project');
    });

    it('prevents user from deleting specific project belonging to another user', async () => {
      const res = await request(app)
        .delete('/api/projects/20')
        .set('x-user-id', '2');

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Forbidden/i);

      // Verify not deleted in DB
      const project = await testDb.get('SELECT * FROM projects WHERE id = 20');
      expect(project).toBeTruthy();
    });

    it('allows admin to view, update, and delete any project', async () => {
      // Admin gets project 20 (owned by Dev 2)
      const getRes = await request(app)
        .get('/api/projects/20')
        .set('x-user-id', '1');
      expect(getRes.status).toBe(200);

      // Admin updates project 20
      const putRes = await request(app)
        .put('/api/projects/20')
        .set('x-user-id', '1')
        .send({ title: 'Admin Updated Title' });
      expect(putRes.status).toBe(200);

      // Admin deletes project 20
      const delRes = await request(app)
        .delete('/api/projects/20')
        .set('x-user-id', '1');
      expect(delRes.status).toBe(200);
    });
  });

  // ── 5. GRAPHQL PROJECTS CRUD SECURITY TESTS ─────────────────────────────────
  describe('GraphQL Resolvers Security', () => {
    beforeEach(async () => {
      // Seed project belonging to Dev 2
      await testDb.run(
        `INSERT INTO projects (id, title, description, category, status, creator_id, creator_name, funding_goal)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [30, 'Dev2 GraphQL Project', 'GraphQL Desc', 'Infrastructure', 'active', 3, 'dev_user_2', 25000]
      );
    });

    it('GraphQL: allows user to query their own projects', async () => {
      const query = `
        query {
          projects {
            id
            title
            creator_id
          }
        }
      `;

      const res = await request(app)
        .post('/graphql')
        .set('x-user-id', '3') // Dev 2 ID
        .send({ query });

      expect(res.status).toBe(200);
      expect(res.body.data.projects).toHaveLength(1);
      expect(res.body.data.projects[0].id).toBe('30');
    });

    it('GraphQL: prevents user from querying another users project', async () => {
      const query = `
        query {
          project(id: "30") {
            id
            title
          }
        }
      `;

      const res = await request(app)
        .post('/graphql')
        .set('x-user-id', '2') // Dev 1 requests Project 30 (owned by Dev 2)
        .send({ query });

      expect(res.status).toBe(200);
      expect(res.body.errors).toBeDefined();
      expect(res.body.errors[0].message).toMatch(/Forbidden/i);
    });

    it('GraphQL: allows user to create project', async () => {
      const query = `
        mutation {
          createProject(
            title: "GraphQL Created Project"
            description: "GraphQL description"
            category: "Infrastructure"
            status: "active"
            funding_goal: 30000.0
            tags: ["test", "graphql"]
          ) {
            id
            title
            creator_id
          }
        }
      `;

      const res = await request(app)
        .post('/graphql')
        .set('x-user-id', '2') // Dev 1 ID
        .send({ query });

      expect(res.status).toBe(200);
      expect(res.body.data.createProject.title).toBe('GraphQL Created Project');
      expect(res.body.data.createProject.creator_id).toBe(2);
    });

    it('GraphQL: prevents guest from creating project', async () => {
      const query = `
        mutation {
          createProject(
            title: "Guest Project"
            description: "Guest desc"
            category: "DeFi"
            status: "draft"
            funding_goal: 1000.0
          ) {
            id
          }
        }
      `;

      const res = await request(app)
        .post('/graphql')
        .set('x-user-id', '4') // Guest user ID
        .send({ query });

      expect(res.status).toBe(200);
      expect(res.body.errors).toBeDefined();
      expect(res.body.errors[0].message).toMatch(/Forbidden: Access requires permission "project:create"/i);
    });

    it('GraphQL: prevents user from updating another users project', async () => {
      const query = `
        mutation {
          updateProject(
            id: "30"
            title: "Dev1 Hacked Title"
          ) {
            id
            title
          }
        }
      `;

      const res = await request(app)
        .post('/graphql')
        .set('x-user-id', '2') // Dev 1 requests Project 30 (owned by Dev 2)
        .send({ query });

      expect(res.status).toBe(200);
      expect(res.body.errors).toBeDefined();
      expect(res.body.errors[0].message).toMatch(/Forbidden: You do not own this project/i);
    });

    it('GraphQL: prevents user from deleting another users project', async () => {
      const query = `
        mutation {
          deleteProject(id: "30")
        }
      `;

      const res = await request(app)
        .post('/graphql')
        .set('x-user-id', '2') // Dev 1 requests Project 30 (owned by Dev 2)
        .send({ query });

      expect(res.status).toBe(200);
      expect(res.body.errors).toBeDefined();
      expect(res.body.errors[0].message).toMatch(/Forbidden: You do not own this project/i);
    });

    it('GraphQL: allows admin to update and delete any project', async () => {
      // Update
      const updateQuery = `
        mutation {
          updateProject(id: "30", title: "Admin Updated GraphQL") {
            title
          }
        }
      `;
      const upRes = await request(app)
        .post('/graphql')
        .set('x-user-id', '1') // Admin ID
        .send({ query: updateQuery });
      expect(upRes.status).toBe(200);
      expect(upRes.body.data.updateProject.title).toBe('Admin Updated GraphQL');

      // Delete
      const deleteQuery = `
        mutation {
          deleteProject(id: "30")
        }
      `;
      const delRes = await request(app)
        .post('/graphql')
        .set('x-user-id', '1') // Admin ID
        .send({ query: deleteQuery });
      expect(delRes.status).toBe(200);
      expect(delRes.body.data.deleteProject).toBe(true);
    });
  });
});
