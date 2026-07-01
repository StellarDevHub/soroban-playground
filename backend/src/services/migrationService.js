import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import DatabaseService from './databaseService.js';
import { getDatabase, saveDatabase } from './dbService.js';

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

    let files;
    try {
      files = fs.readdirSync(this.migrationsPath);
    } catch (err) {
      throw new Error(`Failed to read migrations directory: ${err.message}`);
    }

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
    let content;
    try {
      content = fs.readFileSync(migrationFile.fullPath, 'utf8');
    } catch (err) {
      throw new Error(
        `Cannot read migration file ${migrationFile.filename}: ${err.message}`
      );
    }
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
    let content;
    try {
      content = fs.readFileSync(migrationFile.fullPath, 'utf8');
    } catch (err) {
      throw new Error(
        `Cannot read migration file ${migrationFile.filename}: ${err.message}`
      );
    }
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
        await db.run(content);
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

    let content;
    try {
      content = fs.readFileSync(downFile.fullPath, 'utf8');
    } catch (err) {
      throw new Error(
        `Cannot read rollback file ${downFile.filename}: ${err.message}`
      );
    }
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
        await db.run(content);
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

// ── Functional API (sql.js backed) ──────────────────────────────────────────

const MIGRATION_TABLE = '_schema_migrations';

function getMigrationsDir() {
  return process.env.MIGRATIONS_DIR || path.join(process.cwd(), 'migrations');
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function ensureMigrationTable(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT DEFAULT (datetime('now')),
      status TEXT DEFAULT 'applied'
    )
  `);
  await saveDatabase();
}

async function readMigrationFiles() {
  const dir = getMigrationsDir();
  let entries;
  try {
    entries = await fsp.readdir(dir);
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const m = entry.match(/^V(\d+)__(.+)\.(up|down)\.sql$/);
    if (m) {
      files.push({
        version: parseInt(m[1], 10),
        name: m[2],
        direction: m[3],
        filename: entry,
        fullPath: path.join(dir, entry),
      });
    }
  }
  return files;
}

export async function validateMigrations() {
  const files = await readMigrationFiles();
  const ups = files.filter((f) => f.direction === 'up');
  const downs = new Set(
    files.filter((f) => f.direction === 'down').map((f) => f.version)
  );
  const errors = [];
  for (const u of ups) {
    if (!downs.has(u.version))
      errors.push(`Missing down migration for version ${u.version}`);
  }
  return errors;
}

export async function initializeMigrationService() {
  const db = await getDatabase();
  await ensureMigrationTable(db);
}

export async function getAppliedMigrations() {
  const db = await getDatabase();
  const result = db.exec(
    `SELECT version, name, checksum, applied_at, status FROM ${MIGRATION_TABLE} ORDER BY version`
  );
  if (!result.length) return [];
  const [{ columns, values }] = result;
  return values.map((row) =>
    Object.fromEntries(columns.map((c, i) => [c, row[i]]))
  );
}

export async function applyMigration(version, { dryRun = false } = {}) {
  const files = await readMigrationFiles();
  const file = files.find((f) => f.version === version && f.direction === 'up');
  if (!file) throw new Error(`Migration file not found for version ${version}`);

  let sql;
  try {
    sql = await fsp.readFile(file.fullPath, 'utf8');
  } catch (err) {
    throw new Error(
      `Cannot read migration file ${file.filename}: ${err.message}`
    );
  }

  const checksum = sha256(sql);
  const db = await getDatabase();

  const existing = db.exec(
    `SELECT checksum FROM ${MIGRATION_TABLE} WHERE version = ${version}`
  );
  if (existing.length && existing[0].values.length) {
    const storedChecksum = existing[0].values[0][0];
    if (storedChecksum !== checksum) {
      throw new Error(
        `Checksum mismatch for migration ${version}: file has been modified`
      );
    }
    return { status: 'already_applied', version };
  }

  if (dryRun) return { status: 'dry_run_success', version, sql };

  db.run(sql);
  db.run(
    `INSERT INTO ${MIGRATION_TABLE} (version, name, checksum, status) VALUES (?, ?, ?, 'applied')`,
    [version, file.name, checksum]
  );
  await saveDatabase();
  return { status: 'applied', version };
}

export async function applyPendingMigrations({ dryRun = false } = {}) {
  const files = await readMigrationFiles();
  const ups = files
    .filter((f) => f.direction === 'up')
    .sort((a, b) => a.version - b.version);
  const applied = await getAppliedMigrations();
  const appliedVersions = new Set(applied.map((m) => m.version));
  const results = [];
  for (const f of ups) {
    if (appliedVersions.has(f.version)) continue;
    try {
      const result = await applyMigration(f.version, { dryRun });
      results.push(result);
    } catch (err) {
      results.push({
        status: 'failed',
        version: f.version,
        error: err.message,
      });
      break;
    }
  }
  return results;
}

export async function rollbackMigration(version, { dryRun = false } = {}) {
  const files = await readMigrationFiles();
  const file = files.find(
    (f) => f.version === version && f.direction === 'down'
  );
  if (!file) throw new Error(`Down migration not found for version ${version}`);

  let sql;
  try {
    sql = await fsp.readFile(file.fullPath, 'utf8');
  } catch (err) {
    throw new Error(
      `Cannot read rollback file ${file.filename}: ${err.message}`
    );
  }

  if (dryRun) return { status: 'dry_run_success', version, sql };

  const db = await getDatabase();
  db.run(sql);
  db.run(
    `UPDATE ${MIGRATION_TABLE} SET status = 'rolled_back' WHERE version = ?`,
    [version]
  );
  await saveDatabase();
  return { status: 'rolled_back', version };
}

export async function getMigrationDashboard() {
  const files = await readMigrationFiles();
  const ups = files.filter((f) => f.direction === 'up');
  const applied = await getAppliedMigrations();
  const appliedVersions = new Set(applied.map((m) => m.version));
  return {
    total: ups.length,
    applied: applied.length,
    pending: ups.filter((f) => !appliedVersions.has(f.version)).length,
    migrations: applied,
  };
}

/**
 * Reads the first `-- @phase: expand|contract` comment from a migration SQL file.
 * Returns 'expand', 'contract', or null if no phase tag is present.
 */
export function detectPhase(sqlContent) {
  const m = sqlContent.match(/^--\s*@phase:\s*(expand|contract)/m);
  return m ? m[1] : null;
}

/**
 * Returns an array of warning strings for DDL statements that require a full
 * table rewrite in SQLite (e.g. ALTER TABLE ADD COLUMN NOT NULL without DEFAULT).
 */
export function detectLockingSQL(sql) {
  const warnings = [];
  if (
    /ALTER\s+TABLE\s+\S+\s+ADD\s+COLUMN\s+.+NOT\s+NULL(?!\s+DEFAULT)/i.test(sql)
  ) {
    warnings.push(
      'ADD COLUMN NOT NULL without DEFAULT requires a full table rewrite in SQLite'
    );
  }
  return warnings;
}

/**
 * Applies pending migrations filtered by phase.
 *   phase='expand'   → only migrations tagged `-- @phase: expand`
 *   phase='contract' → only migrations tagged `-- @phase: contract`
 *   phase=null       → all pending (same as applyPendingMigrations, backward compat)
 */
export async function applyPendingMigrationsPhased(
  phase = null,
  { dryRun = false } = {}
) {
  const files = await readMigrationFiles();
  const ups = files
    .filter((f) => f.direction === 'up')
    .sort((a, b) => a.version - b.version);
  const applied = await getAppliedMigrations();
  const appliedVersions = new Set(applied.map((m) => m.version));
  const results = [];

  for (const f of ups) {
    if (appliedVersions.has(f.version)) continue;

    let sql;
    try {
      sql = await fsp.readFile(f.fullPath, 'utf8');
    } catch (err) {
      results.push({
        status: 'failed',
        version: f.version,
        error: err.message,
        phase: null,
      });
      break;
    }

    const filePhase = detectPhase(sql);
    if (phase !== null && filePhase !== phase) continue;

    const lockWarns = detectLockingSQL(sql);
    lockWarns.forEach((w) =>
      console.warn(`[migration ${f.version}] LOCK WARNING: ${w}`)
    );

    try {
      const r = await applyMigration(f.version, { dryRun });
      results.push({ ...r, phase: filePhase, lockWarnings: lockWarns });
    } catch (err) {
      results.push({
        status: 'failed',
        version: f.version,
        error: err.message,
        phase: filePhase,
      });
      break;
    }
  }

  return results;
}

/**
 * Initialises the migration tracking table and applies all pending migrations.
 * Intended to be called at server startup before the HTTP server begins listening.
 */
export async function runStartupMigrations() {
  await initializeMigrationService();
  return applyPendingMigrations({ dryRun: false });
}
