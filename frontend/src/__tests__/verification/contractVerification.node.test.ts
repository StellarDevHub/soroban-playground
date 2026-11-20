/**
 * Node-runnable test suite for Contract Verification Attestation & Reproducible Build Hashes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchContractVerification,
  reverifyContract,
} from '../../services/contractVerificationService.ts';

test('Contract Verification Service Attestation Logic', async (t) => {
  await t.test('returns unverified for empty or invalid contract ID', async () => {
    const result = await fetchContractVerification('');
    assert.equal(result.status, 'unverified');
    assert.equal(result.verified, false);
    assert.ok(result.errorMessage);
  });

  await t.test('detects cryptographic match when compiled WASM equals on-chain WASM', async () => {
    const result = await fetchContractVerification('CA_VALID_TEST_CONTRACT_123');
    assert.equal(result.status, 'verified');
    assert.equal(result.verified, true);
    assert.ok(result.buildDetails);
    assert.equal(
      result.buildDetails?.compiledWasmHash,
      result.buildDetails?.onChainWasmHash
    );
    assert.ok(result.buildDetails?.compilerVersion);
    assert.ok(result.buildDetails?.optimizationLevel);
    assert.ok(result.buildDetails?.commitSha);
  });

  await t.test('identifies bytecode mismatch when on-chain hash differs from compiled hash', async () => {
    const result = await fetchContractVerification('CM_MISMATCH_CONTRACT_9999');
    assert.equal(result.status, 'mismatch');
    assert.equal(result.verified, false);
    assert.ok(result.buildDetails);
    assert.notEqual(
      result.buildDetails?.compiledWasmHash,
      result.buildDetails?.onChainWasmHash
    );
  });

  await t.test('handles unverified contracts with no attestation records', async () => {
    const result = await fetchContractVerification('CU_UNVERIFIED_CONTRACT_555');
    assert.equal(result.status, 'unverified');
    assert.equal(result.verified, false);
    assert.equal(result.buildDetails, undefined);
  });
});
