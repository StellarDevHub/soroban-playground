import express from 'express';
import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';
import { rateLimitMiddleware } from '../middleware/rateLimiter.js';
import {
  uploadFile,
  getFileInfo,
  getShardInfo,
  createStorageOffer,
  grantAccess,
  revokeAccess,
  addShard,
} from '../services/cloudStorageService.js';

const router = express.Router();

// Upload file metadata to contract
router.post('/upload', rateLimitMiddleware('api'), asyncHandler(async (req, res) => {
  const { owner, name, size, shardCount, redundancyLevel, cid } = req.body;
  if (!owner || !name || !size || !shardCount || !redundancyLevel || !cid) {
    throw createHttpError(400, 'Missing required fields');
  }

  const result = await uploadFile({ owner, name, size, shardCount, redundancyLevel, cid });
  res.json({ success: true, data: result });
}));

// Add shard metadata
router.post('/shard', rateLimitMiddleware('api'), asyncHandler(async (req, res) => {
  const { cid, shardId, hash, size, provider } = req.body;
  if (!cid || shardId === undefined || !hash || !size || !provider) {
    throw createHttpError(400, 'Missing required fields');
  }

  const result = await addShard({ cid, shardId, hash, size, provider });
  res.json({ success: true, data: result });
}));

// Get file info
router.get('/file/:cid', asyncHandler(async (req, res) => {
  const { cid } = req.params;
  const result = await getFileInfo(cid);
  res.json({ success: true, data: result });
}));

// Get shard info
router.get('/file/:cid/shard/:shardId', asyncHandler(async (req, res) => {
  const { cid, shardId } = req.params;
  const result = await getShardInfo(cid, parseInt(shardId));
  res.json({ success: true, data: result });
}));

// Create storage offer
router.post('/offer', rateLimitMiddleware('api'), asyncHandler(async (req, res) => {
  const { provider, capacity, pricePerGb } = req.body;
  if (!provider || !capacity || pricePerGb === undefined) {
    throw createHttpError(400, 'Missing required fields');
  }

  const result = await createStorageOffer({ provider, capacity, pricePerGb });
  res.json({ success: true, data: result });
}));

// Grant access
router.post('/access/grant', rateLimitMiddleware('api'), asyncHandler(async (req, res) => {
  const { cid, user } = req.body;
  if (!cid || !user) {
    throw createHttpError(400, 'Missing required fields');
  }

  const result = await grantAccess(cid, user);
  res.json({ success: true, data: result });
}));

// Revoke access
router.post('/access/revoke', rateLimitMiddleware('api'), asyncHandler(async (req, res) => {
  const { cid, user } = req.body;
  if (!cid || !user) {
    throw createHttpError(400, 'Missing required fields');
  }

  const result = await revokeAccess(cid, user);
  res.json({ success: true, data: result });
}));

// Health check endpoint
router.get('/health', asyncHandler(async (req, res) => {
  // Check database, cache, etc.
  res.json({ success: true, status: 'healthy', timestamp: new Date().toISOString() });
}));

export default router;