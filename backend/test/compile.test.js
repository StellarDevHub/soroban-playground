import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidCrateName,
  isValidVersionConstraint,
  sanitizeDependenciesInput,
  buildCargoToml,
} from '../src/routes/compile_utils.js';

describe('compile route dependency utilities', () => {
  test('crate name validation accepts lowercase with dashes/underscores', () => {
    assert.equal(isValidCrateName('serde'), true);
    assert.equal(isValidCrateName('serde_json'), true);
    assert.equal(isValidCrateName('my-crate_2'), true);
  });

  test('crate name validation rejects invalid patterns', () => {
    assert.equal(isValidCrateName(''), false);
    assert.equal(isValidCrateName('UpperCase'), false);
    assert.equal(isValidCrateName('-badstart'), false);
    assert.equal(isValidCrateName('bad space'), false);
    assert.equal(isValidCrateName('bad"quote'), false);
    assert.equal(isValidCrateName('[section]'), false);
    assert.equal(isValidCrateName('a'.repeat(65)), false);
  });

  test('version validation accepts common semver constraints', () => {
    const ok = [
      '1',
      '1.2',
      '1.2.3',
      '^1.2',
      '~1.2',
      '>=1.0, <2.0',
      '0.0.0',
      '1.2.3-alpha',
      '1.2.3+meta',
      '1.x',
      '1.2.x',
      '*',
    ];
    for (const v of ok) {
      assert.equal(isValidVersionConstraint(v), true, `expected valid: ${v}`);
    }
  });

  test('version validation rejects dangerous or malformed input', () => {
    const bad = ['"1.2.3"', '1.2.3\n', '[1.2]', ''];
    for (const v of bad) {
      assert.equal(
        isValidVersionConstraint(v),
        false,
        `expected invalid: ${v}`
      );
    }
  });

  test('sanitizeDependenciesInput allows empty/undefined', () => {
    assert.deepEqual(sanitizeDependenciesInput(undefined), {
      ok: true,
      deps: {},
    });
    assert.deepEqual(sanitizeDependenciesInput(null), { ok: true, deps: {} });
    assert.deepEqual(sanitizeDependenciesInput({}), { ok: true, deps: {} });
  });

  test('sanitizeDependenciesInput rejects malformed dependency payload types', () => {
    assert.equal(sanitizeDependenciesInput([]).ok, false);
    assert.equal(sanitizeDependenciesInput('serde=1.0').ok, false);
    assert.equal(sanitizeDependenciesInput(2).ok, false);
  });

  test('sanitizeDependenciesInput validates structure and filters out soroban-sdk override', () => {
    const input = { serde: '1.0', 'soroban-sdk': '999.0.0' };
    const out = sanitizeDependenciesInput(input);
    assert.equal(out.ok, true);
    assert.deepEqual(out.deps, { serde: '1.0' });
  });

  test('sanitizeDependenciesInput rejects invalid crate names and versions', () => {
    const input = { BadName: '1.0', 'ok-name': 'bad\nversion' };
    const out = sanitizeDependenciesInput(input);
    assert.equal(out.ok, false);
    assert.ok(Array.isArray(out.details));
    assert.ok(out.details.length >= 1);
  });

  test('sanitizeDependenciesInput enforces max deps', () => {
    const big = {};
    for (let i = 0; i < 25; i++) big[`c${i}`] = '1.0.0';
    const out = sanitizeDependenciesInput(big);
    assert.equal(out.ok, false);
  });

  test('sanitizeDependenciesInput blocks TOML injection patterns', () => {
    const out = sanitizeDependenciesInput({
      serde: '1.0"\n[profile.dev]\nopt-level = 3',
    });
    assert.equal(out.ok, false);
  });

  test('buildCargoToml includes base soroban-sdk and merges extras deterministically', () => {
    const toml = buildCargoToml({ serde: '1.0', serde_json: '1.0' });
    assert.ok(toml.includes('[dependencies]'));
    assert.ok(toml.includes('soroban-sdk = "20.0.0"'));
    assert.ok(toml.includes('serde = "1.0"'));
    assert.ok(toml.includes('serde_json = "1.0"'));
    const depsSection = toml
      .split('[dependencies]')[1]
      .split('[profile.release]')[0]
      .trim();
    const lines = depsSection.split('\n').filter(Boolean);
    const sorted = [...lines].sort();
    assert.deepEqual(lines, sorted);
  });
});
