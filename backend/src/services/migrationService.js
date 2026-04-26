import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDatabase } from './dbService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_MIGRATIONS_DIR = path.join(__dirname, '../../migrations');
const MIGRATIONS_TABLE = 'schema_migrations';
const MIGRATION_FILE_RE = /^V(\d+)__([a-z0-9_]+)\.(up|down)\.sql$/i;
const DRY_RUN_TOKEN = 'MIGRATION_DRY_RUN_TOKEN';

function getMigrationsDir() {
  return process.env.MIGRATIONS_DIR || DEFAULT_MIGRATIONS_DIR;
}

async function ensureMigrationsDir() {
  await fs.mkdir(getMigrationsDir(), { recursive: true });
}

function normalizeSql(sql) {
  return sql.replace(/\r\n/g, '\n').trim();
}

function checksum(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function parseMigrationFilename(filename) {
  const match = MIGRATION_FILE_RE.exec(filename);
  if (!match) return null;
  return {
    version: match[1].padStart(3, '0'),
    name: match[2],
    direction: match[3],
    filename,
  };
}

async function loadMigrationFiles() {
  await ensureMigrationsDir();
  const entries = await fs.readdir(getMigrationsDir());
  const migrations = new Map();

  for (const filename of entries) {
    const parsed = parseMigrationFilename(filename);
    if (!parsed) continue;

    const key = `${parsed.version}__${parsed.name}`;
    const existing = migrations.get(key) || {
      version: parsed.version,
      name: parsed.name,
      upFile: null,
      downFile: null,
      upSql: null,
      downSql: null,
      upChecksum: null,
      downChecksum: null,
    };

    if (parsed.direction === 'up') {
      existing.upFile = filename;
    } else {
      existing.downFile = filename;
    }

    migrations.set(key, existing);
  }

  const sorted = [...migrations.values()].sort((a, b) => a.version.localeCompare(b.version));
  for (const migration of sorted) {
    if (!migration.upFile || !migration.downFile) {
      throw new Error(`Migration pair missing for version ${migration.version} (${migration.name}). Both .up.sql and .down.sql are required.`);
    }

    const upPath = path.join(getMigrationsDir(), migration.upFile);
    const downPath = path.join(getMigrationsDir(), migration.downFile);
    const [upSqlRaw, downSqlRaw] = await Promise.all([
      fs.readFile(upPath, 'utf8'),
      fs.readFile(downPath, 'utf8'),
    ]);

    migration.upSql = normalizeSql(upSqlRaw);
    migration.downSql = normalizeSql(downSqlRaw);
    migration.upChecksum = checksum(migration.upSql);
    migration.downChecksum = checksum(migration.downSql);

    if (!migration.upSql) {
      throw new Error(`Up migration file ${migration.upFile} is empty.`);
    }
    if (!migration.downSql) {
      throw new Error(`Down migration file ${migration.downFile} is empty.`);
    }
  }

  return sorted;
}

function hasForbiddenTransactionStatements(sql) {
  return /\b(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql);
}

function detectDestructiveOperations(sql) {
  const warnings = [];
  const normalized = sql.toUpperCase();

  if (/\bDROP\s+TABLE\b/.test(normalized)) {
    warnings.push('DROP TABLE detected');
  }
  if (/\bDROP\s+COLUMN\b/.test(normalized) || /\bALTER\s+TABLE\b[^;]*\bDROP\b/.test(normalized)) {
    warnings.push('DROP COLUMN detected');
  }
  if (/\bTRUNCATE\b/.test(normalized)) {
    warnings.push('TRUNCATE TABLE detected');
  }
  if (/\bDELETE\s+FROM\s+[^;]+\bWHERE\b/.test(normalized) === false && /\bDELETE\s+FROM\s+/.test(normalized)) {
    warnings.push('DELETE without WHERE detected');
  }

  return warnings;
}

function buildMigrationRow(migration, executionTimeMs, status) {
  return {
    version: migration.version,
    name: migration.name,
    checksum: migration.upChecksum,
    down_checksum: migration.downChecksum,
    applied_at: new Date().toISOString(),
    execution_time_ms: executionTimeMs,
    status,
  };
}

export async function ensureMigrationTable() {
  const db = await getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      down_checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      execution_time_ms INTEGER NOT NULL,
      status TEXT NOT NULL
    );
  `);
}

export async function getAppliedMigrations() {
  await ensureMigrationTable();
  const db = await getDatabase();
  const rows = db.prepare(`SELECT * FROM ${MIGRATIONS_TABLE} ORDER BY version ASC`).all();
  return rows;
}

export async function getMigrationDashboard() {
  const migrations = await loadMigrationFiles();
  const applied = await getAppliedMigrations();
  const appliedMap = new Map(applied.map((row) => [row.version, row]));

  return migrations.map((migration) => {
    const row = appliedMap.get(migration.version);
    return {
      version: migration.version,
      name: migration.name,
      applied: Boolean(row && row.status === 'applied'),
      status: row?.status || 'pending',
      checksum: migration.upChecksum,
      downChecksum: migration.downChecksum,
      appliedAt: row?.applied_at || null,
      executionTimeMs: row?.execution_time_ms || null,
      warnings: detectDestructiveOperations(migration.upSql),
    };
  });
}

export async function validateMigrations() {
  const migrations = await loadMigrationFiles();
  const issues = [];

  for (const migration of migrations) {
    if (hasForbiddenTransactionStatements(migration.upSql) || hasForbiddenTransactionStatements(migration.downSql)) {
      issues.push(`Migration ${migration.version} uses explicit transaction statements; remove BEGIN/COMMIT/ROLLBACK from migration SQL so the runner can manage transaction boundaries.`);
    }
    const warnings = detectDestructiveOperations(migration.upSql);
    if (warnings.length) {
      issues.push(`Migration ${migration.version} contains destructive operations: ${warnings.join(', ')}`);
    }
  }

  return issues;
}

export async function findMigration(version) {
  const migrations = await loadMigrationFiles();
  return migrations.find((migration) => migration.version === String(version).padStart(3, '0')); 
}

async function loadMigrationMetadata(version) {
  await ensureMigrationTable();
  const db = await getDatabase();
  return db.prepare(`SELECT * FROM ${MIGRATIONS_TABLE} WHERE version = ?`).get(String(version).padStart(3, '0'));
}

function recordMigration(db, migration, executionTimeMs, status) {
  const row = buildMigrationRow(migration, executionTimeMs, status);
  db.prepare(`
    INSERT OR REPLACE INTO ${MIGRATIONS_TABLE}
    (version, name, checksum, down_checksum, applied_at, execution_time_ms, status)
    VALUES (@version, @name, @checksum, @down_checksum, @applied_at, @execution_time_ms, @status)
  `).run(row);
}

function removeMigrationRecord(db, version) {
  db.prepare(`DELETE FROM ${MIGRATIONS_TABLE} WHERE version = ?`).run(String(version).padStart(3, '0'));
}

function executeSql(db, sql) {
  if (!sql || !sql.trim()) return;
  db.exec(sql);
}

function runSqlWithTransaction(db, sql, description) {
  const transaction = db.transaction(() => {
    executeSql(db, sql);
  });
  transaction();
}

export async function applyMigration(version, options = {}) {
  const migration = await findMigration(version);
  if (!migration) {
    throw new Error(`Migration version ${version} not found.`);
  }

  const applied = await loadMigrationMetadata(migration.version);
  if (applied && applied.status === 'applied') {
    if (applied.checksum !== migration.upChecksum) {
      throw new Error(`Checksum mismatch for applied migration ${migration.version}: migration SQL has changed since it was applied.`);
    }
    return {
      version: migration.version,
      status: 'already_applied',
      message: `Migration ${migration.version} is already applied and checksum is valid.`,
    };
  }

  if (hasForbiddenTransactionStatements(migration.upSql) || hasForbiddenTransactionStatements(migration.downSql)) {
    throw new Error('Migration SQL must not include explicit transaction control statements (BEGIN, COMMIT, ROLLBACK).');
  }

  const destructiveWarnings = detectDestructiveOperations(migration.upSql);
  if (destructiveWarnings.length && !options.allowDestructive) {
    throw new Error(`Destructive operations detected: ${destructiveWarnings.join(', ')}. Use allowDestructive=true to proceed.`);
  }

  const db = await getDatabase();
  const start = Date.now();

  if (options.dryRun) {
    try {
      const dryTransaction = db.transaction(() => {
        db.exec(migration.upSql);
        throw new Error(DRY_RUN_TOKEN);
      });
      dryTransaction();
    } catch (error) {
      if (error.message !== DRY_RUN_TOKEN) {
        throw new Error(`Dry-run validation failed for migration ${migration.version}: ${error.message}`);
      }
    }

    return {
      version: migration.version,
      status: 'dry_run_success',
      message: `Dry-run successful for migration ${migration.version}.`,
      executionTimeMs: Date.now() - start,
      warnings: destructiveWarnings,
    };
  }

  try {
    const runTransaction = db.transaction(() => {
      db.exec(migration.upSql);
      recordMigration(db, migration, Date.now() - start, 'applied');
    });
    runTransaction();

    return {
      version: migration.version,
      status: 'applied',
      message: `Migration ${migration.version} applied successfully.`,
      executionTimeMs: Date.now() - start,
    };
  } catch (error) {
    const rollbackResult = {
      rollbackAttempted: false,
      rollbackSuccess: false,
      rollbackError: null,
    };

    if (migration.downSql) {
      try {
        rollbackResult.rollbackAttempted = true;
        await rollbackMigration(migration.version, { dryRun: false, force: true });
        rollbackResult.rollbackSuccess = true;
      } catch (rollbackError) {
        rollbackResult.rollbackError = rollbackError.message;
      }
    }

    throw new Error(`Migration ${migration.version} failed: ${error.message}. rollback=${rollbackResult.rollbackSuccess} ${rollbackResult.rollbackError ? `error=${rollbackResult.rollbackError}` : ''}`);
  }
}

export async function rollbackMigration(version, options = {}) {
  const migration = await findMigration(version);
  if (!migration) {
    throw new Error(`Migration version ${version} not found.`);
  }

  const applied = await loadMigrationMetadata(migration.version);
  if (!applied || applied.status !== 'applied') {
    return {
      version: migration.version,
      status: 'not_applied',
      message: `Migration ${migration.version} is not currently applied, so it cannot be rolled back.`,
    };
  }

  if (hasForbiddenTransactionStatements(migration.downSql)) {
    throw new Error('Down migration SQL must not include explicit transaction control statements (BEGIN, COMMIT, ROLLBACK).');
  }

  const destructiveWarnings = detectDestructiveOperations(migration.downSql);
  if (destructiveWarnings.length && !options.allowDestructive) {
    throw new Error(`Destructive operations detected in rollback migration: ${destructiveWarnings.join(', ')}. Use allowDestructive=true to proceed.`);
  }

  const db = await getDatabase();
  const start = Date.now();

  if (options.dryRun) {
    try {
      const dryTransaction = db.transaction(() => {
        db.exec(migration.downSql);
        throw new Error(DRY_RUN_TOKEN);
      });
      dryTransaction();
    } catch (error) {
      if (error.message !== DRY_RUN_TOKEN) {
        throw new Error(`Dry-run validation failed for rollback ${migration.version}: ${error.message}`);
      }
    }

    return {
      version: migration.version,
      status: 'dry_run_success',
      message: `Dry-run successful for rollback of migration ${migration.version}.`,
      executionTimeMs: Date.now() - start,
      warnings: destructiveWarnings,
    };
  }

  try {
    const rollbackTransaction = db.transaction(() => {
      db.exec(migration.downSql);
      removeMigrationRecord(db, migration.version);
    });
    rollbackTransaction();

    return {
      version: migration.version,
      status: 'rolled_back',
      message: `Migration ${migration.version} rolled back successfully.`,
      executionTimeMs: Date.now() - start,
    };
  } catch (error) {
    throw new Error(`Rollback of migration ${migration.version} failed: ${error.message}`);
  }
}

export async function getPendingMigrations() {
  const migrations = await loadMigrationFiles();
  const applied = await getAppliedMigrations();
  const appliedSet = new Set(applied.filter((row) => row.status === 'applied').map((row) => row.version));
  return migrations.filter((migration) => !appliedSet.has(migration.version));
}

export async function applyPendingMigrations(options = {}) {
  const pending = await getPendingMigrations();
  const results = [];

  for (const migration of pending) {
    const result = await applyMigration(migration.version, options);
    results.push(result);
  }

  return results;
}

export async function initializeMigrationService() {
  await ensureMigrationsDir();
  await ensureMigrationTable();
}
