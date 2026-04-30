// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT
//
// REST API for the Decentralized Content Publishing Platform.
//
// Mount in the main router with:
//   import contentPublishingRouter from './routes/contentPublishing.js';
//   app.use('/api/content', contentPublishingRouter);

import express from 'express';
import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';
import contentPublishingService from '../services/contentPublishingService.js';

const router = express.Router();

// ── Validation helpers ──────────────────────────────────────────────────────

const STELLAR_ADDRESS = /^[GC][A-Z2-7]{55}$/;
const HEX_HASH = /^[A-Fa-f0-9]{64}$/;

function requireString(value, field, { max = 256 } = {}) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw createHttpError(400, `${field} is required`);
  }
  if (value.length > max) {
    throw createHttpError(400, `${field} must be <= ${max} characters`);
  }
  return value.trim();
}

function requireAddress(value, field) {
  const v = requireString(value, field);
  if (!STELLAR_ADDRESS.test(v)) {
    throw createHttpError(400, `${field} is not a valid Stellar address`);
  }
  return v;
}

function requireHash(value, field) {
  const v = requireString(value, field);
  if (!HEX_HASH.test(v)) {
    throw createHttpError(400, `${field} must be a 32-byte hex string`);
  }
  return v.toLowerCase();
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
    res.json({ success: true, service: 'content-publishing', status: 'ok' });
  })
);

// Authors --------------------------------------------------------------------

router.post(
  '/authors',
  asyncHandler(async (req, res) => {
    const address = requireAddress(req.body?.address, 'address');
    const name = requireString(req.body?.name, 'name', { max: 64 });
    const bio = req.body?.bio == null ? '' : requireString(req.body.bio, 'bio', { max: 512 });
    const subscriptionPrice = req.body?.subscriptionPrice ?? 0;
    const periodSeconds = req.body?.periodSeconds;
    const profile = contentPublishingService.registerAuthor({
      address,
      name,
      bio,
      subscriptionPrice,
      periodSeconds,
    });
    res.status(201).json({ success: true, data: profile });
  })
);

router.patch(
  '/authors/:address',
  asyncHandler(async (req, res) => {
    const address = requireAddress(req.params.address, 'address');
    const updates = {};
    if (req.body?.name !== undefined) updates.name = requireString(req.body.name, 'name', { max: 64 });
    if (req.body?.bio !== undefined) updates.bio = requireString(req.body.bio, 'bio', { max: 512 });
    if (req.body?.subscriptionPrice !== undefined) updates.subscriptionPrice = req.body.subscriptionPrice;
    if (req.body?.periodSeconds !== undefined) updates.periodSeconds = req.body.periodSeconds;
    const profile = contentPublishingService.updateAuthor(address, updates);
    res.json({ success: true, data: profile });
  })
);

router.get(
  '/authors/:address',
  asyncHandler(async (req, res) => {
    const address = requireAddress(req.params.address, 'address');
    const profile = contentPublishingService.getAuthor(address);
    if (!profile) throw createHttpError(404, 'Author not found');
    res.json({ success: true, data: profile });
  })
);

router.get(
  '/authors/:address/articles',
  asyncHandler(async (req, res) => {
    const address = requireAddress(req.params.address, 'address');
    const { limit, offset } = paginate(req.query);
    const articles = contentPublishingService.getArticlesByAuthor(address, { limit, offset });
    res.json({ success: true, data: articles, pagination: { limit, offset } });
  })
);

router.get(
  '/authors/:address/subscribers',
  asyncHandler(async (req, res) => {
    const address = requireAddress(req.params.address, 'address');
    const { limit, offset } = paginate(req.query);
    const subscribers = contentPublishingService.getSubscribers(address, { limit, offset });
    res.json({ success: true, data: subscribers, pagination: { limit, offset } });
  })
);

router.get(
  '/authors/:address/analytics',
  asyncHandler(async (req, res) => {
    const address = requireAddress(req.params.address, 'address');
    const stats = contentPublishingService.getStats(address);
    res.json({ success: true, data: stats });
  })
);

// Articles -------------------------------------------------------------------

router.post(
  '/articles',
  asyncHandler(async (req, res) => {
    const author = requireAddress(req.body?.author, 'author');
    const title = requireString(req.body?.title, 'title', { max: 200 });
    const contentHash = requireHash(req.body?.contentHash, 'contentHash');
    const premium = Boolean(req.body?.premium);
    const article = contentPublishingService.publish({ author, title, contentHash, premium });
    res.status(201).json({ success: true, data: article });
  })
);

router.get(
  '/articles/latest',
  asyncHandler(async (req, res) => {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20)));
    const data = contentPublishingService.getLatestArticles({ limit });
    res.json({ success: true, data });
  })
);

router.get(
  '/articles/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw createHttpError(400, 'id must be a positive integer');
    }
    const article = contentPublishingService.getArticle(id);
    res.json({ success: true, data: article });
  })
);

router.post(
  '/articles/:id/view',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const reader = requireAddress(req.body?.reader, 'reader');
    const article = contentPublishingService.recordView({ articleId: id, reader });
    res.json({ success: true, data: article });
  })
);

router.post(
  '/articles/:id/like',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const reader = requireAddress(req.body?.reader, 'reader');
    const article = contentPublishingService.like({ articleId: id, reader });
    res.json({ success: true, data: article });
  })
);

router.post(
  '/articles/:id/tip',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const from = requireAddress(req.body?.from, 'from');
    const event = contentPublishingService.tip({
      articleId: id,
      from,
      amount: req.body?.amount,
    });
    res.json({ success: true, data: event });
  })
);

// Subscriptions --------------------------------------------------------------

router.post(
  '/subscriptions',
  asyncHandler(async (req, res) => {
    const author = requireAddress(req.body?.author, 'author');
    const subscriber = requireAddress(req.body?.subscriber, 'subscriber');
    const periods = req.body?.periods ?? 1;
    const sub = contentPublishingService.subscribe({ author, subscriber, periods });
    res.status(201).json({ success: true, data: sub });
  })
);

router.get(
  '/subscriptions/:author/:subscriber',
  asyncHandler(async (req, res) => {
    const author = requireAddress(req.params.author, 'author');
    const subscriber = requireAddress(req.params.subscriber, 'subscriber');
    const sub = contentPublishingService.getSubscription(author, subscriber);
    if (!sub) throw createHttpError(404, 'Subscription not found');
    res.json({
      success: true,
      data: { ...sub, active: contentPublishingService.hasActiveSubscription(author, subscriber) },
    });
  })
);

// Platform analytics --------------------------------------------------------

router.get(
  '/analytics/platform',
  asyncHandler(async (_req, res) => {
    res.json({ success: true, data: contentPublishingService.getPlatformAnalytics() });
  })
);

export default router;
