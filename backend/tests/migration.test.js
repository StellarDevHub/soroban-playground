import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import MigrationService from '../src/services/migrationService.js';
import DatabaseService from '../src/services/databaseService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('MigrationService', () => {
  let migrationService;
  let testDbPath;
  let testMigrationsPath;

  beforeAll(async () => {
    testDbPath = path.join(__dirname, 'test_migrations.db');
    testMigrationsPath = path.join(__dirname, 'test_migrations');
    
    // Create test migrations directory
    if (!fs.existsSync(testMigrationsPath)) {
      fs.mkdirSync(testMigrationsPath, { recursive: true });
    }
    
    migrationService = new MigrationService(testDbPath);
    await migrationService.initialize();
  });

  afterAll(async () => {
    await migrationService.close();
    
    // Clean up test files
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    
    if (fs.existsSync(testMigrationsPath)) {
      fs.rmSync(testMigrationsPath, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    // Clean database before each test
    const dbService = new DatabaseService(testDbPath);
    await dbService.connect();
    await dbService.run('DELETE FROM _schema_migrations');
    await dbService.close();
    
    // Clean migrations directory
    if (fs.existsSync(testMigrationsPath)) {
      fs.rmSync(testMigrationsPath, { recursive: true, force: true });
      fs.mkdirSync(testMigrationsPath, { recursive: true });
    }
  });

  describe('Migration file validation', () => {
    test('should validate paired up/down migrations', async () => {
      // Create valid migration pair
      fs.writeFileSync(
        path.join(testMigrationsPath, '1234567890_create_users.up.sql'),
        'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);'
      );
      
      fs.writeFileSync(
        path.join(testMigrationsPath, '1234567890_create_users.down.sql'),
        'DROP TABLE users;'
      );
      
      const { errors, upFiles } = await migrationService.validateMigrationFiles();
      
      expect(errors).toHaveLength(0);
      expect(upFiles).toHaveLength(1);
      expect(upFiles[0].version).toBe('1234567890');
      expect(upFiles[0].description).toBe('create_users');
    });

    test('should detect missing down migration', async () => {
      // Create only up migration
      fs.writeFileSync(
        path.join(testMigrationsPath, '1234567890_create_users.up.sql'),
        'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);'
      );
      
      const { errors } = await migrationService.validateMigrationFiles();
      
      expect(errors).toContain('Missing down migration for version 1234567890');
    });

    test('should detect duplicate versions', async () => {
      // Create duplicate up migrations
      fs.writeFileSync(
        path.join(testMigrationsPath, '1234567890_create_users.up.sql'),
        'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);'
      );
      
      fs.writeFileSync(
        path.join(testMigrationsPath, '1234567890_create_posts.up.sql'),
        'CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT);'
      );
      
      const { errors } = await migrationService.validateMigrationFiles();
      
      expect(errors).toContain('Duplicate up migration for version 1234567890');
    });
  });

  describe('Migration execution', () => {
    test('should apply migration successfully', async () => {
      // Create migration files
      fs.writeFileSync(
        path.join(testMigrationsPath, '1234567890_create_users.up.sql'),
        'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);'
      );
      
      fs.writeFileSync(
        path.join(testMigrationsPath, '1234567890_create_users.down.sql'),
        'DROP TABLE users;'
      );
      
      const results = await migrationService.migrateUp();
      
      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].migration.version).toBe('1234567890');
      
      // Verify table was created
      const dbService = new DatabaseService(testDbPath);
      await dbService.connect();
      const tables = await dbService.all("SELECT name FROM sqlite_master WHERE type='table'");
      await dbService.close();
      
      expect(tables.find(t => t.name === 'users')).toBeTruthy();
    });

    test('should detect modified migration', async () => {
      // Create and apply migration
      fs.writeFileSync(
        path.join(testMigrationsPath, '1234567890_create_users.up.sql'),
        'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);'
      );
      
      fs.writeFileSync(
        path.join(testMigrationsPath, '1234567890_create_users.down.sql'),
        'DROP TABLE users;'
      );
      
      await migrationService.migrateUp();
      
      // Modify migration file
      fs.writeFileSync(
        path.join(testMigrationsPath, '1234567890_create_users.up.sql'),
        'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT);'
      );
      
      // Should detect modification
      await expect(migrationService.validateMigrationChecksum(
        (await migrationService.getMigrationFiles()).find(f => f.version === '1234567890')
      )).rejects.toThrow('has been modified since application');
    });

    test('should rollback migration successfully', async () => {
      // Create migration files
      fs.writeFileSync(
        path.join(testMigrationsPath, '1234567890_create_users.up.sql'),
        'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);'
      );
      
      fs.writeFileSync(
        path.join(testMigrationsPath, '1234567890_create_users.down.sql'),
        'DROP TABLE users;'
      );
      
      // Apply migration
      await migrationService.migrateUp();
      
      // Verify table exists
      let dbService = new DatabaseService(testDbPath);
      await dbService.connect();
      let tables = await dbService.all("SELECT name FROM sqlite_master WHERE type='table'");
      await dbService.close();
      
      expect(tables.find(t => t.name === 'users')).toBeTruthy();
      
      // Rollback migration
      const results = await migrationService.migrateDown();
      
      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      
      // Verify table was dropped
      dbService = new DatabaseService(testDbPath);
      await dbService.connect();
      tables = await dbService.all("SELECT name FROM sqlite_master WHERE type='table'");
      await dbService.close();
      
      expect(tables.find(t => t.name === 'users')).toBeFalsy();
    });

    test('should handle dry-run mode', async () => {
      // Create migration files
      fs.writeFileSync(
        path.join(testMigrationsPath, '1234567890_create_users.up.sql'),
        'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);'
      );
      
      fs.writeFileSync(
        path.join(testMigrationsPath, '1234567890_create_users.down.sql'),
        'DROP TABLE users;'
      );
      
      const results = await migrationService.migrateUp(true); // dry-run = true
      
      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].dryRun).toBe(true);
      expect(results[0].sql).toContain('CREATE TABLE users');
      
      // Verify table was NOT created
      const dbService = new DatabaseService(testDbPath);
      await dbService.connect();
      const tables = await dbService.all("SELECT name FROM sqlite_master WHERE type='table'");
      await dbService.close();
      
      expect(tables.find(t => t.name === 'users')).toBeFalsy();
    });
  });

  describe('Migration status tracking', () => {
    test('should track migration status correctly', async () => {
      // Create migration files
      fs.writeFileSync(
        path.join(testMigrationsPath, '1234567890_create_users.up.sql'),
        'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);'
      );
      
      fs.writeFileSync(
        path.join(testMigrationsPath, '1234567890_create_users.down.sql'),
        'DROP TABLE users;'
      );
      
      fs.writeFileSync(
        path.join(testMigrationsPath, '1234567891_create_posts.up.sql'),
        'CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT);'
      );
      
      fs.writeFileSync(
        path.join(testMigrationsPath, '1234567891_create_posts.down.sql'),
        'DROP TABLE posts;'
      );
      
      // Check initial status
      let status = await migrationService.getMigrationStatus();
      expect(status.totalMigrations).toBe(2);
      expect(status.appliedMigrations).toBe(0);
      expect(status.pendingMigrations).toBe(2);
      
      // Apply one migration
      await migrationService.migrateUp();
      
      // Check updated status
      status = await migrationService.getMigrationStatus();
      expect(status.totalMigrations).toBe(2);
      expect(status.appliedMigrations).toBe(1);
      expect(status.pendingMigrations).toBe(1);
      expect(status.lastMigration.version).toBe('1234567890');
      
      // Apply second migration
      await migrationService.migrateUp();
      
      // Check final status
      status = await migrationService.getMigrationStatus();
      expect(status.totalMigrations).toBe(2);
      expect(status.appliedMigrations).toBe(2);
      expect(status.pendingMigrations).toBe(0);
    });
  });

  describe('SQL validation', () => {
    test('should detect destructive operations', async () => {
      const destructiveSQL = 'DROP TABLE users;';
      const warnings = await migrationService.validateMigrationSQL(destructiveSQL);
      
      expect(warnings).toContain('Potentially destructive operation detected');
    });

    test('should pass for safe operations', async () => {
      const safeSQL = 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);';
      const warnings = await migrationService.validateMigrationSQL(safeSQL);
      
      expect(warnings).toHaveLength(0);
    });
  });
});
