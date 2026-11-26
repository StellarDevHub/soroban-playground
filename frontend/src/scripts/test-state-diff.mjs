// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Verification script for Transaction Ledger State Differential Parser
 * Tests extraction of created, modified, and deleted storage entries.
 */

import { parseTransactionMeta } from '../lib/stellar/transactionMetaParser.ts';

const mockTransactionMeta = {
  txHash: "0x89abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567",
  ledgerSequence: 104523,
  successful: true,
  timestamp: Date.now(),
  changes: [
    {
      key: "ContractData:Vault:balance:GABF...9NL6",
      keyType: "ContractData",
      contractId: "CA_VAULT_123",
      changeType: "modified",
      before: { balance: 1000, authorized: true },
      after: { balance: 750, authorized: true },
      durability: "persistent",
    },
    {
      key: "ContractData:Vault:allowance:SPONSOR_1",
      keyType: "ContractData",
      contractId: "CA_VAULT_123",
      changeType: "created",
      before: null,
      after: { spender: "SPONSOR_1", amount: 500 },
      durability: "temporary",
    },
    {
      key: "ContractData:Vault:expired_nonce:42",
      keyType: "ContractData",
      contractId: "CA_VAULT_123",
      changeType: "deleted",
      before: { nonce: 42, usedAt: 104500 },
      after: null,
      durability: "persistent",
    },
  ],
};

console.log("=== Testing Transaction State Differential Parser ===");

const result = parseTransactionMeta(mockTransactionMeta);

console.log(`Parsed Transaction: ${result.txHash.slice(0, 16)}...`);
console.log(`Total Ledger Mutations: ${result.changes.length}`);

let created = 0;
let modified = 0;
let deleted = 0;

for (const c of result.changes) {
  if (c.changeType === "created") created++;
  if (c.changeType === "modified") modified++;
  if (c.changeType === "deleted") deleted++;
  console.log(` -> [${c.changeType.toUpperCase()}] ${c.key} (${c.durability})`);
}

if (created === 1 && modified === 1 && deleted === 1) {
  console.log("✓ State diff verification passed successfully: 1 created, 1 modified, 1 deleted.");
  process.exit(0);
} else {
  console.error("✗ State diff verification failed counts mismatch.");
  process.exit(1);
}
