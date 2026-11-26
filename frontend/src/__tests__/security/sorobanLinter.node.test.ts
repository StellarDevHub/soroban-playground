/**
 * Node-runnable test suite for Soroban Static Analysis Security Linter & Quick Fixes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { scanContractSecurity } from '../../lib/security/sorobanLinter.ts';

const FLAWED_CONTRACT = `
use soroban_sdk::{contract, contractimpl, Address, Env};

#[contract]
pub struct TokenVault;

#[contractimpl]
impl TokenVault {
    pub fn transfer_funds(env: Env, sender: Address, amount: i128) {
        let balance: i128 = env.storage().persistent().get(&sender).unwrap_or(0);
        env.storage().persistent().set(&sender, &(balance - amount));
        let truncated = balance as u64;
    }
}
`;

const SECURE_CONTRACT = `
use soroban_sdk::{contract, contractimpl, Address, Env};

#[contract]
pub struct TokenVault;

#[contractimpl]
impl TokenVault {
    pub fn transfer_funds(env: Env, sender: Address, amount: i128) {
        sender.require_auth();
        let balance: i128 = env.storage().persistent().get(&sender).unwrap_or(0);
        env.storage().persistent().set(&sender, &(balance.checked_sub(amount).unwrap()));
        env.storage().persistent().extend_ttl(&sender, 100, 1000);
    }
}
`;

test('Soroban Security Linter Vulnerability Detection', async (t) => {
  await t.test('detects unverified address authorization flaw', () => {
    const report = scanContractSecurity(FLAWED_CONTRACT);
    const authFinding = report.findings.find(
      (f) => f.ruleId === 'soroban/unverified-address-auth'
    );
    assert.ok(authFinding, 'Should detect missing require_auth()');
    assert.equal(authFinding.severity, 'critical');
    assert.ok(authFinding.title.includes('Missing Authorization'));
  });

  await t.test('detects missing TTL renewal on persistent storage writes', () => {
    const report = scanContractSecurity(FLAWED_CONTRACT);
    const ttlFinding = report.findings.find(
      (f) => f.ruleId === 'soroban/missing-ttl-renewal'
    );
    assert.ok(ttlFinding, 'Should detect missing TTL renewal');
    assert.equal(ttlFinding.severity, 'medium');
  });

  await t.test('detects unchecked arithmetic subtraction and integer truncation', () => {
    const report = scanContractSecurity(FLAWED_CONTRACT);
    const arithmeticFinding = report.findings.find(
      (f) => f.ruleId === 'soroban/unconstrained-arithmetic'
    );
    assert.ok(arithmeticFinding, 'Should detect unconstrained arithmetic');

    const truncationFinding = report.findings.find(
      (f) => f.ruleId === 'soroban/integer-truncation'
    );
    assert.ok(truncationFinding, 'Should detect integer truncation via as cast');
  });

  await t.test('awards 100 score and A+ grade to properly secured contract', () => {
    const report = scanContractSecurity(SECURE_CONTRACT);
    assert.equal(report.score, 100);
    assert.equal(report.grade, 'A+');
    assert.equal(report.findings.length, 0);
    assert.equal(report.passed, true);
  });

  await t.test('applies Quick Fix transformations accurately', () => {
    const report = scanContractSecurity(FLAWED_CONTRACT);
    const authFinding = report.findings.find(
      (f) => f.ruleId === 'soroban/unverified-address-auth'
    );
    assert.ok(authFinding?.quickFix);

    const patched = authFinding.quickFix.apply(FLAWED_CONTRACT);
    assert.ok(patched.includes('sender.require_auth();'));

    // Re-scanning patched code should no longer flag missing auth
    const updatedReport = scanContractSecurity(patched);
    const updatedAuthFinding = updatedReport.findings.find(
      (f) => f.ruleId === 'soroban/unverified-address-auth'
    );
    assert.equal(updatedAuthFinding, undefined);
  });
});
