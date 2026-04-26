// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import crypto from 'crypto';

/**
 * Recursively sorts object keys for deterministic JSON stringification
 */
const deepSort = (obj) => {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return Array.isArray(obj) ? obj.map(deepSort) : obj;
  }
  return Object.keys(obj).sort().reduce((acc, key) => {
    acc[key] = deepSort(obj[key]);
    return acc;
  }, {});
};

export const generateCacheKey = (queryObject) => {
  const sorted = deepSort(queryObject);
  const hash = crypto.createHash('sha256')
    .update(JSON.stringify(sorted))
    .digest('hex');
  return `query_cache:${hash}`;
};