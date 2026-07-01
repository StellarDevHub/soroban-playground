import os from 'os';
import path from 'path';

const ENV_ALLOWLIST = [
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'TMP',
  'TEMP',
  'HOME',
  'USERPROFILE',
  'RUSTUP_HOME',
  'RUSTUP_TOOLCHAIN',
];

const DANGEROUS_OVERRIDE_VARS = [
  'LD_PRELOAD',
  'DYLD_INSERT_LIBRARIES',
  'RUSTC_WRAPPER',
  'RUSTFLAGS',
  'CARGO_BUILD_RUSTFLAGS',
  'CARGO_ENCODED_RUSTFLAGS',
  'CARGO_HOME',
  'CARGO_TARGET_DIR',
];

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

export function createBuildSandboxPaths(workspaceDir) {
  const cargoHome = path.join(workspaceDir, 'cargo-home');
  const cargoTargetDir = path.join(workspaceDir, 'target');
  const crateRoot = path.join(workspaceDir, 'crate');
  const sourceRoot = path.join(crateRoot, 'src');
  const wasmOutPath = path.join(
    cargoTargetDir,
    'wasm32-unknown-unknown',
    'release',
    'soroban_contract.wasm'
  );

  return {
    workspaceDir,
    cargoHome,
    cargoTargetDir,
    crateRoot,
    sourceRoot,
    wasmOutPath,
  };
}

export function createSandboxEnv(baseEnv, sandboxPaths) {
  const env = {};
  for (const key of ENV_ALLOWLIST) {
    if (typeof baseEnv[key] === 'string' && baseEnv[key].length > 0) {
      env[key] = baseEnv[key];
    }
  }

  for (const key of DANGEROUS_OVERRIDE_VARS) {
    delete env[key];
  }

  env.PATH = env.PATH || process.env.PATH || '';
  env.HOME = env.HOME || os.homedir();
  env.TMP = env.TMP || env.TEMP || os.tmpdir();
  env.TEMP = env.TEMP || env.TMP;
  env.CARGO_HOME = sandboxPaths.cargoHome;
  env.CARGO_TARGET_DIR = sandboxPaths.cargoTargetDir;
  env.RUST_MIN_STACK = '268435456';
  env.CARGO_TERM_COLOR = 'never';
  env.CARGO_NET_GIT_FETCH_WITH_CLI = 'false';

  return env;
}

export function assertSandboxedOutputPath(sandboxPaths, outputPath) {
  if (!isInside(sandboxPaths.cargoTargetDir, outputPath)) {
    throw new Error('Build output path escaped compile sandbox');
  }
}
