import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import DatabaseService from './databaseService.js';

class MigrationService {
  constructor(dbPath = null) {
    this.dbService = new DatabaseService(dbPath);
    this.migrationsPath = path.join(process.cwd(), 'migrations');
    this.migrationTable = '_schema_migrations';
  }

  async initialize() {
    await this.dbService.connect();
    await this.createMigrationTable();
  }

  async createMigrationTable() {
    const sql = `
      CREATE TABLE IF NOT EXISTS ${this.migrationTable} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version VARCHAR(255) NOT NULL UNIQUE,
        checksum VARCHAR(64) NOT NULL,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        execution_time INTEGER NOT NULL,
        status VARCHAR(20) DEFAULT 'applied'
      )
    `;
    await this.dbService.run(sql);
  }

  async calculateChecksum(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  async getMigrationFiles() {
    if (!fs.existsSync(this.migrationsPath)) {
      return [];
    }

    const files = fs.readdirSync(this.migrationsPath);
    const migrationFiles = [];

    files.forEach((file) => {
      const match = file.match(/^(\d+)_(.+)\.(up|down)\.sql$/);
      if (match) {
        const [, version, description, direction] = match;
        migrationFiles.push({
          version,
          description,
          direction,
          filename: file,
          fullPath: path.join(this.migrationsPath, file),
        });
      }
    });

    return migrationFiles;
  }

  async validateMigrationFiles() {
    const files = await this.getMigrationFiles();
    const upFiles = files.filter((f) => f.direction === 'up');
    const downFiles = files.filter((f) => f.direction === 'down');
    const errors = [];

    // Check for paired up/down files
    upFiles.forEach((upFile) => {
      const correspondingDown = downFiles.find(
        (f) => f.version === upFile.version
      );
      if (!correspondingDown) {
        errors.push(`Missing down migration for version ${upFile.version}`);
      }
    });

    downFiles.forEach((downFile) => {
      const correspondingUp = upFiles.find(
        (f) => f.version === downFile.version
      );
      if (!correspondingUp) {
        errors.push(`Missing up migration for version ${downFile.version}`);
      }
    });

    // Check for version duplicates
    const versionCounts = {};
    upFiles.forEach((file) => {
      versionCounts[file.version] = (versionCounts[file.version] || 0) + 1;
    });

    Object.entries(versionCounts).forEach(([version, count]) => {
      if (count > 1) {
        errors.push(`Duplicate up migration for version ${version}`);
      }
    });

    return {
      errors,
      upFiles: upFiles.sort((a, b) => a.version.localeCompare(b.version)),
    };
  }

  async getAppliedMigrations() {
    const sql = `SELECT version, checksum, applied_at, execution_time, status FROM ${this.migrationTable} ORDER BY version`;
    return await this.dbService.all(sql);
  }

  async getPendingMigrations() {
    const { errors, upFiles } = await this.validateMigrationFiles();
    if (errors.length > 0) {
      throw new Error(`Migration validation failed: ${errors.join(', ')}`);
    }

    const appliedMigrations = await this.getAppliedMigrations();
    const appliedVersions = new Set(appliedMigrations.map((m) => m.version));

    return upFiles.filter((file) => !appliedVersions.has(file.version));
  }

  async validateMigrationChecksum(migrationFile) {
    const content = fs.readFileSync(migrationFile.fullPath, 'utf8');
    const checksum = await this.calculateChecksum(content);

    const appliedMigration = await this.dbService.get(
      `SELECT checksum FROM ${this.migrationTable} WHERE version = ?`,
      [migrationFile.version]
    );

    if (appliedMigration && appliedMigration.checksum !== checksum) {
      throw new Error(
        `Migration ${migrationFile.version} has been modified since application`
      );
    }

    return checksum;
  }

  async validateMigrationSQL(sql) {
    // Basic SQL validation - can be enhanced
    const destructivePatterns = [
      /DROP\s+TABLE/i,
      /DROP\s+DATABASE/i,
      /DELETE\s+FROM\s+\w+\s+WHERE\s+1\s*=\s*1/i,
      /TRUNCATE/i,
    ];

    const warnings = [];
    destructivePatterns.forEach((pattern) => {
      if (pattern.test(sql)) {
        warnings.push('Potentially destructive operation detected');
      }
    });

    return warnings;
  }

  async executeMigration(migrationFile, dryRun = false) {
    const content = fs.readFileSync(migrationFile.fullPath, 'utf8');
    const checksum = await this.calculateChecksum(content);
    const warnings = await this.validateMigrationSQL(content);

    if (dryRun) {
      return {
        success: true,
        dryRun: true,
        migration: migrationFile,
        warnings,
        sql: content,
      };
    }

    const startTime = Date.now();

    try {
      await this.dbService.transaction(async (db) => {
        // Execute migration SQL
        await db.run(content);

        // Record migration
        await db.run(
          `INSERT INTO ${this.migrationTable} (version, checksum, execution_time, status) VALUES (?, ?, ?, ?)`,
          [migrationFile.version, checksum, Date.now() - startTime, 'applied']
        );
      });

      return {
        success: true,
        migration: migrationFile,
        executionTime: Date.now() - startTime,
        warnings,
      };
    } catch (error) {
      throw new Error(
        `Migration ${migrationFile.version} failed: ${error.message}`
      );
    }
  }

  async rollbackMigration(migrationFile, dryRun = false) {
    const downFile = (await this.getMigrationFiles()).find(
      (f) => f.version === migrationFile.version && f.direction === 'down'
    );

    if (!downFile) {
      throw new Error(
        `No down migration found for version ${migrationFile.version}`
      );
    }

    const content = fs.readFileSync(downFile.fullPath, 'utf8');
    const warnings = await this.validateMigrationSQL(content);

    if (dryRun) {
      return {
        success: true,
        dryRun: true,
        migration: downFile,
        warnings,
        sql: content,
      };
    }

    const startTime = Date.now();

    try {
      await this.dbService.transaction(async (db) => {
        // Execute rollback SQL
        await db.run(content);

        // Update migration record
        await db.run(
          `UPDATE ${this.migrationTable} SET status = ?, execution_time = ? WHERE version = ?`,
          ['rolled_back', Date.now() - startTime, migrationFile.version]
        );
      });

      return {
        success: true,
        migration: downFile,
        executionTime: Date.now() - startTime,
        warnings,
      };
    } catch (error) {
      throw new Error(
        `Rollback for migration ${migrationFile.version} failed: ${error.message}`
      );
    }
  }

  async migrateUp(dryRun = false) {
    const pendingMigrations = await this.getPendingMigrations();
    const results = [];

    for (const migration of pendingMigrations) {
      try {
        const result = await this.executeMigration(migration, dryRun);
        results.push(result);

        if (!dryRun && !result.success) {
          // Attempt rollback on failure
          try {
            await this.rollbackMigration(migration);
            results.push({
              ...result,
              rollbackAttempted: true,
              rollbackSuccess: true,
            });
          } catch (rollbackError) {
            results.push({
              ...result,
              rollbackAttempted: true,
              rollbackSuccess: false,
              rollbackError: rollbackError.message,
            });
          }
          break;
        }
      } catch (error) {
        results.push({ success: false, migration, error: error.message });
        break;
      }
    }

    return results;
  }

  async migrateDown(targetVersion = null, dryRun = false) {
    const appliedMigrations = await this.getAppliedMigrations();
    const migrationsToRollback = targetVersion
      ? appliedMigrations.filter((m) => m.version > targetVersion).reverse()
      : appliedMigrations.slice(-1); // Rollback last migration only

    const results = [];

    for (const appliedMigration of migrationsToRollback) {
      try {
        const migrationFile = (await this.getMigrationFiles()).find(
          (f) => f.version === appliedMigration.version && f.direction === 'up'
        );

        if (!migrationFile) {
          throw new Error(
            `Migration file not found for version ${appliedMigration.version}`
          );
        }

        const result = await this.rollbackMigration(migrationFile, dryRun);
        results.push(result);
      } catch (error) {
        results.push({
          success: false,
          migration: appliedMigration,
          error: error.message,
        });
        break;
      }
    }

    return results;
  }

  async getMigrationStatus() {
    const { errors, upFiles } = await this.validateMigrationFiles();
    const appliedMigrations = await this.getAppliedMigrations();
    const appliedVersions = new Set(appliedMigrations.map((m) => m.version));
    const pendingMigrations = upFiles.filter(
      (f) => !appliedVersions.has(f.version)
    );

    return {
      totalMigrations: upFiles.length,
      appliedMigrations: appliedMigrations.length,
      pendingMigrations: pendingMigrations.length,
      validationErrors: errors,
      appliedMigrationsDetails: appliedMigrations,
      pendingMigrationsDetails: pendingMigrations,
      lastMigration: appliedMigrations[appliedMigrations.length - 1] || null,
    };
  }

  async close() {
    await this.dbService.close();
  }
}

export default MigrationService;
