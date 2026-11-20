/**
 * Node-runnable test suite for Transaction Meta Ledger State Differential Parser.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTransactionMeta } from '../../lib/stellar/transactionMetaParser.ts';

test('Transaction Meta State Differential Parsing', async (t) => {
  const metaPayload = {
    txHash: "0x1234567890abcdef",
    ledgerSequence: 104523,
    successful: true,
    timestamp: 1700000000000,
    changes: [
      {
        key: "ContractData:Vault:balance:ALICE",
        keyType: "ContractData",
        contractId: "CA_VAULT",
        changeType: "modified",
        before: { balance: 100 },
        after: { balance: 350 },
        durability: "persistent",
      },
      {
        key: "ContractData:Vault:allowance:BOB",
        keyType: "ContractData",
        contractId: "CA_VAULT",
        changeType: "created",
        before: null,
        after: { spender: "BOB", amount: 50 },
        durability: "temporary",
      },
      {
        key: "ContractData:Vault:old_session:SESSION_1",
        keyType: "ContractData",
        contractId: "CA_VAULT",
        changeType: "deleted",
        before: { active: true },
        after: null,
        durability: "temporary",
      },
    ],
  };

  await t.test('parses created, modified, and deleted ledger entries with accurate before/after values', () => {
    const parsed = parseTransactionMeta(metaPayload);

    assert.equal(parsed.txHash, "0x1234567890abcdef");
    assert.equal(parsed.successful, true);
    assert.equal(parsed.changes.length, 3);

    const [modified, created, deleted] = parsed.changes;

    assert.equal(modified.changeType, "modified");
    assert.deepEqual(modified.before, { balance: 100 });
    assert.deepEqual(modified.after, { balance: 350 });

    assert.equal(created.changeType, "created");
    assert.equal(created.before, null);
    assert.deepEqual(created.after, { spender: "BOB", amount: 50 });

    assert.equal(deleted.changeType, "deleted");
    assert.deepEqual(deleted.before, { active: true });
    assert.equal(deleted.after, null);
  });

  await t.test('handles empty or null meta safely', () => {
    const emptyParsed = parseTransactionMeta(null);
    assert.equal(emptyParsed.changes.length, 0);
    assert.equal(emptyParsed.successful, true);
  });
});
