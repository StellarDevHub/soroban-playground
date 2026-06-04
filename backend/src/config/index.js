import dotenv from 'dotenv';

// Load .env early
dotenv.config();

const DEFAULTS = {
  APP_PORT: 5000,
  APP_ENV: 'development',
  GLOBAL_RATE_LIMIT_WINDOW_MS: 15 * 60 * 1000,
  GLOBAL_RATE_LIMIT_MAX: 1000,
  COMPILE_RATE_LIMIT_WINDOW_MS: 15 * 60 * 1000,
  COMPILE_RATE_LIMIT_MAX: 1500,
  COMPILE_COMMAND: 'cargo build --target wasm32-unknown-unknown --release',
  COMPILE_TIMEOUT_MS: 120000,
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
      port: toInt(portSource.value, DEFAULTS.APP_PORT, portSource.key, warnings, {
        min: 1,
        max: 65535,
      }),
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
