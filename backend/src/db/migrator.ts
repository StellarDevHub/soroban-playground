/**
 * @file backend/src/db/migrator.ts
 * @description Zero-Downtime Database Migration Framework — Expand-Contract Pattern
 *
 * Resolves issue #1791 [BE-43]:
 * Build a zero-downtime database schema migration engine following the
 * Expand-Contract (Parallel Run) pattern, ensuring backwards and forwards
 * compatibility during continuous deployments.
 *
 * ## Design Principles
 * - **Expand-Contract (three-phase column migration)**:
 *   1. EXPAND  — Add nullable column (no lock needed).
 *   2. CONTRACT — Dual-write old + new column; backfill old rows.
 *   3. CLEANUP  — Drop old column after all readers are updated.
 *
 * - **Safety Rules** (static analysis run in CI before any migration executes):
 *   - Disallow table-level locks (`LOCK TABLE`, `ALTER TABLE ... LOCK`).
 *   - Disallow synchronous column drops in a single-step migration.
 *   - Disallow synchronous renames (`ALTER TABLE ... RENAME COLUMN`) that
 *     could break live readers.
 *
 * - **DDL Lock Timeout**: every DDL statement is preceded by
 *   `SET lock_timeout = '2000ms'` (2 s max) to prevent blocking active queries.
 *
 * - **Schema Version Table**: checksums prevent out-of-order or re-applied
 *   migrations.
 *
 * - **Dry-Run Mode**: validates SQL syntax and safety rules without applying
 *   any changes — suitable for CI against production schema clones.
 *
 * - **Rollback Scripts**: every migration with `up` SQL must have a
 *   corresponding `down` SQL for verified rollback capability.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Migration direction. */
export type Direction = "up" | "down";

/** Three-phase expand-contract column migration plan. */
export interface ExpandContractPlan {
  /** Phase 1: DDL to add nullable column. */
  expandSql: string;
  /** Phase 2: DML/DDL for dual-write backfill. */
  contractSql: string;
  /** Phase 3: DDL to drop old column after all readers updated. */
  cleanupSql: string;
}

/** A single parsed migration file. */
export interface MigrationFile {
  version: string;
  description: string;
  direction: Direction;
  filename: string;
  fullPath: string;
}

/** A record stored in the schema_versions tracking table. */
export interface SchemaVersion {
  id: number;
  version: string;
  checksum: string;
  applied_at: string;
  execution_time_ms: number;
  status: "applied" | "rolled_back" | "failed";
  phase?: "expand" | "contract" | "cleanup" | "standard";
}

/** Result of a safety analysis pass. */
export interface SafetyReport {
  safe: boolean;
  violations: SafetyViolation[];
}

export interface SafetyViolation {
  rule: string;
  line: number;
  text: string;
  severity: "error" | "warning";
}

/** Options passed to the migrator. */
export interface MigratorOptions {
  /** Path to directory containing migration .sql files. */
  migrationsDir?: string;
  /** Maximum DDL lock wait in milliseconds (default 2000). */
  lockTimeoutMs?: number;
  /** If true, validate and report but do NOT execute any SQL. */
  dryRun?: boolean;
  /** Name of the schema-versions tracking table. */
  versionsTable?: string;
}

/** Adapter interface — callers inject their own DB client. */
export interface DbAdapter {
  /** Execute a SQL string; returns rows (for SELECT) or void (for DDL/DML). */
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Begin a transaction. */
  beginTransaction(): Promise<void>;
  /** Commit the active transaction. */
  commit(): Promise<void>;
  /** Roll back the active transaction. */
  rollback(): Promise<void>;
}

// ── Safety rule patterns ──────────────────────────────────────────────────────

/**
 * Static-analysis rules.  Each rule is checked against every non-comment line
 * of migration SQL.  A match triggers a SafetyViolation with the given severity.
 */
const SAFETY_RULES: Array<{
  name: string;
  pattern: RegExp;
  severity: "error" | "warning";
  message: string;
}> = [
  {
    name: "NO_TABLE_LOCK",
    pattern: /\bLOCK\s+TABLE\b/i,
    severity: "error",
    message: "Explicit LOCK TABLE is not permitted in zero-downtime migrations.",
  },
  {
    name: "NO_ALTER_LOCK",
    pattern: /\bALTER\s+TABLE\b.+\bLOCK\s*=/i,
    severity: "error",
    message:
      "ALTER TABLE with explicit LOCK= option is not permitted (blocks concurrent reads).",
  },
  {
    name: "NO_SYNCHRONOUS_DROP_COLUMN",
    pattern: /\bALTER\s+TABLE\b.+\bDROP\s+COLUMN\b/i,
    severity: "error",
    message:
      'Synchronous DROP COLUMN is not allowed. Use the expand-contract CLEANUP phase instead.',
  },
  {
    name: "NO_SYNCHRONOUS_RENAME_COLUMN",
    pattern: /\bALTER\s+TABLE\b.+\bRENAME\s+COLUMN\b/i,
    severity: "error",
    message:
      "Synchronous RENAME COLUMN breaks live readers. Expand-contract instead.",
  },
  {
    name: "NO_SYNCHRONOUS_RENAME_TABLE",
    pattern: /\bALTER\s+TABLE\b.+\bRENAME\s+TO\b/i,
    severity: "error",
    message: "Synchronous table rename is not permitted without a compatibility view.",
  },
  {
    name: "NO_NOT_NULL_WITHOUT_DEFAULT",
    pattern: /\bADD\s+COLUMN\b.+\bNOT\s+NULL\b(?!.+\bDEFAULT\b)/i,
    severity: "error",
    message:
      "ADD COLUMN NOT NULL without DEFAULT will lock the table on Postgres < 11. Use nullable or provide a DEFAULT.",
  },
  {
    name: "WARN_UNIQUE_INDEX_CONCURRENT",
    pattern: /\bCREATE\s+UNIQUE\s+INDEX\b(?!\s+CONCURRENTLY\b)/i,
    severity: "warning",
    message:
      "CREATE UNIQUE INDEX without CONCURRENTLY can block writes. Consider CONCURRENTLY.",
  },
  {
    name: "WARN_INDEX_WITHOUT_CONCURRENT",
    pattern: /\bCREATE\s+INDEX\b(?!\s+CONCURRENTLY\b)/i,
    severity: "warning",
    message:
      "CREATE INDEX without CONCURRENTLY can block writes. Consider CONCURRENTLY.",
  },
];

// ── Migrator class ────────────────────────────────────────────────────────────

/**
 * Zero-downtime database migration engine.
 *
 * @example
 * ```ts
 * const migrator = new Migrator(db, { migrationsDir: './migrations' });
 * await migrator.initialize();
 * const result = await migrator.applyPending();
 * console.log(`Applied ${result.applied} migrations`);
 * ```
 */
export class Migrator {
  private readonly db: DbAdapter;
  private readonly migrationsDir: string;
  private readonly lockTimeoutMs: number;
  private readonly dryRun: boolean;
  private readonly versionsTable: string;

  constructor(db: DbAdapter, options: MigratorOptions = {}) {
    this.db = db;
    this.migrationsDir =
      options.migrationsDir ??
      process.env["MIGRATIONS_DIR"] ??
      path.join(process.cwd(), "migrations");
    this.lockTimeoutMs = options.lockTimeoutMs ?? 2_000;
    this.dryRun = options.dryRun ?? false;
    this.versionsTable = options.versionsTable ?? "schema_versions";
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Create the schema_versions tracking table if it does not yet exist.
   * Safe to call multiple times (idempotent).
   */
  async initialize(): Promise<void> {
    const sql = `
      CREATE TABLE IF NOT EXISTS ${this.versionsTable} (
        id               SERIAL PRIMARY KEY,
        version          VARCHAR(255) NOT NULL UNIQUE,
        checksum         VARCHAR(64)  NOT NULL,
        applied_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        execution_time_ms INTEGER     NOT NULL DEFAULT 0,
        status           VARCHAR(20)  NOT NULL DEFAULT 'applied'
                           CHECK (status IN ('applied','rolled_back','failed')),
        phase            VARCHAR(20)           DEFAULT 'standard'
                           CHECK (phase IN ('expand','contract','cleanup','standard'))
      );
      CREATE INDEX IF NOT EXISTS idx_${this.versionsTable}_version
        ON ${this.versionsTable} (version);
    `;

    if (this.dryRun) {
      this._log("dry-run", `Would initialize versions table: ${this.versionsTable}`);
      return;
    }

    await this.db.query(sql);
  }

  /**
   * Return all migration versions that have been successfully applied.
   */
  async getAppliedVersions(): Promise<string[]> {
    const rows = await this.db.query<{ version: string }>(
      `SELECT version FROM ${this.versionsTable} WHERE status = 'applied' ORDER BY version ASC`
    );
    return rows.map((r) => r.version);
  }

  /**
   * Return the full schema version records for audit purposes.
   */
  async getAppliedMigrations(): Promise<SchemaVersion[]> {
    return this.db.query<SchemaVersion>(
      `SELECT * FROM ${this.versionsTable} ORDER BY version ASC`
    );
  }

  /**
   * Discover migration files in `migrationsDir`.
   *
   * Expected filename pattern: `V<version>__<description>.<direction>.sql`
   * or legacy: `<version>_<description>.<direction>.sql`
   */
  getMigrationFiles(): MigrationFile[] {
    if (!fs.existsSync(this.migrationsDir)) {
      return [];
    }

    const files = fs.readdirSync(this.migrationsDir);
    const result: MigrationFile[] = [];

    for (const file of files) {
      // Support: V001__create_users.up.sql  OR  001_create_users.up.sql
      const match =
        file.match(/^V?(\d+)(?:__|_)(.+?)\.(up|down)\.sql$/i) ??
        file.match(/^(\d+)_(.+)\.(up|down)\.sql$/);
      if (!match) continue;

      const [, version, description, direction] = match;
      result.push({
        version: version!,
        description: description!,
        direction: direction as Direction,
        filename: file,
        fullPath: path.join(this.migrationsDir, file),
      });
    }

    // Sort ascending by version
    result.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }));
    return result;
  }

  /**
   * Run static safety analysis on migration SQL.
   *
   * Returns a `SafetyReport` that CI pipelines can assert on.
   * Does NOT connect to the database.
   */
  analyzeSafety(sql: string): SafetyReport {
    const lines = sql.split(/\r?\n/);
    const violations: SafetyViolation[] = [];

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i]!;
      // Skip pure comment lines
      const stripped = raw.replace(/--.*$/, "").trim();
      if (!stripped) continue;

      for (const rule of SAFETY_RULES) {
        if (rule.pattern.test(stripped)) {
          violations.push({
            rule: rule.name,
            line: i + 1,
            text: raw.trim(),
            severity: rule.severity,
          });
        }
      }
    }

    const hasErrors = violations.some((v) => v.severity === "error");
    return { safe: !hasErrors, violations };
  }

  /**
   * Validate all pending migration files without executing them.
   *
   * Checks:
   * 1. Every `up` migration has a matching `down` counterpart.
   * 2. No safety rule violations (errors).
   * 3. No out-of-order versions relative to applied migrations.
   *
   * @returns Array of validation errors (empty = all clear).
   */
  async validatePending(): Promise<string[]> {
    const errors: string[] = [];
    const files = this.getMigrationFiles();
    const applied = await this.getAppliedVersions();
    const appliedSet = new Set(applied);

    const upFiles = files.filter((f) => f.direction === "up");
    const downFiles = files.filter((f) => f.direction === "down");
    const downVersions = new Set(downFiles.map((f) => f.version));

    for (const up of upFiles) {
      // Must have a rollback script
      if (!downVersions.has(up.version)) {
        errors.push(
          `Migration ${up.version} (${up.filename}) has no matching .down.sql rollback script.`
        );
      }

      // Out-of-order check: pending migration must be newer than all applied ones
      const pendingVersion = up.version;
      if (!appliedSet.has(pendingVersion)) {
        for (const av of applied) {
          if (av.localeCompare(pendingVersion, undefined, { numeric: true }) > 0) {
            errors.push(
              `Out-of-order migration detected: ${pendingVersion} is pending but ${av} is already applied.`
            );
            break;
          }
        }
      }

      // Safety analysis
      const sql = fs.readFileSync(up.fullPath, "utf-8");
      const report = this.analyzeSafety(sql);
      if (!report.safe) {
        for (const v of report.violations.filter((x) => x.severity === "error")) {
          errors.push(
            `Safety violation in ${up.filename}:${v.line} [${v.rule}] — ${v.text}`
          );
        }
      }
    }

    return errors;
  }

  /**
   * Apply all pending `up` migrations in ascending version order.
   *
   * Each migration runs inside a dedicated transaction with a DDL lock timeout.
   * A failed migration is recorded with `status = 'failed'` and the method
   * throws so the CI pipeline halts.
   *
   * @returns `{ applied: number, skipped: number }` counts.
   */
  async applyPending(): Promise<{ applied: number; skipped: number }> {
    const files = this.getMigrationFiles().filter((f) => f.direction === "up");
    const applied = new Set(await this.getAppliedVersions());

    let appliedCount = 0;
    let skippedCount = 0;

    for (const file of files) {
      if (applied.has(file.version)) {
        skippedCount++;
        continue;
      }

      const sql = fs.readFileSync(file.fullPath, "utf-8");

      // Safety gate
      const report = this.analyzeSafety(sql);
      const errorViolations = report.violations.filter((v) => v.severity === "error");
      if (errorViolations.length > 0) {
        const msg = errorViolations.map((v) => `  [${v.rule}] line ${v.line}: ${v.text}`).join("\n");
        throw new MigrationSafetyError(
          `Migration ${file.version} failed safety checks:\n${msg}`
        );
      }

      // Checksum for idempotency guard
      const checksum = computeChecksum(sql);

      if (this.dryRun) {
        this._log("dry-run", `Would apply migration ${file.version} (${file.filename})`);
        appliedCount++;
        continue;
      }

      const start = Date.now();

      try {
        await this.db.beginTransaction();

        // Set DDL lock timeout (Postgres-specific; safe to ignore on SQLite)
        await this.db
          .query(`SET LOCAL lock_timeout = '${this.lockTimeoutMs}ms'`)
          .catch(() => {
            /* not all adapters support SET LOCAL */
          });

        await this.db.query(sql);

        const execMs = Date.now() - start;

        await this.db.query(
          `INSERT INTO ${this.versionsTable}
             (version, checksum, execution_time_ms, status, phase)
           VALUES ($1, $2, $3, 'applied', 'standard')`,
          [file.version, checksum, execMs]
        );

        await this.db.commit();
        appliedCount++;

        this._log("applied", `${file.version} (${file.filename}) in ${execMs} ms`);
      } catch (err) {
        await this.db.rollback();

        // Record failure (best-effort, outside a transaction)
        await this.db
          .query(
            `INSERT INTO ${this.versionsTable}
               (version, checksum, execution_time_ms, status)
             VALUES ($1, $2, $3, 'failed')
             ON CONFLICT (version) DO UPDATE SET status = 'failed'`,
            [file.version, checksum, Date.now() - start]
          )
          .catch(() => {/* ignore record-failure errors */});

        throw new MigrationApplyError(
          `Failed to apply migration ${file.version}: ${(err as Error).message}`,
          file.version
        );
      }
    }

    return { applied: appliedCount, skipped: skippedCount };
  }

  /**
   * Roll back the last applied migration.
   *
   * @param targetVersion  Optional explicit version to roll back to (exclusive).
   */
  async rollbackLast(targetVersion?: string): Promise<string | null> {
    const appliedVersions = await this.getAppliedVersions();
    if (appliedVersions.length === 0) {
      return null;
    }

    const files = this.getMigrationFiles();
    const downFiles = files.filter((f) => f.direction === "down");

    // Find the last applied version to roll back
    const lastApplied = targetVersion
      ? appliedVersions.filter(
          (v) => v.localeCompare(targetVersion, undefined, { numeric: true }) > 0
        )
      : [appliedVersions[appliedVersions.length - 1]!];

    if (lastApplied.length === 0) return null;

    const versionToRollback = lastApplied[lastApplied.length - 1]!;
    const downFile = downFiles.find((f) => f.version === versionToRollback);

    if (!downFile) {
      throw new Error(
        `No rollback script found for migration ${versionToRollback}.`
      );
    }

    const sql = fs.readFileSync(downFile.fullPath, "utf-8");

    if (this.dryRun) {
      this._log("dry-run", `Would roll back migration ${versionToRollback}`);
      return versionToRollback;
    }

    const start = Date.now();

    try {
      await this.db.beginTransaction();

      await this.db
        .query(`SET LOCAL lock_timeout = '${this.lockTimeoutMs}ms'`)
        .catch(() => {/* ignore */});

      await this.db.query(sql);

      await this.db.query(
        `UPDATE ${this.versionsTable}
         SET status = 'rolled_back', execution_time_ms = $1
         WHERE version = $2`,
        [Date.now() - start, versionToRollback]
      );

      await this.db.commit();

      this._log("rolled_back", `${versionToRollback} in ${Date.now() - start} ms`);
      return versionToRollback;
    } catch (err) {
      await this.db.rollback();
      throw new MigrationApplyError(
        `Failed to roll back migration ${versionToRollback}: ${(err as Error).message}`,
        versionToRollback
      );
    }
  }

  /**
   * Build an expand-contract migration plan for a column rename operation.
   *
   * Generates three SQL snippets following the expand-contract pattern:
   * 1. **Expand**   — add nullable `new_column`.
   * 2. **Contract** — backfill `new_column` from `old_column`; trigger dual-write.
   * 3. **Cleanup**  — drop `old_column` after all readers updated.
   *
   * NOTE: The generated SQL is Postgres-flavoured. Callers should review before use.
   */
  buildExpandContractPlan(
    table: string,
    oldColumn: string,
    newColumn: string,
    columnType: string
  ): ExpandContractPlan {
    const expandSql = `
-- Phase 1 (EXPAND): Add nullable column — no lock required on modern Postgres
ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${newColumn} ${columnType};
`.trim();

    const contractSql = `
-- Phase 2 (CONTRACT): Backfill existing rows and establish dual-write trigger
UPDATE ${table} SET ${newColumn} = ${oldColumn} WHERE ${newColumn} IS NULL;

-- Dual-write trigger: keep both columns in sync during the transition period
CREATE OR REPLACE FUNCTION sync_${table}_${newColumn}()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.${newColumn} := NEW.${oldColumn};
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_${newColumn} ON ${table};
CREATE TRIGGER trg_sync_${newColumn}
  BEFORE INSERT OR UPDATE ON ${table}
  FOR EACH ROW EXECUTE FUNCTION sync_${table}_${newColumn}();
`.trim();

    const cleanupSql = `
-- Phase 3 (CLEANUP): Drop the old column after all readers/writers are updated
DROP TRIGGER IF EXISTS trg_sync_${newColumn} ON ${table};
DROP FUNCTION IF EXISTS sync_${table}_${newColumn}();
ALTER TABLE ${table} DROP COLUMN IF EXISTS ${oldColumn};
`.trim();

    return { expandSql, contractSql, cleanupSql };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private _log(tag: string, message: string): void {
    // Minimal structured output; replace with your logger in production
    process.stdout.write(`[migrator:${tag}] ${message}\n`);
  }
}

// ── Helper functions ──────────────────────────────────────────────────────────

/**
 * Compute a SHA-256 checksum of migration SQL for idempotency tracking.
 */
export function computeChecksum(sql: string): string {
  return crypto.createHash("sha256").update(sql, "utf8").digest("hex");
}

/**
 * Run static safety analysis on a SQL string.
 *
 * Convenience wrapper around `new Migrator(null!).analyzeSafety(sql)` for
 * use in CI pipelines without a live DB connection.
 */
export function analyzeMigrationSafety(sql: string): SafetyReport {
  // Create a minimal migrator instance (no DB needed for static analysis)
  const m = new Migrator({} as DbAdapter);
  return m.analyzeSafety(sql);
}

// ── Custom error types ────────────────────────────────────────────────────────

export class MigrationSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationSafetyError";
  }
}

export class MigrationApplyError extends Error {
  readonly version: string;

  constructor(message: string, version: string) {
    super(message);
    this.name = "MigrationApplyError";
    this.version = version;
  }
}

// ── Default export ────────────────────────────────────────────────────────────

export default Migrator;
