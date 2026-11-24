// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Startup environment variable validation (#1578)
 *
 * Uses Zod to define a strict schema for all required / optional environment
 * variables.  Call `validateStartupEnv()` once at process boot (before the
 * HTTP server binds).  If any required variable is missing or malformed the
 * process halts with a clear diagnostic report instead of silently starting
 * in a broken state.
 *
 * Optional variables that have safe defaults do NOT cause a startup failure;
 * they are included in the report as warnings only.
 */

import { z } from 'zod';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Accept common truthy / falsy string representations */
const booleanEnv = (defaultVal = false) =>
  z.union([z.string(), z.boolean(), z.undefined()]).transform((v) => {
    if (v === undefined || v === null) return defaultVal;
    if (typeof v === 'boolean') return v;
    const s = v.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(s)) return true;
    if (['false', '0', 'no', 'off', ''].includes(s)) return false;
    return defaultVal;
  });

/** Parse a numeric string; coerce to integer */
const intEnv = (def) =>
  z.union([z.string(), z.number(), z.undefined()]).transform((v) => {
    if (v === undefined || v === null) return def;
    if (typeof v === 'number') return Number.isNaN(v) ? def : Math.trunc(v);
    const s = v.trim();
    if (s === '') return def;
    const n = Number.parseInt(s, 10);
    return Number.isNaN(n) ? def : n;
  });

/** Parse a URL string (non-empty) */
const urlEnv = z.string().url();

/** Non-empty string */
const requiredStr = z.string().min(1, 'must be a non-empty string');

// ─── Schema ──────────────────────────────────────────────────────────────────

/**
 * REQUIRED variables – missing / malformed values halt the process.
 */
const REQUIRED_SCHEMA = z.object({
  JWT_SECRET: z
    .string()
    .min(16, 'JWT_SECRET must be at least 16 characters for security')
    .refine(
      (v) =>
        ![
          'soroban-playground-secret-key-2026',
          'dev-secret-change-me',
          'super_secret_jwt_key_for_dev_and_preview',
          'change-me',
          'secret',
        ].includes(v),
      {
        message:
          'JWT_SECRET is set to a known-insecure default; use a strong secret in production',
      }
    )
    .optional() // allowed to be absent in dev/test (warning, not error)
    .or(z.string().min(16)),
});

/**
 * ALL variables – defines shape, coercions, and defaults.
 * Used for the full diagnostic report.
 */
export const ENV_SCHEMA = z.object({
  // ─ App ─────────────────────────────────────────────────────────────────────
  NODE_ENV: z
    .enum(['development', 'test', 'production', 'staging'])
    .default('development'),
  APP_ENV: z
    .enum(['development', 'test', 'production', 'staging'])
    .optional()
    .default('development'),
  PORT: intEnv(5000),
  APP_PORT: intEnv(5000),

  // ─ Auth / JWT ──────────────────────────────────────────────────────────────
  JWT_SECRET: z.string().min(1).default('soroban-playground-secret-key-2026'),
  JWT_ISSUER: z.string().optional().default('soroban-playground'),
  JWT_AUDIENCE: z.string().optional().default('soroban-playground-api'),
  JWT_ACCESS_TOKEN_TTL_MS: intEnv(900_000),
  JWT_REFRESH_TOKEN_TTL_MS: intEnv(604_800_000),

  // ─ Stellar / SEP-0010 ─────────────────────────────────────────────────────
  STELLAR_NETWORK_PASSPHRASE: z
    .string()
    .optional()
    .default('Test SDF Network ; September 2015'),
  STELLAR_SERVER_ACCOUNT: z.string().optional(),
  STELLAR_SERVER_SECRET: z.string().optional(),
  SEP10_CHALLENGE_TTL_MS: intEnv(300_000),
  SEP10_HOME_DOMAIN: z.string().optional(),

  // ─ Database ────────────────────────────────────────────────────────────────
  DATABASE_URL: z.string().min(1).default('sqlite://data/soroban.db'),
  DB_TYPE: z
    .enum(['sqlite', 'postgresql', 'mysql'])
    .optional()
    .default('sqlite'),

  // ─ Redis ───────────────────────────────────────────────────────────────────
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  REDIS_TLS: booleanEnv(false),
  REDIS_TLS_REJECT_UNAUTHORIZED: booleanEnv(true),
  REDIS_CLUSTER_NODES: z.string().optional(),

  // ─ Soroban RPC ─────────────────────────────────────────────────────────────
  SOROBAN_RPC_URL: z
    .string()
    .min(1)
    .default('https://soroban-testnet.stellar.org'),
  SOROBAN_RPC_FALLBACK_URLS: z.string().optional(),
  SOROBAN_RPC_PUBLIC_URL: z.string().optional(),
  QUICKNODE_RPC_URL: z.string().optional(),
  BLOCKDAEMON_RPC_URL: z.string().optional(),
  HORIZON_URLS: z.string().optional(),
  RPC_TIMEOUT_MS: intEnv(15_000),
  RPC_HEALTH_CHECK_INTERVAL_MS: intEnv(10_000),
  RPC_MAX_LEDGER_LAG: intEnv(50),
  RPC_FAILURE_THRESHOLD: intEnv(3),
  RPC_RESET_TIMEOUT_MS: intEnv(30_000),

  // ─ Compilation ─────────────────────────────────────────────────────────────
  COMPILE_TIMEOUT_MS: intEnv(30_000),
  COMPILE_MAX_SOURCE_BYTES: intEnv(1_048_576),
  COMPILE_SANDBOX_MODE: z
    .enum(['auto', 'docker', 'process'])
    .optional()
    .default('auto'),
  COMPILE_SANDBOX_MEMORY_MB: intEnv(512),
  COMPILE_SANDBOX_CPU_CORES: intEnv(2),
  COMPILE_SANDBOX_PIDS_LIMIT: intEnv(256),

  // ─ Queue (BullMQ) ──────────────────────────────────────────────────────────
  BULLMQ_QUEUE_PREFIX: z.string().optional().default('bull'),
  BULLMQ_JOB_MAX_ATTEMPTS: intEnv(4),
  BULLMQ_RETRY_BACKOFF_MS: intEnv(1_000),
  QUEUE_JOB_ATTEMPTS: intEnv(3),
  QUEUE_RETRY_BACKOFF_MS: intEnv(5_000),

  // ─ CORS ────────────────────────────────────────────────────────────────────
  CORS_ALLOWED_ORIGINS: z.string().optional().default('*'),
  CORS_ALLOW_CREDENTIALS: booleanEnv(false),

  // ─ Rate Limiting ───────────────────────────────────────────────────────────
  GLOBAL_RATE_LIMIT_WINDOW_MS: intEnv(60_000),
  GLOBAL_RATE_LIMIT_MAX: intEnv(60),
  COMPILE_RATE_LIMIT_MAX: intEnv(15),
  DEPLOY_RATE_LIMIT_MAX: intEnv(15),

  // ─ Tracing ─────────────────────────────────────────────────────────────────
  TRACING_ENABLED: booleanEnv(false),
  TRACING_SERVICE_NAME: z
    .string()
    .optional()
    .default('soroban-playground-backend'),

  // ─ Backup ──────────────────────────────────────────────────────────────────
  BACKUP_ENABLED: booleanEnv(false),
  BACKUP_S3_BUCKET: z.string().optional(),
  BACKUP_ENCRYPTION_KEY: z.string().optional(),
});

// ─── Validation result ────────────────────────────────────────────────────────

/**
 * @typedef {object} EnvValidationResult
 * @property {boolean}  valid       – false if any critical error was found
 * @property {object}   env         – Parsed & coerced env object (safe to use)
 * @property {string[]} errors      – Fatal errors that should block startup
 * @property {string[]} warnings    – Non-fatal issues (e.g. insecure defaults)
 * @property {string}   report      – Human-readable diagnostic report
 */

/**
 * Validate environment variables against the schema.
 *
 * @param {object}  rawEnv     – Source object (defaults to process.env)
 * @param {object}  options
 * @param {boolean} options.strict    – When true, warnings about insecure
 *                                      defaults are also treated as errors
 * @returns {EnvValidationResult}
 */
export function validateEnvSchema(
  rawEnv = process.env,
  { strict = false } = {}
) {
  const errors = [];
  const warnings = [];

  // Full-schema parse (uses defaults for missing optional fields)
  const parseResult = ENV_SCHEMA.safeParse(rawEnv);

  let parsedEnv = {};
  if (!parseResult.success) {
    for (const issue of parseResult.error.issues) {
      const key = issue.path.join('.');
      const msg = `${key}: ${issue.message}`;
      // Treat issues on explicitly required fields as errors
      errors.push(msg);
    }
  } else {
    parsedEnv = parseResult.data;
  }

  // Security-specific warnings
  const isProduction =
    (rawEnv.NODE_ENV || rawEnv.APP_ENV || '').toLowerCase() === 'production';

  if (isProduction) {
    const insecureDefaults = [
      'soroban-playground-secret-key-2026',
      'dev-secret-change-me',
      'super_secret_jwt_key_for_dev_and_preview',
    ];
    const jwtSecret = rawEnv.JWT_SECRET || '';
    if (!jwtSecret || insecureDefaults.includes(jwtSecret)) {
      const msg =
        'JWT_SECRET is missing or set to a known-insecure default in production';
      if (strict) errors.push(msg);
      else warnings.push(msg);
    }

    if (!rawEnv.STELLAR_SERVER_ACCOUNT || !rawEnv.STELLAR_SERVER_SECRET) {
      warnings.push(
        'STELLAR_SERVER_ACCOUNT / STELLAR_SERVER_SECRET not set in production; SEP-0010 will use an ephemeral keypair'
      );
    }

    if (!rawEnv.BACKUP_S3_BUCKET && rawEnv.BACKUP_ENABLED === 'true') {
      errors.push('BACKUP_S3_BUCKET is required when BACKUP_ENABLED=true');
    }

    if (rawEnv.BACKUP_ENABLED === 'true' && !rawEnv.BACKUP_ENCRYPTION_KEY) {
      errors.push(
        'BACKUP_ENCRYPTION_KEY is required when BACKUP_ENABLED=true (AES-256 hex key)'
      );
    }
  }

  const valid = errors.length === 0;

  // Build human-readable report
  const lines = [
    `Environment validation: ${valid ? '✅ PASSED' : '❌ FAILED'}`,
  ];
  if (errors.length) {
    lines.push(`\nErrors (${errors.length}):`);
    errors.forEach((e) => lines.push(`  ✗ ${e}`));
  }
  if (warnings.length) {
    lines.push(`\nWarnings (${warnings.length}):`);
    warnings.forEach((w) => lines.push(`  ⚠ ${w}`));
  }

  return { valid, env: parsedEnv, errors, warnings, report: lines.join('\n') };
}

/**
 * Run startup validation and exit the process if critical env vars are missing.
 *
 * Designed to be called early in server.js, BEFORE the HTTP server binds.
 *
 * @param {object} options
 * @param {boolean} options.strict        – Treat security warnings as errors in prod
 * @param {boolean} options.haltOnError   – Call process.exit(1) on errors (default true in prod)
 * @param {object}  options.logger        – Logger with .error/.warn/.info methods
 * @returns {EnvValidationResult}
 */
export function validateStartupEnv({
  strict = false,
  haltOnError,
  logger = console,
} = {}) {
  const isProduction =
    (process.env.NODE_ENV || process.env.APP_ENV || '').toLowerCase() ===
    'production';

  // Default: halt in production, warn in development/test
  const shouldHalt = haltOnError !== undefined ? haltOnError : isProduction;

  const result = validateEnvSchema(process.env, { strict });

  if (!result.valid) {
    logger.error('[startup] Environment validation failed:\n' + result.report);
    if (shouldHalt) {
      process.exit(1);
    }
  } else if (result.warnings.length > 0) {
    logger.warn('[startup] Environment validation warnings:\n' + result.report);
  } else {
    logger.info?.('[startup] Environment validation passed');
  }

  return result;
}
