// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import { asyncHandler, createHttpError } from '../../middleware/errorHandler.js';
import rateLimit from 'express-rate-limit';
import logger from '../../utils/logger.js';
import * as cloudStorageService from '../services/cloudStorageService.js';

const router = express.Router();

// ── Middleware (only for this router) ─────────────────────────────────────────

// Request logger
router.use((req, _res, next) => {
  logger.info('Incoming request', {
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
  });
  next();
});

// Rate limiter: 100 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
router.use(limiter);

// ── Validation helpers ─────────────────────────────────────────────────────────

function validateUpload(body) {
  const errors = [];
  if (!body) return ['Request body required'];
  if (!body.fileId) errors.push('fileId is required');
  if (!body.totalSize || body.totalSize <= 0) errors.push('totalSize must be a positive number');
  if (!body.shardHashes || !Array.isArray(body.shardHashes) || body.shardHashes.length === 0) {
    errors.push('shardHashes must be a non-empty array');
  }
  if (body.redundancyFactor === undefined || body.redundancyFactor < 1 || body.redundancyFactor > 5) {
    errors.push('redundancyFactor must be an integer between 1 and 5');
  }
  if (body.owner) {
    if (typeof body.owner !== 'string' || !body.owner.startsWith('G')) {
      errors.push('owner must be a valid Stellar address');
    }
  }
  return errors.length ? errors : null;
}

function validateFileIdParam(param) {
  if (!param) return ['fileId path parameter required'];
  if (typeof param !== 'string' || param.length !== 56 || !param.startsWith('C')) {
    return ['fileId must be a valid contract ID (56 chars starting with C)'];
  }
  return null;
}

function validateNodeAddressParam(param) {
  if (!param) return ['nodeAddress path parameter required'];
  if (typeof param !== 'string' || ( !param.startsWith('G') && !param.startsWith('C') )) {
    return ['nodeAddress must be a valid Stellar address'];
  }
  return null;
}

// ── Routes ─────────────────────────────────────────────────────────────────────

// POST /api/cloud-storage/files - upload a file
router.post(
  '/files',
  asyncHandler(async (req, res, next) => {
    const validationErrors = validateUpload(req.body);
    if (validationErrors) {
      return next(createHttpError(400, 'Validation failed', validationErrors));
    }

    const { fileId, totalSize, shardHashes, redundancyFactor, owner } = req.body;

    const sourceAccount = req.headers['x-source-account'] || process.env.SOROBAN_SOURCE_ACCOUNT;
    if (!sourceAccount) {
      return next(createHttpError(400, 'Missing source account for Soroban transaction'));
    }

    const network = req.headers['x-network'] || process.env.DEFAULT_NETWORK || 'testnet';

    const metadata = await cloudStorageService.uploadFile({
      owner: owner || sourceAccount, // default to source account
      fileId,
      totalSize,
      shardHashes,
      redundancyFactor,
      sourceAccount,
      network,
    });

    res.status(201).json({
      success: true,
      status: 'success',
      message: 'File uploaded successfully',
      data: metadata,
    });
  })
);

// GET /api/cloud-storage/files/:fileId - retrieve file metadata
router.get(
  '/files/:fileId',
  asyncHandler(async (req, res, next) => {
    const paramErrors = validateFileIdParam(req.params.fileId);
    if (paramErrors) {
      return next(createHttpError(400, 'Invalid fileId', paramErrors));
    }

    const sourceAccount = req.headers['x-source-account'] || process.env.SOROBAN_SOURCE_ACCOUNT;
    const network = req.headers['x-network'] || process.env.DEFAULT_NETWORK || 'testnet';

    const metadata = await cloudStorageService.getFile({
      fileId: req.params.fileId,
      sourceAccount,
      network,
    });

    res.json({
      success: true,
      status: 'success',
      data: metadata,
    });
  })
);

// DELETE /api/cloud-storage/files/:fileId - delete a file
router.delete(
  '/files/:fileId',
  asyncHandler(async (req, next) => {
    const paramErrors = validateFileIdParam(req.params.fileId);
    if (paramErrors) {
      return next(createHttpError(400, 'Invalid fileId', paramErrors));
    }

    const caller = req.headers['x-caller-address'] || req.headers['x-source-account'];
    if (!caller) {
      return next(createHttpError(400, 'Caller address required (x-caller-address header)'));
    }

    const sourceAccount = caller;
    const network = req.headers['x-network'] || process.env.DEFAULT_NETWORK || 'testnet';

    await cloudStorageService.deleteFile({
      caller,
      fileId: req.params.fileId,
      sourceAccount,
      network,
    });

    res.json({
      success: true,
      status: 'success',
      message: 'File deleted',
    });
  })
);

// POST /api/cloud-storage/nodes - register a storage node
router.post(
  '/nodes',
  asyncHandler(async (req, res, next) => {
    const { nodeAddress, capacityBytes } = req.body || {};
    const errors = [];
    if (!nodeAddress) errors.push('nodeAddress is required');
    if (capacityBytes === undefined || capacityBytes <= 0) errors.push('capacityBytes must be a positive number');
    if (errors.length) {
      return next(createHttpError(400, 'Validation failed', errors));
    }

    const sourceAccount = nodeAddress; // node must authenticate as itself
    const network = req.headers['x-network'] || process.env.DEFAULT_NETWORK || 'testnet';

    await cloudStorageService.registerNode({
      nodeAddress,
      capacityBytes,
      sourceAccount,
      network,
    });

    res.status(201).json({
      success: true,
      status: 'success',
      message: 'Node registered',
    });
  })
);

// GET /api/cloud-storage/nodes/:nodeAddress/files - list files on a node
router.get(
  '/nodes/:nodeAddress/files',
  asyncHandler(async (req, res, next) => {
    const paramErrors = validateNodeAddressParam(req.params.nodeAddress);
    if (paramErrors) {
      return next(createHttpError(400, 'Invalid nodeAddress', paramErrors));
    }

    const sourceAccount = req.headers['x-source-account'] || process.env.SOROBAN_SOURCE_ACCOUNT;
    const network = req.headers['x-network'] || process.env.DEFAULT_NETWORK || 'testnet';

    const files = await cloudStorageService.getNodeFiles({
      nodeAddress: req.params.nodeAddress,
      sourceAccount,
      network,
    });

    res.json({
      success: true,
      status: 'success',
      data: files,
    });
  })
);

// POST /api/cloud-storage/files/:fileId/rebalance - trigger rebalance
router.post(
  '/files/:fileId/rebalance',
  asyncHandler(async (req, next) => {
    const paramErrors = validateFileIdParam(req.params.fileId);
    if (paramErrors) {
      return next(createHttpError(400, 'Invalid fileId', paramErrors));
    }

    const caller = req.headers['x-caller-address'] || req.headers['x-source-account'];
    if (!caller) {
      return next(createHttpError(400, 'Caller address required'));
    }

    const sourceAccount = caller;
    const network = req.headers['x-network'] || process.env.DEFAULT_NETWORK || 'testnet';

    await cloudStorageService.rebalanceShards({
      caller,
      fileId: req.params.fileId,
      sourceAccount,
      network,
    });

    res.json({
      success: true,
      status: 'success',
      message: 'Rebalance completed',
    });
  })
);

// GET /api/cloud-storage/health - health check
router.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const health = await cloudStorageService.health({ contractId: process.env.CLOUD_STORAGE_CONTRACT_ID });
    res.json(health);
  })
);

export default router;
