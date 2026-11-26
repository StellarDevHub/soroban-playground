// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import crypto from 'node:crypto';
import { jest } from '@jest/globals';
import { StrKey } from '@stellar/stellar-sdk';
import {
  DEFAULT_RUSTC_VERSION,
  DEFAULT_SOROBAN_SDK_VERSION,
  resolveBuildEnvironment,
  buildDeterministicCargoToml,
  buildDeterministicDockerArgs,
  extractWasmCustomSections,
  extractSorobanMetadataAndSpec,
  verifySorobanSpecAndMetadata,
  compileDeterministic,
} from '../src/services/compiler/compilerService.js';
import { VerifyService } from '../src/services/verifyService.js';

const WASM_HEADER = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 7));
const SAMPLE_SOURCE = `#![no_std]
use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct HelloContract;

#[contractimpl]
impl HelloContract {
    pub fn ping(_env: Env) -> u32 {
        42
    }
}
`;

function encodeVarUint32(value) {
  const bytes = [];
  let v = value >>> 0;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (v !== 0);
  return Buffer.from(bytes);
}

function buildCustomSection(name, payload) {
  const nameBuf = Buffer.from(name, 'utf8');
  const payloadBuf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const body = Buffer.concat([
    encodeVarUint32(nameBuf.length),
    nameBuf,
    payloadBuf,
  ]);
  return Buffer.concat([Buffer.from([0x00]), encodeVarUint32(body.length), body]);
}

function buildSorobanWasm({
  envMeta = Buffer.from('envmeta-v21.7.7'),
  meta = Buffer.from('rsver=1.80.0;rssdkver=21.7.7'),
  spec = Buffer.from('soroban-spec:ping()->u32'),
} = {}) {
  return Buffer.concat([
    WASM_HEADER,
    buildCustomSection('contractenvmetav0', envMeta),
    buildCustomSection('contractmetav0', meta),
    buildCustomSection('contractspecv0', spec),
  ]);
}

function makeInMemoryDb() {
  const rows = new Map();
  const executedQueries = [];
  return {
    rows,
    executedQueries,
    async connect() {},
    async run(sql, params = []) {
      executedQueries.push({ sql, params });
      if (sql.includes('INSERT INTO contract_verification')) {
        // Assert exact placeholder count matches params
        const placeholderCount = (sql.match(/\?/g) || []).length;
        if (placeholderCount !== params.length) {
          throw new Error(
            `Placeholder mismatch: expected ${params.length}, got ${placeholderCount}`
          );
        }
        rows.set(params[0], {
          id: params[0],
          contract_id: params[1],
          network: params[2],
          source_code: params[3],
          source_hash: params[4],
          dependencies: params[5],
          metadata: params[6],
          status: params[7],
          created_at: params[8],
          updated_at: params[9],
          wasm_hash: null,
          on_chain_wasm_hash: null,
          error_code: null,
          error_message: null,
          verified_at: null,
        });
      } else if (sql.includes('UPDATE contract_verification')) {
        const id = params[params.length - 1];
        const row = rows.get(id);
        if (row) {
          Object.assign(row, {
            wasm_hash: params[0],
            on_chain_wasm_hash: params[1],
            status: params[2],
            error_code: params[3],
            error_message: params[4],
            updated_at: params[5],
            verified_at: params[6],
          });
        }
      }
    },
    async get(sql, params = []) {
      executedQueries.push({ sql, params });
      if (sql.includes('WHERE id = ?')) {
        return rows.get(params[0]) || null;
      }
      return null;
    },
    async all(sql, params = []) {
      executedQueries.push({ sql, params });
      return [...rows.values()];
    },
  };
}

describe('Deterministic Compiler Pipeline (BACKEND-226)', () => {
  it('pins exact rustc version, soroban-sdk patch version, and opt-level = "z"', () => {
    const env = resolveBuildEnvironment();
    expect(env.rustcVersion).toBe(DEFAULT_RUSTC_VERSION);
    expect(env.sorobanSdkVersion).toBe(DEFAULT_SOROBAN_SDK_VERSION);
    expect(env.dockerImage).toContain('@sha256:');
    expect(env.dockerImage).not.toContain(':latest');
    expect(env.profile.optLevel).toBe('z');
    expect(env.profile.codegenUnits).toBe(1);
    expect(env.profile.lto).toBe(true);
    expect(env.env.SOURCE_DATE_EPOCH).toBe('0');
    expect(env.env.CARGO_INCREMENTAL).toBe('0');
    expect(env.env.RUSTFLAGS).toContain('--remap-path-prefix=/build=/src');
  });

  it('rejects unpinned or unsupported rustc and SDK versions', () => {
    expect(() =>
      resolveBuildEnvironment({ rustcVersion: 'nightly' })
    ).toThrow(/Unsupported rustcVersion/);
    expect(() =>
      resolveBuildEnvironment({ sorobanSdkVersion: '^21.7' })
    ).toThrow(/exact semver patch version/);
    expect(() => resolveBuildEnvironment({ optLevel: 'fast' })).toThrow(
      /Unsupported optLevel/
    );
  });

  it('generates deterministic Cargo.toml with exact SDK pin and release profile', () => {
    const toml = buildDeterministicCargoToml({
      sorobanSdkVersion: '21.7.7',
      dependencies: { 'stellar-strkey': '=0.0.8' },
    });

    expect(toml).toContain('soroban-sdk = "=21.7.7"');
    expect(toml).toContain('stellar-strkey = "=0.0.8"');
    expect(toml).toContain('opt-level = "z"');
    expect(toml).toContain('codegen-units = 1');
    expect(toml).toContain('lto = true');
    expect(toml).toContain('strip = "symbols"');
    expect(toml).toContain('panic = "abort"');
  });

  it('builds pinned Docker run arguments with network isolation and deterministic env', () => {
    const env = resolveBuildEnvironment({ rustcVersion: '1.80.0' });
    const args = buildDeterministicDockerArgs({
      workspaceDir: '/tmp/verify-build',
      buildEnv: env,
    });

    const joined = args.join(' ');
    expect(joined).toContain('--network none');
    expect(joined).toContain('--read-only');
    expect(joined).toContain('--env SOURCE_DATE_EPOCH=0');
    expect(joined).toContain('--env CARGO_INCREMENTAL=0');
    expect(joined).toContain('--env RUSTFLAGS=--remap-path-prefix=/build=/src');
    expect(joined).toContain(env.dockerImage);
    expect(joined).toContain(
      'cargo build --target wasm32-unknown-unknown --release'
    );
  });

  it('extracts and verifies embedded Soroban build metadata and soroban-spec', () => {
    const wasmA = buildSorobanWasm();
    const wasmB = buildSorobanWasm();
    const wasmDifferentSpec = buildSorobanWasm({
      spec: Buffer.from('soroban-spec:pong()->u64'),
    });

    const sections = extractWasmCustomSections(wasmA);
    expect(Object.keys(sections)).toEqual(
      expect.arrayContaining([
        'contractenvmetav0',
        'contractmetav0',
        'contractspecv0',
      ])
    );

    const extracted = extractSorobanMetadataAndSpec(wasmA);
    expect(extracted.hasEnvMeta).toBe(true);
    expect(extracted.hasMeta).toBe(true);
    expect(extracted.hasSpec).toBe(true);
    expect(extracted.specHash).toMatch(/^[a-f0-9]{64}$/);

    const matched = verifySorobanSpecAndMetadata(wasmA, wasmB);
    expect(matched.matched).toBe(true);
    expect(matched.specMatched).toBe(true);
    expect(matched.metaMatched).toBe(true);

    const mismatched = verifySorobanSpecAndMetadata(wasmA, wasmDifferentSpec);
    expect(mismatched.matched).toBe(false);
    expect(mismatched.specMatched).toBe(false);
  });

  it('produces identical bytecode hashes across multiple deterministic compile runs', async () => {
    const deterministicRunner = jest.fn(async (_args, { cargoToml }) => {
      // Simulate a deterministic compiler whose output depends strictly on
      // the pinned Cargo.toml + source inputs (no timestamps or random paths).
      const digest = crypto
        .createHash('sha256')
        .update(cargoToml)
        .update(SAMPLE_SOURCE)
        .digest();
      const wasmBytes = buildSorobanWasm({
        envMeta: digest.subarray(0, 16),
        meta: Buffer.from('rsver=1.80.0;rssdkver=21.7.7'),
        spec: digest.subarray(16, 32),
      });
      return { wasmBytes, logs: ['deterministic build ok'] };
    });

    const run1 = await compileDeterministic({
      code: SAMPLE_SOURCE,
      buildEnv: { rustcVersion: '1.80.0', sorobanSdkVersion: '21.7.7' },
      runner: deterministicRunner,
    });
    const run2 = await compileDeterministic({
      code: SAMPLE_SOURCE,
      buildEnv: { rustcVersion: '1.80.0', sorobanSdkVersion: '21.7.7' },
      runner: deterministicRunner,
    });
    const run3 = await compileDeterministic({
      code: SAMPLE_SOURCE,
      buildEnv: { rustcVersion: '1.80.0', sorobanSdkVersion: '21.7.7' },
      runner: deterministicRunner,
    });

    expect(run1.wasmHash).toBe(run2.wasmHash);
    expect(run2.wasmHash).toBe(run3.wasmHash);
    expect(run1.sorobanSpec.specHash).toBe(run2.sorobanSpec.specHash);
    expect(run2.sorobanSpec.specHash).toBe(run3.sorobanSpec.specHash);
  });

  it('verifies contract end-to-end using deterministic pipeline and parameterized SQL', async () => {
    const expectedWasm = buildSorobanWasm();
    const db = makeInMemoryDb();
    const compileDet = jest.fn().mockResolvedValue({
      success: true,
      wasmBytes: expectedWasm,
      wasmHash: crypto.createHash('sha256').update(expectedWasm).digest('hex'),
      logs: ['compiled deterministically'],
    });

    const service = new VerifyService({
      db,
      compileDeterministic: compileDet,
      useDeterministicCompiler: true,
      fetchOnChainWasm: jest.fn().mockResolvedValue(expectedWasm),
      now: () => '2026-11-24T00:00:00.000Z',
    });

    const result1 = await service.verifyContract({
      contractId: CONTRACT_ID,
      sourceCode: SAMPLE_SOURCE,
      buildEnv: { rustcVersion: '1.80.0', sorobanSdkVersion: '21.7.7' },
    });
    const result2 = await service.verifyContract({
      contractId: CONTRACT_ID,
      sourceCode: SAMPLE_SOURCE,
      buildEnv: { rustcVersion: '1.80.0', sorobanSdkVersion: '21.7.7' },
    });

    expect(result1.status).toBe('verified');
    expect(result1.verified).toBe(true);
    expect(result1.wasmHash).toBe(result2.wasmHash);
    expect(result1.specVerification.matched).toBe(true);
    expect(result1.metadata.buildEnv.rustcVersion).toBe('1.80.0');
    expect(result1.metadata.buildEnv.optLevel).toBe('z');

    // Verify CREATE TABLE SQL has valid DEFAULT '{}' and no malformed placeholders
    const createQuery = db.executedQueries.find((q) =>
      q.sql.includes('CREATE TABLE')
    );
    expect(createQuery.sql).toContain("DEFAULT '{}'");

    // Rejects SQL-injection-like network or status filters
    await expect(
      service.listVerifications({ network: "testnet' OR '1'='1" })
    ).rejects.toMatchObject({ code: 'INVALID_NETWORK', statusCode: 400 });

    await expect(
      service.listVerifications({ status: 'verified; DROP TABLE users;' })
    ).rejects.toMatchObject({ code: 'INVALID_STATUS', statusCode: 400 });
  });
});
