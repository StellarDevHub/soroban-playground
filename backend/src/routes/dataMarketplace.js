// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT
//
// REST API for the Decentralized Data Marketplace.
//
// Mount in the main router with:
//   import dataMarketplaceRouter from './routes/dataMarketplace.js';
//   app.use('/api/marketplace', dataMarketplaceRouter);

import express from 'express';
import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';
import dataMarketplaceService from '../services/dataMarketplaceService.js';

const router = express.Router();

// ── Validation helpers ──────────────────────────────────────────────────────

const STELLAR_ADDRESS = /^[GC][A-Z2-7]{55}$/;
const HEX_HASH = /^[A-Fa-f0-9]{64}$/;

function requireString(value, field, { max = 256 } = {}) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw createHttpError(400, `${field} is required`);
  }
  if (value.length > max) throw createHttpError(400, `${field} must be <= ${max} characters`);
  return value.trim();
}

function requireAddress(value, field) {
  const v = requireString(value, field);
  if (!STELLAR_ADDRESS.test(v)) throw createHttpError(400, `${field} is not a valid Stellar address`);
  return v;
}

function requireHash(value, field) {
  const v = requireString(value, field);
  if (!HEX_HASH.test(v)) throw createHttpError(400, `${field} must be a 32-byte hex string`);
  return v.toLowerCase();
}

function requireInt(value, field, { min = Number.MIN_SAFE_INTEGER } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) {
    throw createHttpError(400, `${field} must be an integer >= ${min}`);
  }
  return n;
}

function paginate(query) {
  const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
  const offset = Math.max(0, Number(query.offset ?? 0));
  return { limit, offset };
}

// ── Routes ──────────────────────────────────────────────────────────────────

router.get(
  '/health',
  asyncHandler(async (_req, res) => {
    res.json({ success: true, service: 'data-marketplace', status: 'ok' });
  })
);

// Providers ------------------------------------------------------------------

router.post(
  '/providers',
  asyncHandler(async (req, res) => {
    const address = requireAddress(req.body?.address, 'address');
    const name = requireString(req.body?.name, 'name', { max: 64 });
    const contactHash = requireHash(req.body?.contactHash, 'contactHash');
    const profile = dataMarketplaceService.registerProvider({ address, name, contactHash });
    res.status(201).json({ success: true, data: profile });
  })
);

router.get(
  '/providers/:address',
  asyncHandler(async (req, res) => {
    const address = requireAddress(req.params.address, 'address');
    const profile = dataMarketplaceService.getProvider(address);
    if (!profile) throw createHttpError(404, 'Provider not found');
    res.json({ success: true, data: profile });
  })
);

router.get(
  '/providers/:address/datasets',
  asyncHandler(async (req, res) => {
    const address = requireAddress(req.params.address, 'address');
    res.json({ success: true, data: dataMarketplaceService.getProviderDatasets(address) });
  })
);

// Datasets -------------------------------------------------------------------

router.post(
  '/datasets',
  asyncHandler(async (req, res) => {
    const provider = requireAddress(req.body?.provider, 'provider');
    const title = requireString(req.body?.title, 'title', { max: 200 });
    const schemaHash = requireHash(req.body?.schemaHash, 'schemaHash');
    const manifestHash = requireHash(req.body?.manifestHash, 'manifestHash');
    const encryptionPubkey = requireHash(req.body?.encryptionPubkey, 'encryptionPubkey');
    const flatPrice = requireInt(req.body?.flatPrice ?? 0, 'flatPrice', { min: 0 });
    const pricePerQuery = requireInt(req.body?.pricePerQuery ?? 0, 'pricePerQuery', { min: 0 });
    const licenseSeconds = requireInt(req.body?.licenseSeconds, 'licenseSeconds', { min: 1 });

    const dataset = dataMarketplaceService.listDataset({
      provider,
      title,
      schemaHash,
      manifestHash,
      encryptionPubkey,
      flatPrice,
      pricePerQuery,
      licenseSeconds,
    });
    res.status(201).json({ success: true, data: dataset });
  })
);

router.get(
  '/datasets',
  asyncHandler(async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)));
    res.json({ success: true, data: dataMarketplaceService.listActiveDatasets({ limit }) });
  })
);

router.get(
  '/datasets/:id',
  asyncHandler(async (req, res) => {
    const id = requireInt(req.params.id, 'id', { min: 1 });
    const dataset = dataMarketplaceService.getDataset(id);
    if (!dataset) throw createHttpError(404, 'Dataset not found');
    res.json({ success: true, data: dataset });
  })
);

router.patch(
  '/datasets/:id',
  asyncHandler(async (req, res) => {
    const id = requireInt(req.params.id, 'id', { min: 1 });
    const provider = requireAddress(req.body?.provider, 'provider');
    const updates = { provider, id };
    if (req.body?.flatPrice !== undefined) {
      updates.flatPrice = requireInt(req.body.flatPrice, 'flatPrice', { min: 0 });
    }
    if (req.body?.pricePerQuery !== undefined) {
      updates.pricePerQuery = requireInt(req.body.pricePerQuery, 'pricePerQuery', { min: 0 });
    }
    const dataset = dataMarketplaceService.updateDatasetPrice(updates);
    res.json({ success: true, data: dataset });
  })
);

router.post(
  '/datasets/:id/delist',
  asyncHandler(async (req, res) => {
    const id = requireInt(req.params.id, 'id', { min: 1 });
    const provider = requireAddress(req.body?.provider, 'provider');
    const dataset = dataMarketplaceService.delistDataset({ provider, id });
    res.json({ success: true, data: dataset });
  })
);

router.get(
  '/datasets/:id/analytics',
  asyncHandler(async (req, res) => {
    const id = requireInt(req.params.id, 'id', { min: 1 });
    res.json({ success: true, data: dataMarketplaceService.getDatasetStats(id) });
  })
);

router.get(
  '/datasets/:id/buyers',
  asyncHandler(async (req, res) => {
    const id = requireInt(req.params.id, 'id', { min: 1 });
    const { limit, offset } = paginate(req.query);
    res.json({
      success: true,
      data: dataMarketplaceService.getDatasetBuyers(id, { limit, offset }),
      pagination: { limit, offset },
    });
  })
);

// Licenses & queries ---------------------------------------------------------

router.post(
  '/licenses',
  asyncHandler(async (req, res) => {
    const buyer = requireAddress(req.body?.buyer, 'buyer');
    const datasetId = requireInt(req.body?.datasetId, 'datasetId', { min: 1 });
    const maxQueries = requireInt(req.body?.maxQueries, 'maxQueries', { min: 1 });
    const license = dataMarketplaceService.purchaseAccess({ buyer, datasetId, maxQueries });
    res.status(201).json({ success: true, data: license });
  })
);

router.get(
  '/licenses/:datasetId/:buyer',
  asyncHandler(async (req, res) => {
    const datasetId = requireInt(req.params.datasetId, 'datasetId', { min: 1 });
    const buyer = requireAddress(req.params.buyer, 'buyer');
    const license = dataMarketplaceService.getLicense(datasetId, buyer);
    if (!license) throw createHttpError(404, 'License not found');
    res.json({ success: true, data: license });
  })
);

router.post(
  '/queries',
  asyncHandler(async (req, res) => {
    const buyer = requireAddress(req.body?.buyer, 'buyer');
    const datasetId = requireInt(req.body?.datasetId, 'datasetId', { min: 1 });
    const commitment = requireHash(req.body?.commitment, 'commitment');
    const receipt = dataMarketplaceService.submitQuery({ buyer, datasetId, commitment });
    res.status(201).json({ success: true, data: receipt });
  })
);

router.get(
  '/queries/:commitment',
  asyncHandler(async (req, res) => {
    const commitment = requireHash(req.params.commitment, 'commitment');
    const receipt = dataMarketplaceService.getQueryReceipt(commitment);
    if (!receipt) throw createHttpError(404, 'Receipt not found');
    res.json({ success: true, data: receipt });
  })
);

router.post(
  '/queries/verify',
  asyncHandler(async (req, res) => {
    const commitment = requireHash(req.body?.commitment, 'commitment');
    const preimage = requireString(req.body?.preimageHex, 'preimageHex', { max: 8192 });
    const valid = dataMarketplaceService.verifyCommitment(commitment, preimage);
    res.json({ success: true, data: { valid } });
  })
);

// Buyer & platform analytics ------------------------------------------------

router.get(
  '/buyers/:address/analytics',
  asyncHandler(async (req, res) => {
    const address = requireAddress(req.params.address, 'address');
    res.json({ success: true, data: dataMarketplaceService.getBuyerStats(address) });
  })
);

router.get(
  '/analytics/platform',
  asyncHandler(async (_req, res) => {
    res.json({ success: true, data: dataMarketplaceService.getPlatformAnalytics() });
  })
);

export default router;
