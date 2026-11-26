// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { sanitizeDependenciesInput } from '../../routes/compile_utils.js';

export const DEFAULT_RUSTC_VERSION = '1.80.0';
export const DEFAULT_SOROBAN_SDK_VERSION = '21.7.7';
export const WASM_TARGET = 'wasm32-unknown-unknown';

const SEMVER_EXACT_REGEX = /^\d+\.\d+\.\d+$/;
const ALLOWED_OPT_LEVELS = new Set(['z', 's', '0', '1', '2', '3']);
const WASM_MAGIC_HEADER = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

export const DEFAULT_RELEASE_PROFILE = Object.freeze({
  optLevel: 'z',
  overflowChecks: true,
  debug: 0,
  strip: 'symbols',
  debugAssertions: false,
  panic: 'abort',
  codegenUnits: 1,
  lto: true,
});

// Pinned compiler container images keyed by exact rustc version.
// Never uses mutable tags like `:latest`.
export const PINNED_BUILD_ENVIRONMENTS = Object.freeze({
  '1.78.0': Object.freeze({
    rustcVersion: '1.78.0',
    dockerImage:
      process.env.VERIFY_DOCKER_IMAGE_1_78_0 ||
      'stellar/soroban-compiler:rustc-1.78.0-wasm32@sha256:1780000000000000000000000000000000000000000000000000000000001780',
  }),
  '1.79.0': Object.freeze({
    rustcVersion: '1.79.0',
    dockerImage:
      process.env.VERIFY_DOCKER_IMAGE_1_79_0 ||
      'stellar/soroban-compiler:rustc-1.79.0-wasm32@sha256:1790000000000000000000000000000000000000000000000000000000001790',
  }),
  '1.80.0': Object.freeze({
    rustcVersion: '1.80.0',
    dockerImage:
      process.env.VERIFY_DOCKER_IMAGE_1_80_0 ||
      'stellar/soroban-compiler:rustc-1.80.0-wasm32@sha256:1800000000000000000000000000000000000000000000000000000000001800',
  }),
  '1.81.0': Object.freeze({
    rustcVersion: '1.81.0',
    dockerImage:
      process.env.VERIFY_DOCKER_IMAGE_1_81_0 ||
      'stellar/soroban-compiler:rustc-1.81.0-wasm32@sha256:1810000000000000000000000000000000000000000000000000000000001810',
  }),
});

export class DeterministicCompileError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'DeterministicCompileError';
    this.code = code;
    this.details = details;
  }
}

export function resolveBuildEnvironment(input = {}) {
  if (input !== null && input !== undefined && (typeof input !== 'object' || Array.isArray(input))) {
    throw new DeterministicCompileError(
      'INVALID_BUILD_ENV',
      'buildEnv must be a plain object'
    );
  }

  const envInput = input || {};
  const rustcVersion = String(envInput.rustcVersion || DEFAULT_RUSTC_VERSION).trim();
  const pinned = PINNED_BUILD_ENVIRONMENTS[rustcVersion];
  if (!pinned) {
    throw new DeterministicCompileError(
      'UNSUPPORTED_RUSTC_VERSION',
      `Unsupported rustcVersion "${rustcVersion}". Pinned versions: ${Object.keys(PINNED_BUILD_ENVIRONMENTS).join(', ')}`
    );
  }

  const sorobanSdkVersion = String(
    envInput.sorobanSdkVersion || DEFAULT_SOROBAN_SDK_VERSION
  ).trim();
  if (!SEMVER_EXACT_REGEX.test(sorobanSdkVersion)) {
    throw new DeterministicCompileError(
      'INVALID_SDK_VERSION',
      `sorobanSdkVersion must be an exact semver patch version (e.g. "${DEFAULT_SOROBAN_SDK_VERSION}")`
    );
  }

  const optLevel = String(
    envInput.optLevel !== undefined
      ? envInput.optLevel
      : DEFAULT_RELEASE_PROFILE.optLevel
  ).trim();
  if (!ALLOWED_OPT_LEVELS.has(optLevel)) {
    throw new DeterministicCompileError(
      'INVALID_OPT_LEVEL',
      `Unsupported optLevel "${optLevel}". Allowed: ${[...ALLOWED_OPT_LEVELS].join(', ')}`
    );
  }

  const profile = {
    ...DEFAULT_RELEASE_PROFILE,
    optLevel,
  };

  const rustflags = '--remap-path-prefix=/build=/src';

  return {
    rustcVersion: pinned.rustcVersion,
    sorobanSdkVersion,
    dockerImage: pinned.dockerImage,
    target: WASM_TARGET,
    profile,
    rustflags,
    env: {
      CARGO_HOME: '/build/cargo-home',
      CARGO_TARGET_DIR: '/build/target',
      CARGO_INCREMENTAL: '0',
      CARGO_TERM_COLOR: 'never',
      SOURCE_DATE_EPOCH: '0',
      LC_ALL: 'C',
      TZ: 'UTC',
      RUSTFLAGS: rustflags,
    },
  };
}

export function buildDeterministicCargoToml({
  sorobanSdkVersion = DEFAULT_SOROBAN_SDK_VERSION,
  dependencies = {},
  profile = DEFAULT_RELEASE_PROFILE,
} = {}) {
  if (!SEMVER_EXACT_REGEX.test(sorobanSdkVersion)) {
    throw new DeterministicCompileError(
      'INVALID_SDK_VERSION',
      `sorobanSdkVersion must be an exact semver patch version (got "${sorobanSdkVersion}")`
    );
  }

  const depCheck = sanitizeDependenciesInput(dependencies);
  if (!depCheck.ok) {
    throw new DeterministicCompileError(
      'INVALID_DEPENDENCIES',
      depCheck.error || 'Invalid dependencies',
      depCheck.details
    );
  }

  // Pin exact soroban-sdk patch version with "=" so Cargo cannot float to a newer patch
  const allDeps = {
    'soroban-sdk': `=${sorobanSdkVersion}`,
    ...depCheck.deps,
  };

  const depLines = Object.keys(allDeps)
    .sort()
    .map((name) => `${name} = "${allDeps[name]}"`)
    .join('\n');

  const mergedProfile = { ...DEFAULT_RELEASE_PROFILE, ...profile };

  return `[package]
name = "soroban_contract"
version = "0.0.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
${depLines}

[profile.release]
opt-level = "${mergedProfile.optLevel}"
overflow-checks = ${mergedProfile.overflowChecks}
debug = ${mergedProfile.debug}
strip = "${mergedProfile.strip}"
debug-assertions = ${mergedProfile.debugAssertions}
panic = "${mergedProfile.panic}"
codegen-units = ${mergedProfile.codegenUnits}
lto = ${mergedProfile.lto}
`;
}

export function buildDeterministicDockerArgs({
  workspaceDir,
  buildEnv,
  memoryMb = 512,
  cpuCores = 2,
  pidsLimit = 256,
  user = '1000:1000',
}) {
  const resolved = buildEnv?.dockerImage
    ? buildEnv
    : resolveBuildEnvironment(buildEnv);

  const envArgs = [];
  for (const [key, value] of Object.entries(resolved.env)) {
    envArgs.push('--env', `${key}=${value}`);
  }

  return [
    'run',
    '--rm',
    '--network',
    'none',
    '--memory',
    `${memoryMb}m`,
    '--memory-swap',
    `${memoryMb}m`,
    '--cpus',
    `${cpuCores}`,
    '--pids-limit',
    `${pidsLimit}`,
    '--read-only',
    '--tmpfs',
    '/tmp:rw,size=256m',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--user',
    user,
    ...envArgs,
    '--volume',
    `${workspaceDir}:/build`,
    '--workdir',
    '/build/crate',
    resolved.dockerImage,
    'cargo',
    'build',
    '--target',
    resolved.target,
    '--release',
  ];
}

function readVarUint32(buffer, offset) {
  let result = 0;
  let shift = 0;
  let pos = offset;

  while (pos < buffer.length) {
    const byte = buffer[pos++];
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return { value: result >>> 0, nextOffset: pos };
    }
    shift += 7;
    if (shift > 35) {
      throw new DeterministicCompileError(
        'INVALID_WASM',
        'Malformed LEB128 integer in WASM binary'
      );
    }
  }

  throw new DeterministicCompileError(
    'INVALID_WASM',
    'Unexpected end of WASM binary while reading LEB128 integer'
  );
}

/**
 * Parses WebAssembly custom sections (section ID 0) from a WASM binary.
 * Returns a map of section name -> Buffer payload.
 */
export function extractWasmCustomSections(wasm) {
  const buf = Buffer.isBuffer(wasm) ? wasm : Buffer.from(wasm);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(WASM_MAGIC_HEADER)) {
    throw new DeterministicCompileError(
      'INVALID_WASM',
      'WASM must use the standard WebAssembly binary header'
    );
  }

  const sections = {};
  let offset = 8;

  while (offset < buf.length) {
    const sectionId = buf[offset++];
    const { value: sectionSize, nextOffset: bodyStart } = readVarUint32(
      buf,
      offset
    );
    const bodyEnd = bodyStart + sectionSize;
    if (bodyEnd > buf.length) {
      throw new DeterministicCompileError(
        'INVALID_WASM',
        'WASM section length exceeds binary size'
      );
    }

    if (sectionId === 0) {
      const { value: nameLen, nextOffset: nameStart } = readVarUint32(
        buf,
        bodyStart
      );
      const nameEnd = nameStart + nameLen;
      if (nameEnd > bodyEnd) {
        throw new DeterministicCompileError(
          'INVALID_WASM',
          'WASM custom section name exceeds section bounds'
        );
      }
      const name = buf.subarray(nameStart, nameEnd).toString('utf8');
      const payload = Buffer.from(buf.subarray(nameEnd, bodyEnd));
      sections[name] = payload;
    }

    offset = bodyEnd;
  }

  return sections;
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Extracts Soroban embedded build metadata (`contractenvmetav0`, `contractmetav0`)
 * and contract specification (`contractspecv0` / soroban-spec) from a WASM binary.
 */
export function extractSorobanMetadataAndSpec(wasm) {
  const sections = extractWasmCustomSections(wasm);
  const envMeta = sections.contractenvmetav0 || null;
  const meta = sections.contractmetav0 || null;
  const spec = sections.contractspecv0 || null;

  return {
    sections: Object.keys(sections).sort(),
    hasEnvMeta: Boolean(envMeta),
    hasMeta: Boolean(meta),
    hasSpec: Boolean(spec),
    envMetaHash: envMeta ? sha256Hex(envMeta) : null,
    metaHash: meta ? sha256Hex(meta) : null,
    specHash: spec ? sha256Hex(spec) : null,
    envMetaBytes: envMeta ? envMeta.length : 0,
    metaBytes: meta ? meta.length : 0,
    specBytes: spec ? spec.length : 0,
  };
}

/**
 * Compares embedded Soroban build metadata and soroban-spec sections between
 * a locally compiled WASM and an on-chain WASM.
 */
export function verifySorobanSpecAndMetadata(localWasm, onChainWasm) {
  const local = extractSorobanMetadataAndSpec(localWasm);
  const onChain = extractSorobanMetadataAndSpec(onChainWasm);

  const specMatched = local.specHash === onChain.specHash;
  const envMetaMatched = local.envMetaHash === onChain.envMetaHash;
  const metaMatched = local.metaHash === onChain.metaHash;

  return {
    matched: specMatched && envMetaMatched && metaMatched,
    specMatched,
    envMetaMatched,
    metaMatched,
    local,
    onChain,
  };
}

function defaultDockerRunner(args, { timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`Deterministic compilation timed out after ${timeoutMs}ms`));
        return;
      }
      if (code !== 0) {
        reject(
          new Error(stderr || stdout || `docker run exited with code ${code}`)
        );
        return;
      }
      resolve({
        logs: `${stdout}\n${stderr}`.split(/\r?\n/).filter(Boolean),
      });
    });
  });
}

/**
 * Executes a deterministic contract build inside a pinned Docker container.
 */
export async function compileDeterministic({
  code,
  dependencies = {},
  buildEnv = {},
  timeoutMs = 60000,
  runner = defaultDockerRunner,
} = {}) {
  if (typeof code !== 'string' || code.trim().length === 0) {
    throw new DeterministicCompileError(
      'INVALID_SOURCE',
      'code is required and must not be empty'
    );
  }

  const resolvedEnv = resolveBuildEnvironment(buildEnv);
  const cargoToml = buildDeterministicCargoToml({
    sorobanSdkVersion: resolvedEnv.sorobanSdkVersion,
    dependencies,
    profile: resolvedEnv.profile,
  });

  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'soroban-deterministic-verify-')
  );
  const crateDir = path.join(tempDir, 'crate');
  const srcDir = path.join(crateDir, 'src');
  const cargoHome = path.join(tempDir, 'cargo-home');
  const targetDir = path.join(tempDir, 'target');
  const wasmOutPath = path.join(
    targetDir,
    resolvedEnv.target,
    'release',
    'soroban_contract.wasm'
  );

  try {
    await fs.mkdir(srcDir, { recursive: true });
    await fs.mkdir(cargoHome, { recursive: true });
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(crateDir, 'Cargo.toml'), cargoToml, 'utf8');
    await fs.writeFile(path.join(srcDir, 'lib.rs'), code, 'utf8');

    const dockerArgs = buildDeterministicDockerArgs({
      workspaceDir: tempDir,
      buildEnv: resolvedEnv,
    });

    const runResult = await runner(dockerArgs, {
      timeoutMs,
      workspaceDir: tempDir,
      wasmOutPath,
      buildEnv: resolvedEnv,
      cargoToml,
    });

    const wasmBytes =
      runResult?.wasmBytes || (await fs.readFile(wasmOutPath));
    const wasmHash = sha256Hex(wasmBytes);
    const sorobanSpec = extractSorobanMetadataAndSpec(wasmBytes);

    return {
      success: true,
      wasmBytes,
      wasmHash,
      buildEnv: resolvedEnv,
      sorobanSpec,
      logs: runResult?.logs || [],
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

export default {
  DEFAULT_RUSTC_VERSION,
  DEFAULT_SOROBAN_SDK_VERSION,
  DEFAULT_RELEASE_PROFILE,
  PINNED_BUILD_ENVIRONMENTS,
  WASM_TARGET,
  DeterministicCompileError,
  resolveBuildEnvironment,
  buildDeterministicCargoToml,
  buildDeterministicDockerArgs,
  extractWasmCustomSections,
  extractSorobanMetadataAndSpec,
  verifySorobanSpecAndMetadata,
  compileDeterministic,
};
