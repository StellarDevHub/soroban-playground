import dotenv from "dotenv";

// Load .env early
dotenv.config();

// Helper to coerce ints with fallback
const toInt = (value, fallback) => {
  if (value === undefined || value === null) return fallback;
  const n = parseInt(String(value), 10);
  return Number.isFinite(n) ? n : fallback;
};

const DEFAULTS = {
  APP_PORT: 5000,
  APP_ENV: "development",
  GLOBAL_RATE_LIMIT_WINDOW_MS: 15 * 60 * 1000,
  GLOBAL_RATE_LIMIT_MAX: 1000,
  COMPILE_RATE_LIMIT_WINDOW_MS: 15 * 60 * 1000,
  COMPILE_RATE_LIMIT_MAX: 15,
  COMPILE_COMMAND: "cargo build --target wasm32-unknown-unknown --release",
  COMPILE_TIMEOUT_MS: 30000,
  COMPILE_TEMP_DIR_PREFIX: ".tmp_compile_",
  WASM_TARGET_SUBPATH: "target/wasm32-unknown-unknown/release",
  WASM_FILENAME: "soroban_contract.wasm",
  SOROBAN_SDK_VERSION: "20.0.0",
  DEFAULT_NETWORK: "testnet",
  DEPLOY_SIMULATED_DELAY_MS: 1500,
  INVOKE_SIMULATED_DELAY_MS: 1000,
};

const config = {
  app: {
    port: toInt(process.env.PORT || process.env.APP_PORT, DEFAULTS.APP_PORT),
    env: process.env.APP_ENV || process.env.NODE_ENV || DEFAULTS.APP_ENV,
  },
  rateLimit: {
    global: {
      windowMs: toInt(
        process.env.GLOBAL_RATE_LIMIT_WINDOW_MS,
        DEFAULTS.GLOBAL_RATE_LIMIT_WINDOW_MS,
      ),
      max: toInt(
        process.env.GLOBAL_RATE_LIMIT_MAX,
        DEFAULTS.GLOBAL_RATE_LIMIT_MAX,
      ),
    },
    compile: {
      windowMs: toInt(
        process.env.COMPILE_RATE_LIMIT_WINDOW_MS,
        DEFAULTS.COMPILE_RATE_LIMIT_WINDOW_MS,
      ),
      max: toInt(
        process.env.COMPILE_RATE_LIMIT_MAX,
        DEFAULTS.COMPILE_RATE_LIMIT_MAX,
      ),
    },
  },
  compile: {
    command: process.env.COMPILE_COMMAND || DEFAULTS.COMPILE_COMMAND,
    timeoutMs: toInt(
      process.env.COMPILE_TIMEOUT_MS,
      DEFAULTS.COMPILE_TIMEOUT_MS,
    ),
    tempDirPrefix:
      process.env.COMPILE_TEMP_DIR_PREFIX || DEFAULTS.COMPILE_TEMP_DIR_PREFIX,
    wasmTargetSubpath:
      process.env.WASM_TARGET_SUBPATH || DEFAULTS.WASM_TARGET_SUBPATH,
    wasmFilename: process.env.WASM_FILENAME || DEFAULTS.WASM_FILENAME,
    sorobanSdkVersion:
      process.env.SOROBAN_SDK_VERSION || DEFAULTS.SOROBAN_SDK_VERSION,
  },
  network: {
    default: process.env.DEFAULT_NETWORK || DEFAULTS.DEFAULT_NETWORK,
  },
  simulationDelays: {
    deployMs: toInt(
      process.env.DEPLOY_SIMULATED_DELAY_MS,
      DEFAULTS.DEPLOY_SIMULATED_DELAY_MS,
    ),
    invokeMs: toInt(
      process.env.INVOKE_SIMULATED_DELAY_MS,
      DEFAULTS.INVOKE_SIMULATED_DELAY_MS,
    ),
  },
};

// Basic validation / warnings
if (config.rateLimit.global.max <= 0) {
  console.warn("CONFIG WARNING: GLOBAL_RATE_LIMIT_MAX is <= 0, using default");
  config.rateLimit.global.max = DEFAULTS.GLOBAL_RATE_LIMIT_MAX;
}
if (config.rateLimit.compile.max <= 0) {
  console.warn("CONFIG WARNING: COMPILE_RATE_LIMIT_MAX is <= 0, using default");
  config.rateLimit.compile.max = DEFAULTS.COMPILE_RATE_LIMIT_MAX;
}

export default config;
