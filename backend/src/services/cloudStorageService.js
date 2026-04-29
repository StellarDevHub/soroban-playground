// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { invokeSorobanContract } from './invokeService.js';
import { createHttpError } from '../middleware/errorHandler.js';
import { LRUCache } from 'lru-cache';

// In-memory cache for file metadata (GET /files/:fileId)
const fileCache = new LRUCache({
  max: 500,
  ttl: 30 * 1000, // 30 seconds
});

// Contract ID from env
const CONTRACT_ID = process.env.CLOUD_STORAGE_CONTRACT_ID;

function mapContractError(err) {
  const message = err.message || '';
  if (message.includes('ContractPaused')) {
    const e = createHttpError(423, 'Contract is paused');
    return e;
  }
  if (message.includes('Unauthorized') || message.includes('NotFileOwner')) {
    return createHttpError(403, 'Unauthorized');
  }
  if (message.includes('FileNotFound') || message.includes('ShardAssignmentMissing') || message.includes('NodeNotFound')) {
    return createHttpError(404, 'Resource not found');
  }
  if (message.includes('Invalid') || message.includes('Mismatch') || message.includes('Insufficient')) {
    return createHttpError(400, 'Invalid parameters');
  }
  if (message.includes('RebalanceFailed')) {
    return createHttpError(409, 'Rebalance failed: insufficient resources');
  }
  // Fallback
  return createHttpError(500, 'Internal server error');
}

async function callContract(functionName, args, sourceAccount, network) {
  try {
    const result = await invokeSorobanContract({
      contractId: CONTRACT_ID,
      functionName,
      args,
      sourceAccount,
      network,
      requestId: `${functionName}-${Date.now()}`,
    });
    return result.parsed;
  } catch (err) {
    // If already an HttpError, rethrow
    if (err.statusCode) {
      throw err;
    }
    throw mapContractError(err);
  }
}

export async function uploadFile({ owner, fileId, totalSize, shardHashes, redundancyFactor, sourceAccount, network }) {
  return callContract(
    'upload_file',
    {
      owner,
      file_id: fileId,
      total_size: totalSize,
      shard_hashes: shardHashes,
      redundancy_factor: redundancyFactor,
    },
    sourceAccount,
    network
  );
}

export async function getFile({ fileId, sourceAccount, network }) {
  // Check cache first
  const cacheKey = `file:${fileId}`;
  const cached = fileCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const result = await callContract(
    'get_file',
    { file_id: fileId },
    sourceAccount,
    network
  );

  // Cache the result
  fileCache.set(cacheKey, result);
  return result;
}

export async function deleteFile({ caller, fileId, sourceAccount, network }) {
  const result = await callContract(
    'delete_file',
    { caller, file_id: fileId },
    sourceAccount,
    network
  );
  // Invalidate cache
  fileCache.del(`file:${fileId}`);
  return result;
}

export async function registerNode({ nodeAddress, capacityBytes, sourceAccount, network }) {
  return callContract(
    'register_node',
    { node: nodeAddress, capacity_bytes: capacityBytes },
    sourceAccount,
    network
  );
}

export async function getNodeFiles({ nodeAddress, sourceAccount, network }) {
  return callContract(
    'get_node_files',
    { node: nodeAddress },
    sourceAccount,
    network
  );
}

export async function rebalanceShards({ caller, fileId, sourceAccount, network }) {
  const result = await callContract(
    'rebalance_shards',
    { caller, file_id: fileId },
    sourceAccount,
    network
  );
  // Invalidate cache
  fileCache.del(`file:${fileId}`);
  return result;
}

export async function pauseContract({ admin, sourceAccount, network }) {
  return callContract(
    'pause_contract',
    { admin },
    sourceAccount,
    network
  );
}

export async function unpauseContract({ admin, sourceAccount, network }) {
  return callContract(
    'unpause_contract',
    { admin },
    sourceAccount,
    network
  );
}

export async function health({ contractId }) {
  // Simple health: return status and contract id
  return { status: 'ok', contractId: contractId || CONTRACT_ID, network: process.env.DEFAULT_NETWORK || 'testnet' };
}
