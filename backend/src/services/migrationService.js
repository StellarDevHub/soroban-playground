import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import DatabaseService from './databaseService.js';
import { getDatabase, saveDatabase } from './dbService.js';

const IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Mapping of SQLite column types to PostgreSQL equivalents.
 */
export const SQLITE_TO_PG_TYPE_MAP = Object.freeze({
  DATETIME: 'TIMESTAMPTZ',
  BLOB: 'BYTEA',
});

/**
 * Validates and returns a safe SQL identifier (table or column name).
 */
export function sanitizeIdentifier(identifier) {
  if (typeof identifier !== 'string' || !IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${String(identifier)}`);
  }
  return identifier;
}

/**
 * Sanitizes a raw SQL query string by removing null bytes and normalizing whitespace.
 */
export function sanitizeQueryString(sql) {
  if (typeof sql !== 'string') {
    throw new Error('SQL query must be a string');
  }
  // Strip null bytes and other non-printable control characters (preserving \t, \n, \r)
  // eslint-disable-next-line no-control-regex
  const cleaned = sql.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
  if (!cleaned) {
    throw new Error('SQL query cannot be empty');
  }
  return cleaned;
}

/**
 * Converts `?` positional placeholders to PostgreSQL `$1, $2, ...` placeholders
 * when targeting PostgreSQL.
 */
export function formatPlaceholdersForDialect(sql, dialect = 'sqlite3') {
  const sanitized = sanitizeQueryString(sql);
  if (dialect !== 'pg' && dialect !== 'postgresql') {
    return sanitized;
  }
  let idx = 0;
  return sanitized.replace(/\?/g, () => `$${++idx}`);
}

/**
 * Maps a SQLite datatype name to its PostgreSQL equivalent.
 */
export function mapSqliteTypeToPostgres(sqliteType) {
  if (typeof sqliteType !== 'string') return sqliteType;
  const upper = sqliteType.trim().toUpperCase();
  return SQLITE_TO_PG_TYPE_MAP[upper] || sqliteType;
}

/**
 * Translates SQLite-flavored DDL/DML SQL strings into PostgreSQL-compatible SQL
 * when targeting PostgreSQL. For SQLite dialects, returns the sanitized SQL unchanged.
 */
export function translateSQLForDialect(sql, dialect = 'sqlite3') {
  const sanitized = sanitizeQueryString(sql);
  if (dialect !== 'pg' && dialect !== 'postgresql') {
    return sanitized;
  }

  let translated = sanitized;
  // INTEGER PRIMARY KEY AUTOINCREMENT -> SERIAL PRIMARY KEY
  translated = translated.replace(
    /\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi,
    'SERIAL PRIMARY KEY'
  );
  // DATETIME -> TIMESTAMPTZ
  translated = translated.replace(/\bDATETIME\b/gi, 'TIMESTAMPTZ');
  // BLOB -> BYTEA
  translated = translated.replace(/\bBLOB\b/gi, 'BYTEA');
  // datetime('now') -> CURRENT_TIMESTAMP
  translated = translated.replace(
    /\(\s*datetime\s*\(\s*'now'\s*\)\s*\)/gi,
    'CURRENT_TIMESTAMP'
  );
  translated = translated.replace(
    /\bdatetime\s*\(\s*'now'\s*\)/gi,
    'CURRENT_TIMESTAMP'
  );
  // INSERT OR IGNORE INTO ... ; -> INSERT INTO ... ON CONFLICT DO NOTHING;
  translated = translated.replace(
    /\bINSERT\s+OR\s+IGNORE\s+INTO\b([\s\S]*?)(;|$)/gi,
    (match, body, terminator) => {
      if (/\bON\s+CONFLICT\b/i.test(body)) {
        return `INSERT INTO${body}${terminator}`;
      }
      return `INSERT INTO${body} ON CONFLICT DO NOTHING${terminator}`;
    }
  );

  return translated;
}

class MigrationService {
  constructor(dbPath = null, migrationsPath = null, dialect = null) {
    this.dbService = new DatabaseService(dbPath);
    this.migrationsPath =
      migrationsPath || path.join(process.cwd(), 'migrations');
    this.migrationTable = sanitizeIdentifier('_schema_migrations');
    this.dialect = dialect || process.env.DATABASE_CLIENT || 'sqlite3';
  }

  async initialize() {
    await this.dbService.connect();
    await this.createMigrationTable();
  }

  async createMigrationTable() {
    const tableName = sanitizeIdentifier(this.migrationTable);
    const isPg = this.dialect === 'pg' || this.dialect === 'postgresql';
    const idColumn = isPg
      ? 'id SERIAL PRIMARY KEY'
      : 'id INTEGER PRIMARY KEY AUTOINCREMENT';
    const appliedAtType = isPg ? 'TIMESTAMPTZ' : 'DATETIME';
    const sql = sanitizeQueryString(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        ${idColumn},
        version VARCHAR(255) NOT NULL UNIQUE,
        checksum VARCHAR(64) NOT NULL,
        applied_at ${appliedAtType} DEFAULT CURRENT_TIMESTAMP,
        execution_time INTEGER NOT NULL,
        status VARCHAR(20) DEFAULT 'applied'
      )
    `);
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
    const tableName = sanitizeIdentifier(this.migrationTable);
    const sql = formatPlaceholdersForDialect(
      `SELECT version, checksum, applied_at, execution_time, status FROM ${tableName} ORDER BY version`,
      this.dialect
    );
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

    const tableName = sanitizeIdentifier(this.migrationTable);
    const appliedMigration = await this.dbService.get(
      formatPlaceholdersForDialect(
        `SELECT checksum FROM ${tableName} WHERE version = ?`,
        this.dialect
      ),
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

    const translatedSql = translateSQLForDialect(content, this.dialect);
    const tableName = sanitizeIdentifier(this.migrationTable);
    const startTime = Date.now();

    try {
      await this.dbService.transaction(async (db) => {
        await db.run(translatedSql);
        await db.run(
          formatPlaceholdersForDialect(
            `INSERT INTO ${tableName} (version, checksum, execution_time, status) VALUES (?, ?, ?, ?)`,
            this.dialect
          ),
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

    const translatedSql = translateSQLForDialect(content, this.dialect);
    const tableName = sanitizeIdentifier(this.migrationTable);
    const startTime = Date.now();

    try {
      await this.dbService.transaction(async (db) => {
        await db.run(translatedSql);
        await db.run(
          formatPlaceholdersForDialect(
            `UPDATE ${tableName} SET status = ?, execution_time = ? WHERE version = ?`,
            this.dialect
          ),
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

  async migrateUp(dryRun = false, limit = null) {
    const pendingMigrations = await this.getPendingMigrations();
    const results = [];
    let count = 0;

    for (const migration of pendingMigrations) {
      if (limit !== null && count >= limit) {
        break;
      }
      try {
        const result = await this.executeMigration(migration, dryRun);
        results.push(result);
        if (result.success) {
          count++;
        }

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

const MIGRATION_TABLE = sanitizeIdentifier('_schema_migrations');

function getMigrationsDir() {
  return process.env.MIGRATIONS_DIR || path.join(process.cwd(), 'migrations');
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function ensureMigrationTable(db) {
  const tableName = sanitizeIdentifier(MIGRATION_TABLE);
  db.run(
    sanitizeQueryString(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT DEFAULT (datetime('now')),
      status TEXT DEFAULT 'applied'
    )
  `)
  );
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
  const tableName = sanitizeIdentifier(MIGRATION_TABLE);
  const result = db.exec(
    sanitizeQueryString(
      `SELECT version, name, checksum, applied_at, status FROM ${tableName} ORDER BY version`
    )
  );
  if (!result.length) return [];
  const [{ columns, values }] = result;
  return values.map((row) =>
    Object.fromEntries(columns.map((c, i) => [c, row[i]]))
  );
}

export async function applyMigration(version, { dryRun = false } = {}) {
  const numericVersion = Number(version);
  if (!Number.isInteger(numericVersion) || numericVersion < 0) {
    throw new Error(`Invalid migration version: ${String(version)}`);
  }

  const files = await readMigrationFiles();
  const file = files.find(
    (f) => f.version === numericVersion && f.direction === 'up'
  );
  if (!file)
    throw new Error(`Migration file not found for version ${numericVersion}`);

  let sql;
  try {
    sql = await fsp.readFile(file.fullPath, 'utf8');
  } catch (err) {
    throw new Error(
      `Cannot read migration file ${file.filename}: ${err.message}`
    );
  }

  const sanitizedSql = sanitizeQueryString(sql);
  const checksum = sha256(sql);
  const db = await getDatabase();
  const tableName = sanitizeIdentifier(MIGRATION_TABLE);

  const existing = db.exec(
    sanitizeQueryString(`SELECT checksum FROM ${tableName} WHERE version = ?`),
    [numericVersion]
  );
  if (existing.length && existing[0].values.length) {
    const storedChecksum = existing[0].values[0][0];
    if (storedChecksum !== checksum) {
      throw new Error(
        `Checksum mismatch for migration ${numericVersion}: file has been modified`
      );
    }
    return { status: 'already_applied', version: numericVersion };
  }

  if (dryRun) return { status: 'dry_run_success', version: numericVersion, sql };

  db.run(sanitizedSql);
  db.run(
    sanitizeQueryString(
      `INSERT INTO ${tableName} (version, name, checksum, status) VALUES (?, ?, ?, 'applied')`
    ),
    [numericVersion, file.name, checksum]
  );
  await saveDatabase();
  return { status: 'applied', version: numericVersion };
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
  const numericVersion = Number(version);
  if (!Number.isInteger(numericVersion) || numericVersion < 0) {
    throw new Error(`Invalid migration version: ${String(version)}`);
  }

  const files = await readMigrationFiles();
  const file = files.find(
    (f) => f.version === numericVersion && f.direction === 'down'
  );
  if (!file)
    throw new Error(`Down migration not found for version ${numericVersion}`);

  let sql;
  try {
    sql = await fsp.readFile(file.fullPath, 'utf8');
  } catch (err) {
    throw new Error(
      `Cannot read rollback file ${file.filename}: ${err.message}`
    );
  }

  if (dryRun) return { status: 'dry_run_success', version: numericVersion, sql };

  const db = await getDatabase();
  const tableName = sanitizeIdentifier(MIGRATION_TABLE);
  db.run(sanitizeQueryString(sql));
  db.run(
    sanitizeQueryString(
      `UPDATE ${tableName} SET status = 'rolled_back' WHERE version = ?`
    ),
    [numericVersion]
  );
  await saveDatabase();
  return { status: 'rolled_back', version: numericVersion };
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
 * Verifies that all required tables exist in the database schema.
 */
export async function verifyKnexSchemaIntegrity(knex) {
  const expectedTables = [
    'users',
    'organizations',
    'api_keys',
    'rate_limit_usage',
    'tier_limits',
    'audit_log',
    'synthetic_assets',
    'positions',
    'cors_whitelist',
    'webhook_subscriptions',
    'webhook_deliveries',
    'contract_events',
    'contract_event_cursor',
    'contract_verification',
  ];

  const missingTables = [];
  for (const table of expectedTables) {
    const exists = await knex.schema.hasTable(table);
    if (!exists) missingTables.push(table);
  }

  if (missingTables.length > 0) {
    throw new Error(
      `Schema integrity check failed. Missing expected tables: ${missingTables.join(', ')}`
    );
  }

  return { valid: true, tablesChecked: expectedTables.length };
}

/**
 * Executes automated Knex migrations on startup with distributed migration locking
 * and schema integrity verification.
 */
export async function runKnexStartupMigrations(customKnex = null) {
  const env = process.env.NODE_ENV || 'development';
  const { default: knexConfig } = await import('../../knexfile.js');
  const { default: knexLib } = await import('knex');
  const config = knexConfig[env] || knexConfig.development;
  const knex = customKnex || knexLib(config);
  const createdInstance = !customKnex;

  try {
    console.log(
      '[Migrations] Running Knex startup migrations with distributed locking...'
    );
    const [batchNo, log] = await knex.migrate.latest();
    console.log(
      `[Migrations] Startup migrations complete. Batch ${batchNo}: ${log.length} migration(s) applied.`
    );

    const integrity = await verifyKnexSchemaIntegrity(knex);
    console.log('[Migrations] Schema integrity verified successfully.');

    return {
      success: true,
      batchNo,
      appliedMigrations: log,
      integrity,
    };
  } catch (err) {
    console.error('[Migrations] Startup migration failed:', err.message);
    throw err;
  } finally {
    if (createdInstance) {
      await knex.destroy().catch(() => {});
    }
  }
}

/**
 * Initialises the migration tracking table and applies all pending migrations.
 * Intended to be called at server startup before the HTTP server begins listening.
 */
export async function runStartupMigrations(customKnex = null) {
  try {
    return await runKnexStartupMigrations(customKnex);
  } catch (err) {
    console.warn(
      '[Migrations] Knex startup migration fallback to legacy runner:',
      err.message
    );
    await initializeMigrationService().catch(() => {});
    return applyPendingMigrations({ dryRun: false });
  }
}
