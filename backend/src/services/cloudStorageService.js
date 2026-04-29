import { invokeContract } from './invokeService.js';
import { cacheService } from './cacheService.js';
import { createSpan, setSpanAttributes } from '../utils/tracing.js';

const CONTRACT_ID = process.env.CLOUD_STORAGE_CONTRACT_ID;
const CACHE_TTL = 300; // 5 minutes

export async function uploadFile({ owner, name, size, shardCount, redundancyLevel, cid }) {
  return createSpan('uploadFile', async (span) => {
    setSpanAttributes(span, { cid, owner });

    const result = await invokeContract({
      contractId: CONTRACT_ID,
      functionName: 'upload_file',
      args: {
        owner,
        name,
        size: size.toString(),
        shard_count: shardCount.toString(),
        redundancy_level: redundancyLevel.toString(),
        cid,
      },
    });

    // Cache the file info
    await cacheService.set(`file:${cid}`, { owner, name, size, shardCount, redundancyLevel }, CACHE_TTL);

    return result;
  });
}

export async function getFileInfo(cid) {
  return createSpan('getFileInfo', async (span) => {
    setSpanAttributes(span, { cid });

    // Check cache first
    const cached = await cacheService.get(`file:${cid}`);
    if (cached) {
      return cached;
    }

    const result = await invokeContract({
      contractId: CONTRACT_ID,
      functionName: 'get_file_info',
      args: { cid },
    });

    // Cache the result
    await cacheService.set(`file:${cid}`, result, CACHE_TTL);

    return result;
  });
}

export async function getShardInfo(cid, shardId) {
  return createSpan('getShardInfo', async (span) => {
    setSpanAttributes(span, { cid, shardId });

    const cacheKey = `shard:${cid}:${shardId}`;
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      return cached;
    }

    const result = await invokeContract({
      contractId: CONTRACT_ID,
      functionName: 'get_shard_info',
      args: {
        cid,
        shard_id: shardId.toString(),
      },
    });

    await cacheService.set(cacheKey, result, CACHE_TTL);

    return result;
  });
}

export async function createStorageOffer({ provider, capacity, pricePerGb }) {
  return createSpan('createStorageOffer', async (span) => {
    setSpanAttributes(span, { provider });

    const result = await invokeContract({
      contractId: CONTRACT_ID,
      functionName: 'create_offer',
      args: {
        provider,
        capacity: capacity.toString(),
        price_per_gb: pricePerGb.toString(),
      },
    });

    return result;
  });
}

export async function grantAccess(cid, user) {
  return createSpan('grantAccess', async (span) => {
    setSpanAttributes(span, { cid, user });

    const result = await invokeContract({
      contractId: CONTRACT_ID,
      functionName: 'grant_access',
      args: { cid, user },
    });

    // Invalidate cache
    await cacheService.del(`file:${cid}`);

    return result;
  });
}

export async function addShard({ cid, shardId, hash, size, provider }) {
  return createSpan('addShard', async (span) => {
    setSpanAttributes(span, { cid, shardId, provider });

    const result = await invokeContract({
      contractId: CONTRACT_ID,
      functionName: 'add_shard',
      args: {
        cid,
        shard_id: shardId.toString(),
        hash,
        size: size.toString(),
        provider,
      },
    });

    // Invalidate cache
    await cacheService.del(`shard:${cid}:${shardId}`);

    return result;
  });
}