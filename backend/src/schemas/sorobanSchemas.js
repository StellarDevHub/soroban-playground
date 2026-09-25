// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// Zod schemas for the core compile / deploy / invoke API (issue #1573).
//
// z.object() strips unknown keys by default, so anything a client sends that
// is not listed here never reaches a handler — this is the mass-assignment
// defence. Nested free-form maps (invoke args, compile dependencies) are
// checked for dangerous keys by rejectPrototypePollution() in validation.js.

import { z } from 'zod';

const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
// Stellar StrKey contract IDs: 'C' + 55 base32 characters.
const CONTRACT_ID_RE = /^C[A-Z2-7]{55}$/;
const NETWORK_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/;
// Identity alias (stellar keys) or a G/S StrKey — never a CLI flag.
const SOURCE_ACCOUNT_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,63}$/;
const MAX_BATCH_SIZE = 20;

function requiredString(field, message) {
  return z.string({
    required_error: `${field} is required`,
    invalid_type_error: message || `${field} must be a string`,
  });
}

const optional = (schema) => schema.nullish().transform((v) => v ?? undefined);

export const contractId = (field = 'contractId') =>
  requiredString(field, `${field} must be a valid Stellar contract ID`).regex(
    CONTRACT_ID_RE,
    `${field} must be a valid Stellar contract ID`
  );

export const functionName = (field = 'functionName') =>
  requiredString(field, `${field} must be a valid identifier`)
    .max(64, `${field} must be at most 64 characters`)
    .regex(IDENTIFIER_RE, `${field} must be a valid identifier`);

export const network = (field = 'network') =>
  z
    .string({ invalid_type_error: `${field} must be a string` })
    .regex(NETWORK_RE, `${field} must be a valid network name`);

export const sourceAccount = (field = 'sourceAccount') =>
  z
    .string({ invalid_type_error: `${field} must be a string` })
    .regex(
      SOURCE_ACCOUNT_RE,
      `${field} must be an identity name or public key`
    );

export const invokeArgs = z
  .record(
    z.string().regex(IDENTIFIER_RE, 'args keys must be valid identifiers'),
    z.unknown(),
    { invalid_type_error: 'args must be an object' }
  )
  .refine((value) => Object.keys(value).length <= 64, {
    message: 'args may contain at most 64 entries',
  });

const wasmPath = (field) =>
  requiredString(field)
    .min(1, `${field} is required`)
    .max(1024, `${field} must be at most 1024 characters`)
    .refine((value) => !value.includes('\0'), {
      message: `${field} must not contain NUL bytes`,
    });

const contractName = (field) =>
  requiredString(field)
    .min(1, `${field} is required`)
    .max(128, `${field} must be at most 128 characters`);

// ── Invoke ──────────────────────────────────────────────────────────────────

export const invokeBodyV1 = z.object({
  contractId: contractId('contractId'),
  functionName: functionName('functionName'),
  args: optional(invokeArgs),
  network: optional(network('network')),
  sourceAccount: optional(sourceAccount('sourceAccount')),
});

export const invokeBodyV2 = z.object({
  contract_id: contractId('contract_id'),
  function_name: functionName('function_name'),
  args: optional(invokeArgs),
  network: optional(network('network')),
  source_account: optional(sourceAccount('source_account')),
});

// ── Deploy ──────────────────────────────────────────────────────────────────

export const deployBodyV1 = z.object({
  wasmPath: wasmPath('wasmPath'),
  contractName: contractName('contractName'),
  network: optional(network('network')),
  sourceAccount: optional(sourceAccount('sourceAccount')),
});

export const deployBodyV2 = z.object({
  wasm_path: wasmPath('wasm_path'),
  contract_name: contractName('contract_name'),
  network: optional(network('network')),
});

const batchIdSchema = optional(
  z
    .string({ invalid_type_error: 'batchId must be a string' })
    .regex(/^[a-zA-Z0-9_-]{1,64}$/, 'batchId must be a valid identifier')
);

const nonEmptyBatch = (item) =>
  z
    .array(item, {
      required_error: 'contracts must be a non-empty array',
      invalid_type_error: 'contracts must be a non-empty array',
    })
    .min(1, 'contracts must be a non-empty array')
    .max(
      MAX_BATCH_SIZE,
      `contracts may contain at most ${MAX_BATCH_SIZE} items`
    );

export const deployBatchBodyV1 = z.object({
  batchId: batchIdSchema,
  contracts: nonEmptyBatch(
    z.object({
      id: optional(z.string().max(128)),
      contractName: optional(z.string().max(128)),
      wasmPath: optional(z.string().max(1024)),
      network: optional(network('network')),
      sourceAccount: optional(sourceAccount('sourceAccount')),
    })
  ),
});

export const deployBatchBodyV2 = z.object({
  batch_id: batchIdSchema,
  contracts: nonEmptyBatch(
    z.object({
      contract_name: optional(z.string().max(128)),
      wasm_path: optional(z.string().max(1024)),
    })
  ),
});

// ── Compile ─────────────────────────────────────────────────────────────────
// Source size and dependency contents are enforced by the handlers
// (config.compile.maxSourceBytes / sanitizeDependenciesInput); the schemas
// pin the accepted shape and drop everything else.

const sourceField = optional(
  z.string({ invalid_type_error: 'code must be a string' })
);
const dependenciesField = optional(
  z.record(z.string(), z.unknown(), {
    invalid_type_error: 'dependencies must be an object',
  })
);

export const compileBody = z.object({
  code: sourceField,
  source: sourceField,
  sourceCode: sourceField,
  contractName: optional(z.string().max(128)),
  dependencies: dependenciesField,
});

export const compileBatchBody = z.object({
  contracts: z
    .array(
      z.object({
        code: sourceField,
        dependencies: dependenciesField,
      }),
      {
        required_error: 'contracts must be a non-empty array',
        invalid_type_error: 'contracts must be a non-empty array',
      }
    )
    .min(1, 'contracts must be a non-empty array'),
});

export const jobIdParams = z.object({
  jobId: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,128}$/, 'jobId must be a valid job identifier'),
});
