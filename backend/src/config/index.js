import dotenv from 'dotenv';

// Load .env early
dotenv.config();

const DEFAULTS = {
  APP_PORT: 5000,
  APP_ENV: 'development',
  GLOBAL_RATE_LIMIT_WINDOW_MS: 15 * 60 * 1000,
  GLOBAL_RATE_LIMIT_MAX: 1000,
  COMPILE_RATE_LIMIT_WINDOW_MS: 60 * 1000,
  COMPILE_RATE_LIMIT_MAX: 10,
  COMPILE_COMMAND: 'cargo build --target wasm32-unknown-unknown --release',
  COMPILE_TIMEOUT_MS: 120000,
  COMPILE_MAX_SOURCE_BYTES: 1024 * 1024,
  COMPILE_TEMP_DIR_PREFIX: '.tmp_compile_',
  WASM_TARGET_SUBPATH: 'target/wasm32-unknown-unknown/release',
  WASM_FILENAME: 'soroban_contract.wasm',
  SOROBAN_SDK_VERSION: '20.0.0',
  DEFAULT_NETWORK: 'testnet',
  DEPLOY_SIMULATED_DELAY_MS: 1500,
  INVOKE_SIMULATED_DELAY_MS: 1000,
  TRACING_ENABLED: true,
  TRACING_SERVICE_NAME: 'soroban-playground-backend',
  TRACING_SERVICE_VERSION: '1.0.0',
  TRACING_JAEGER_ENDPOINT: undefined,
  TRACING_ZIPKIN_ENDPOINT: undefined,
  TRACING_SAMPLE_RATE_SUCCESS: 0.1,
  TRACING_SAMPLE_RATE_ERRORS: 1.0,
  TRACING_SLOW_REQUEST_THRESHOLD_MS: 5000,
  CREDENTIAL_ROTATION_INTERVAL_MS: 0,
  CREDENTIAL_SOURCE_FILE: undefined,
  CREDENTIAL_ROTATION_GRACE_MS: 5000,
  MEMORY_HEAP_LIMIT_MB: 512,
  MEMORY_HEAP_THRESHOLD_PCT: 85,
  HEAP_DUMP_DIR: '/tmp/heapdumps',
  HEAP_DUMP_INTERVAL_MS: 30000,
  SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
  INDEXER_POLL_INTERVAL_MS: 5000,
  BACKUP_ENABLED: false,
  BACKUP_CRON_SCHEDULE: '0 2 * * *',
  BACKUP_S3_PREFIX: 'sqlite-backups/',
  BACKUP_S3_REGION: 'us-east-1',
  BACKUP_RETENTION_COUNT: 30,
};

const CONFIG_WARNING_PREFIX = 'CONFIG WARNING';

const hasValue = (value) =>
  value !== undefined && value !== null && String(value).trim() !== '';

const cleanString = (value, fallback) => {
  if (!hasValue(value)) return fallback;
  return String(value).trim();
};

function warnFallback(warnings, key, value, fallback, reason) {
  warnings.push(
    `${key}=${JSON.stringify(value)} is invalid (${reason}); using ${fallback}`
  );
}

function toInt(value, fallback, key, warnings, { min, max } = {}) {
  if (!hasValue(value)) return fallback;

  const normalized = String(value).trim();
  const parsed = Number(normalized);

  if (!Number.isInteger(parsed)) {
    warnFallback(warnings, key, value, fallback, 'expected an integer');
    return fallback;
  }

  if (min !== undefined && parsed < min) {
    warnFallback(warnings, key, value, fallback, `must be >= ${min}`);
    return fallback;
  }

  if (max !== undefined && parsed > max) {
    warnFallback(warnings, key, value, fallback, `must be <= ${max}`);
    return fallback;
  }

  return parsed;
}

function toFloat(value, fallback, key, warnings, { min, max } = {}) {
  if (!hasValue(value)) return fallback;

  const parsed = Number(String(value).trim());

  if (!Number.isFinite(parsed)) {
    warnFallback(warnings, key, value, fallback, 'expected a number');
    return fallback;
  }

  if (min !== undefined && parsed < min) {
    warnFallback(warnings, key, value, fallback, `must be >= ${min}`);
    return fallback;
  }

  if (max !== undefined && parsed > max) {
    warnFallback(warnings, key, value, fallback, `must be <= ${max}`);
    return fallback;
  }

  return parsed;
}

function toBoolean(value, fallback, key, warnings) {
  if (!hasValue(value)) return fallback;

  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;

  warnFallback(warnings, key, value, fallback, 'expected a boolean');
  return fallback;
}

function getFirstValue(env, keys) {
  for (const key of keys) {
    if (hasValue(env[key])) return { key, value: env[key] };
  }
  return { key: keys[0], value: undefined };
}

function logConfigWarnings(warnings, logger = console) {
  if (!warnings.length || !logger?.warn) return;

  for (const warning of warnings) {
    logger.warn(`${CONFIG_WARNING_PREFIX}: ${warning}`);
  }
}

export function createConfig(env = process.env, options = {}) {
  const warnings = [];
  const portSource = getFirstValue(env, ['PORT', 'APP_PORT']);

  const config = {
    app: {
      port: toInt(
        portSource.value,
        DEFAULTS.APP_PORT,
        portSource.key,
        warnings,
        {
          min: 1,
          max: 65535,
        }
      ),
      env: cleanString(
        hasValue(env.APP_ENV) ? env.APP_ENV : env.NODE_ENV,
        DEFAULTS.APP_ENV
      ),
    },
    rateLimit: {
      global: {
        windowMs: toInt(
          env.GLOBAL_RATE_LIMIT_WINDOW_MS,
          DEFAULTS.GLOBAL_RATE_LIMIT_WINDOW_MS,
          'GLOBAL_RATE_LIMIT_WINDOW_MS',
          warnings,
          { min: 1 }
        ),
        max: toInt(
          env.GLOBAL_RATE_LIMIT_MAX,
          DEFAULTS.GLOBAL_RATE_LIMIT_MAX,
          'GLOBAL_RATE_LIMIT_MAX',
          warnings,
          { min: 1 }
        ),
      },
      compile: {
        windowMs: toInt(
          env.COMPILE_RATE_LIMIT_WINDOW_MS,
          DEFAULTS.COMPILE_RATE_LIMIT_WINDOW_MS,
          'COMPILE_RATE_LIMIT_WINDOW_MS',
          warnings,
          { min: 1 }
        ),
        max: toInt(
          env.COMPILE_RATE_LIMIT_MAX,
          DEFAULTS.COMPILE_RATE_LIMIT_MAX,
          'COMPILE_RATE_LIMIT_MAX',
          warnings,
          { min: 1 }
        ),
      },
    },
    compile: {
      command: cleanString(env.COMPILE_COMMAND, DEFAULTS.COMPILE_COMMAND),
      timeoutMs: toInt(
        env.COMPILE_TIMEOUT_MS,
        DEFAULTS.COMPILE_TIMEOUT_MS,
        'COMPILE_TIMEOUT_MS',
        warnings,
        { min: 1 }
      ),
      maxSourceBytes: toInt(
        env.COMPILE_MAX_SOURCE_BYTES,
        DEFAULTS.COMPILE_MAX_SOURCE_BYTES,
        'COMPILE_MAX_SOURCE_BYTES',
        warnings,
        { min: 1024 }
      ),
      tempDirPrefix: cleanString(
        env.COMPILE_TEMP_DIR_PREFIX,
        DEFAULTS.COMPILE_TEMP_DIR_PREFIX
      ),
      wasmTargetSubpath: cleanString(
        env.WASM_TARGET_SUBPATH,
        DEFAULTS.WASM_TARGET_SUBPATH
      ),
      wasmFilename: cleanString(env.WASM_FILENAME, DEFAULTS.WASM_FILENAME),
      sorobanSdkVersion: cleanString(
        env.SOROBAN_SDK_VERSION,
        DEFAULTS.SOROBAN_SDK_VERSION
      ),
    },
    network: {
      default: cleanString(env.DEFAULT_NETWORK, DEFAULTS.DEFAULT_NETWORK),
    },
    simulationDelays: {
      deployMs: toInt(
        env.DEPLOY_SIMULATED_DELAY_MS,
        DEFAULTS.DEPLOY_SIMULATED_DELAY_MS,
        'DEPLOY_SIMULATED_DELAY_MS',
        warnings,
        { min: 0 }
      ),
      invokeMs: toInt(
        env.INVOKE_SIMULATED_DELAY_MS,
        DEFAULTS.INVOKE_SIMULATED_DELAY_MS,
        'INVOKE_SIMULATED_DELAY_MS',
        warnings,
        { min: 0 }
      ),
    },
    tracing: {
      enabled: toBoolean(
        env.TRACING_ENABLED,
        DEFAULTS.TRACING_ENABLED,
        'TRACING_ENABLED',
        warnings
      ),
      serviceName: cleanString(
        env.TRACING_SERVICE_NAME,
        DEFAULTS.TRACING_SERVICE_NAME
      ),
      serviceVersion: cleanString(
        env.TRACING_SERVICE_VERSION,
        DEFAULTS.TRACING_SERVICE_VERSION
      ),
      jaegerEndpoint: cleanString(
        env.TRACING_JAEGER_ENDPOINT,
        DEFAULTS.TRACING_JAEGER_ENDPOINT
      ),
      zipkinEndpoint: cleanString(
        env.TRACING_ZIPKIN_ENDPOINT,
        DEFAULTS.TRACING_ZIPKIN_ENDPOINT
      ),
      sampleRateSuccess: toFloat(
        env.TRACING_SAMPLE_RATE_SUCCESS,
        DEFAULTS.TRACING_SAMPLE_RATE_SUCCESS,
        'TRACING_SAMPLE_RATE_SUCCESS',
        warnings,
        { min: 0, max: 1 }
      ),
      sampleRateErrors: toFloat(
        env.TRACING_SAMPLE_RATE_ERRORS,
        DEFAULTS.TRACING_SAMPLE_RATE_ERRORS,
        'TRACING_SAMPLE_RATE_ERRORS',
        warnings,
        { min: 0, max: 1 }
      ),
      slowRequestThresholdMs: toInt(
        env.TRACING_SLOW_REQUEST_THRESHOLD_MS,
        DEFAULTS.TRACING_SLOW_REQUEST_THRESHOLD_MS,
        'TRACING_SLOW_REQUEST_THRESHOLD_MS',
        warnings,
        { min: 1 }
      ),
    },
    credentialRotation: {
      // Periodic source-file poll interval; 0 disables the periodic check.
      intervalMs: toInt(
        env.CREDENTIAL_ROTATION_INTERVAL_MS,
        DEFAULTS.CREDENTIAL_ROTATION_INTERVAL_MS,
        'CREDENTIAL_ROTATION_INTERVAL_MS',
        warnings,
        { min: 0 }
      ),
      // Grace period before closing the old DB handle after a rotation.
      graceMs: toInt(
        env.CREDENTIAL_ROTATION_GRACE_MS,
        DEFAULTS.CREDENTIAL_ROTATION_GRACE_MS,
        'CREDENTIAL_ROTATION_GRACE_MS',
        warnings,
        { min: 0 }
      ),
      // Optional JSON file holding the rotatable credentials.
      sourceFile: cleanString(
        env.CREDENTIAL_SOURCE_FILE,
        DEFAULTS.CREDENTIAL_SOURCE_FILE
      ),
      // AES key for the in-memory credential store (random per-process if unset).
      encryptionKey: cleanString(env.CREDENTIAL_ENCRYPTION_KEY, undefined),
    },
    memory: {
      heapLimitMb: toInt(
        env.MEMORY_HEAP_LIMIT_MB,
        DEFAULTS.MEMORY_HEAP_LIMIT_MB,
        'MEMORY_HEAP_LIMIT_MB',
        warnings,
        { min: 64 }
      ),
      heapThresholdPct: toInt(
        env.MEMORY_HEAP_THRESHOLD_PCT,
        DEFAULTS.MEMORY_HEAP_THRESHOLD_PCT,
        'MEMORY_HEAP_THRESHOLD_PCT',
        warnings,
        { min: 1, max: 100 }
      ),
      heapDumpDir: cleanString(env.HEAP_DUMP_DIR, DEFAULTS.HEAP_DUMP_DIR),
      heapDumpIntervalMs: toInt(
        env.HEAP_DUMP_INTERVAL_MS,
        DEFAULTS.HEAP_DUMP_INTERVAL_MS,
        'HEAP_DUMP_INTERVAL_MS',
        warnings,
        { min: 1000 }
      ),
      heapDumpS3Bucket: cleanString(env.HEAP_DUMP_S3_BUCKET, undefined),
    },
    indexer: {
      rpcUrl: cleanString(env.SOROBAN_RPC_URL, DEFAULTS.SOROBAN_RPC_URL),
      contractIds: cleanString(env.CONTRACT_IDS_CSV, '')
        .split(',')
        .filter(Boolean),
      pollIntervalMs: toInt(
        env.INDEXER_POLL_INTERVAL_MS,
        DEFAULTS.INDEXER_POLL_INTERVAL_MS,
        'INDEXER_POLL_INTERVAL_MS',
        warnings,
        { min: 1000 }
      ),
    },
    backup: {
      enabled: toBoolean(env.BACKUP_ENABLED, DEFAULTS.BACKUP_ENABLED, 'BACKUP_ENABLED', warnings),
      cronSchedule: cleanString(env.BACKUP_CRON_SCHEDULE, DEFAULTS.BACKUP_CRON_SCHEDULE),
      s3Bucket: cleanString(env.BACKUP_S3_BUCKET, undefined),
      s3Prefix: cleanString(env.BACKUP_S3_PREFIX, DEFAULTS.BACKUP_S3_PREFIX),
      s3Region: cleanString(env.BACKUP_S3_REGION, DEFAULTS.BACKUP_S3_REGION),
      encryptionKey: cleanString(env.BACKUP_ENCRYPTION_KEY, undefined),
      retentionCount: toInt(
        env.BACKUP_RETENTION_COUNT,
        DEFAULTS.BACKUP_RETENTION_COUNT,
        'BACKUP_RETENTION_COUNT',
        warnings,
        { min: 1, max: 365 }
      ),
      tempDir: cleanString(env.BACKUP_TEMP_DIR, undefined),
    },
  };

  Object.defineProperty(config, 'validation', {
    enumerable: false,
    value: {
      valid: warnings.length === 0,
      warnings,
    },
  });

  if (options.reportWarnings !== false) {
    logConfigWarnings(warnings, options.logger);
  }

  return config;
}

const config = createConfig();

export default config;
