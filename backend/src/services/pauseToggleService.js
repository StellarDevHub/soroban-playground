// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { invokeContract } from './invokeService.js';
import cacheService from './cacheService.js';

const CACHE_TTL = 30; // seconds

export async function initialize(contractId, admin) {
  return invokeContract({
    contractId,
    functionName: 'init',
    args: { admin },
    network: 'testnet',
  });
}

export async function pause(contractId, caller, reason = null) {
  const args = { caller, reason: reason ?? null };
  const result = await invokeContract({
    contractId,
    functionName: 'pause',
    args,
    network: 'testnet',
  });
  await cacheService.del(`pt:status:${contractId}`);
  await cacheService.del(`pt:reason:${contractId}`);
  await cacheService.del(`pt:timestamp:${contractId}`);
  return result;
}

export async function unpause(contractId, caller) {
  const result = await invokeContract({
    contractId,
    functionName: 'unpause',
    args: { caller },
    network: 'testnet',
  });
  await cacheService.del(`pt:status:${contractId}`);
  await cacheService.del(`pt:reason:${contractId}`);
  await cacheService.del(`pt:timestamp:${contractId}`);
  return result;
}

export async function isPaused(contractId) {
  const key = `pt:status:${contractId}`;
  const cached = await cacheService.get(key);
  if (cached !== null) return cached === 'true';
  const result = await invokeContract({
    contractId,
    functionName: 'paused',
    args: {},
    network: 'testnet',
  });
  await cacheService.set(key, String(result), CACHE_TTL);
  return result;
}

export async function getPauseReason(contractId) {
  const key = `pt:reason:${contractId}`;
  const cached = await cacheService.get(key);
  if (cached !== null) return cached === 'null' ? null : cached;
  const result = await invokeContract({
    contractId,
    functionName: 'get_pause_reason',
    args: {},
    network: 'testnet',
  });
  await cacheService.set(key, result === null ? 'null' : result, CACHE_TTL);
  return result;
}

export async function getPauseTimestamp(contractId) {
  const key = `pt:timestamp:${contractId}`;
  const cached = await cacheService.get(key);
  if (cached !== null) return cached === 'null' ? null : Number(cached);
  const result = await invokeContract({
    contractId,
    functionName: 'get_pause_timestamp',
    args: {},
    network: 'testnet',
  });
  await cacheService.set(key, result === null ? 'null' : String(result), CACHE_TTL);
  return result;
}

export async function getAdmin(contractId) {
  return invokeContract({
    contractId,
    functionName: 'get_admin',
    args: {},
    network: 'testnet',
  });
}

export default {
  initialize,
  pause,
  unpause,
  isPaused,
  getPauseReason,
  getPauseTimestamp,
  getAdmin,
};
