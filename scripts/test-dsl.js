// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { QueryBuilder } from './backend/src/services/queryBuilder.js';
import { generateCacheKey } from './backend/src/services/cacheService.js';

const qb = new QueryBuilder();

const sampleQuery = {
  filter: {
    contractId: { $eq: "C123..." },
    $or: [
      { amount: { $gte: 1000 } },
      { type: { $in: ["swap", "liquidity"] } }
    ]
  },
  sort: [{ field: "ledger", direction: "DESC" }],
  limit: 10,
  cursor: "last-seen-id-999"
};

// 1. Test SQL Generation
console.log("--- SQL Output ---");
const result = qb.buildFullQuery(sampleQuery);
console.log("SQL:", result.sql);
console.log("Params:", result.params);

// 2. Test Deterministic Hashing (Key Order Independence)
console.log("\n--- Cache Key Determinism ---");
const queryA = { a: 1, b: { z: 10, y: 20 } };
const queryB = { b: { y: 20, z: 10 }, a: 1 };

const keyA = generateCacheKey(queryA);
const keyB = generateCacheKey(queryB);

console.log(`Key A: ${keyA}`);
console.log(`Key B: ${keyB}`);
console.log(`Match: ${keyA === keyB ? "✅ Success" : "❌ Failed"}`);

// 3. Test PostgreSQL Parameter Indexing
console.log("\n--- Parameter Indexing Check ---");
const hasSequentialParams = result.sql.includes('$1') && 
                            result.sql.includes(`$${result.params.length}`);
console.log(`Uses $1 through $${result.params.length}: ${hasSequentialParams ? "✅ Yes" : "❌ No"}`);

if (result.sql.includes('id > $4')) {
    console.log("✅ Cursor correctly indexed after filter params");
}