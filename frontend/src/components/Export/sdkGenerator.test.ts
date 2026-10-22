import { describe, it, expect } from 'vitest';
import {
  generateSdkBundle,
  sorbanTypeToTs,
  buildZipFromBundle,
} from './sdkGenerator';
import type { ContractSpec } from './types';

const basicSpec: ContractSpec = {
  name: 'token-contract',
  version: '0.1.0',
  description: 'A test token contract',
  functions: [
    {
      name: 'transfer',
      doc: 'Transfer tokens between accounts',
      inputs: [
        { name: 'from', type: { kind: 'address' } },
        { name: 'to', type: { kind: 'address' } },
        { name: 'amount', type: { kind: 'i128' } },
      ],
      outputs: [],
      read_only: false,
    },
    {
      name: 'balance',
      doc: 'Return the balance of an account',
      inputs: [{ name: 'id', type: { kind: 'address' } }],
      outputs: [{ kind: 'i128' }],
      read_only: true,
    },
  ],
  structs: [
    {
      name: 'BalanceInfo',
      doc: 'Balance information',
      fields: [
        { name: 'amount', type: { kind: 'i128' } },
        { name: 'owner', type: { kind: 'address' } },
      ],
    },
  ],
  enums: [
    {
      name: 'Status',
      cases: [
        { name: 'Active', value: 0 },
        { name: 'Inactive', value: 1 },
      ],
    },
  ],
  errors: [
    { name: 'InsufficientBalance', code: 1, doc: 'Insufficient balance' },
    { name: 'Unauthorized', code: 2, doc: 'Unauthorized caller' },
  ],
  events: [
    {
      name: 'Transfer',
      fields: [
        { name: 'from', type: { kind: 'address' } },
        { name: 'to', type: { kind: 'address' } },
        { name: 'amount', type: { kind: 'i128' } },
      ],
    },
  ],
};

describe('sorbanTypeToTs', () => {
  it('maps scalar types', () => {
    expect(sorbanTypeToTs({ kind: 'bool' })).toBe('boolean');
    expect(sorbanTypeToTs({ kind: 'u32' })).toBe('bigint');
    expect(sorbanTypeToTs({ kind: 'string' })).toBe('string');
    expect(sorbanTypeToTs({ kind: 'address' })).toBe('string');
    expect(sorbanTypeToTs({ kind: 'bytes' })).toBe('Uint8Array');
  });

  it('maps vec types', () => {
    expect(sorbanTypeToTs({ kind: 'vec', elements: [{ kind: 'u32' }] })).toBe('bigint[]');
  });

  it('maps option types', () => {
    expect(sorbanTypeToTs({ kind: 'option', child: { kind: 'string' } })).toBe('string | null');
  });

  it('resolves def references when known', () => {
    const defs = new Set<string>(['BalanceInfo']);
    expect(sorbanTypeToTs({ kind: 'def', defName: 'BalanceInfo' }, defs)).toBe('BalanceInfo');
  });
});

describe('generateSdkBundle', () => {
  it('generates all required files', () => {
    const bundle = generateSdkBundle(basicSpec);
    const names = bundle.files.map((f) => f.name);
    expect(names).toContain('src/types.ts');
    expect(names).toContain('src/client.ts');
    expect(names).toContain('src/index.ts');
    expect(names).toContain('src/errors.ts');
    expect(names).toContain('package.json');
    expect(names).toContain('README.md');
  });

  it('generates type definitions for structs and enums', () => {
    const bundle = generateSdkBundle(basicSpec);
    const types = bundle.files.find((f) => f.name === 'src/types.ts')!.content;
    expect(types).toContain('export interface BalanceInfo');
    expect(types).toContain('export enum Status');
    expect(types).toContain("Active = 0");
    expect(types).toContain('export interface TransferEvent');
  });

  it('generates typed client methods', () => {
    const bundle = generateSdkBundle(basicSpec);
    const client = bundle.files.find((f) => f.name === 'src/client.ts')!.content;
    expect(client).toContain('export class TokenContractClient');
    expect(client).toContain('async transfer(');
    expect(client).toContain('async balance(');
    expect(client).toContain('Test SDF Network ; September 2015');
  });

  it('generates error decoder', () => {
    const bundle = generateSdkBundle(basicSpec);
    const errors = bundle.files.find((f) => f.name === 'src/errors.ts')!.content;
    expect(errors).toContain('decodeContractError');
    expect(errors).toContain("Insufficient balance");
  });

  it('generates package.json with stellar dependencies', () => {
    const bundle = generateSdkBundle(basicSpec);
    const pkg = JSON.parse(bundle.files.find((f) => f.name === 'package.json')!.content);
    expect(pkg.dependencies).toHaveProperty('@stellar/stellar-sdk');
    expect(pkg.dependencies).toHaveProperty('@ktorban/client');
  });

  it('generates README with install snippets', () => {
    const bundle = generateSdkBundle(basicSpec);
    const readme = bundle.files.find((f) => f.name === 'README.md')!.content;
    expect(readme).toContain('npm install');
    expect(readme).toContain('Test SDF Network');
  });

  it('throws on missing spec name', () => {
    expect(() => generateSdkBundle({ ...basicSpec, name: '' })).toThrow();
  });
});

describe('buildZipFromBundle', () => {
  it('produces a zip blob', () => {
    const bundle = generateSdkBundle(basicSpec);
    const blob = buildZipFromBundle(bundle);
    expect(blob).toBeDefined();
    expect(blob.type).toBe('application/zip');
    expect(blob.size).toBeGreaterThan(0);
  });
});
