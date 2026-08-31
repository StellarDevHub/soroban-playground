// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT
// 
// ⚠️ DEPRECATED: This file is deprecated and will be removed in a future version.
// All cache functionality has been merged into redisService.js for unified connection pooling.
// Please import from './redisService.js' instead.

import redisService from './redisService.js';

console.warn(
  'DEPRECATION WARNING: cacheService.js is deprecated. Use redisService.js instead.'
);

// Re-export redisService as default for backward compatibility
export default redisService;
