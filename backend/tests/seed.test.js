import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { seedDatabase } from '../scripts/seed.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DB_PATH = path.join(__dirname, '../data/test_seed.sqlite');

describe('Automated Database Seeding', () => {
  let db;

  beforeAll(async () => {
    await fs.mkdir(path.dirname(TEST_DB_PATH), { recursive: true });

    // Create schema before testing
    db = await open({
      filename: TEST_DB_PATH,
      driver: sqlite3.Database,
    });

    const schemaPath = path.join(__dirname, '../src/database/schema.sql');
    const schema = await fs.readFile(schemaPath, 'utf-8');
    await db.exec(schema);
  });

  afterAll(async () => {
    if (db) await db.close();
    try {
      await fs.unlink(TEST_DB_PATH);
    } catch (e) {
      // Ignore
    }
  });

  it('should seed database within 5 seconds and maintain consistency', async () => {
    const startTime = Date.now();

    await seedDatabase({
      dbPath: TEST_DB_PATH,
      users: 10,
      projects: 20,
      files: 50,
    });

    const duration = Date.now() - startTime;
    expect(duration).toBeLessThan(5000);

    // Verify consistency
    const usersCount = await db.get('SELECT COUNT(*) as count FROM users');
    expect(usersCount.count).toBe(10);

    const projectsCount = await db.get(
      'SELECT COUNT(*) as count FROM projects'
    );
    // Projects table has 8 default seeded projects in schema.sql,
    // but the seed script deletes them first. So it should exactly be 20.
    expect(projectsCount.count).toBe(20);

    const filesCount = await db.get('SELECT COUNT(*) as count FROM files');
    expect(filesCount.count).toBe(50);

    // Verify Foreign Keys Constraints
    const invalidFiles = await db.get(
      'SELECT COUNT(*) as count FROM files WHERE project_id NOT IN (SELECT id FROM projects) OR uploader_id NOT IN (SELECT id FROM users)'
    );
    expect(invalidFiles.count).toBe(0);

    const invalidProjects = await db.get(
      'SELECT COUNT(*) as count FROM projects WHERE creator_id NOT IN (SELECT id FROM users)'
    );
    expect(invalidProjects.count).toBe(0);
  });
});
