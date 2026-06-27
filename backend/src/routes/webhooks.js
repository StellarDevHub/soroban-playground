// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import {
  createSubscription,
  listSubscriptions,
  deleteSubscription,
  enqueueEvent,
  listDeliveries,
} from '../services/webhookService.js';
import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';

const router = express.Router();

const URL_RE = /^https?:\/\/.+/;

// GET /api/webhooks — list all subscriptions
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const subs = await listSubscriptions();
    res.json({ success: true, data: subs });
  })
);

// POST /api/webhooks — create a new subscription
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { url, events = [], secret } = req.body ?? {};

    if (!url || !URL_RE.test(url)) {
      throw createHttpError(400, 'url must be a valid http(s) URL');
    }
    if (!secret || typeof secret !== 'string' || secret.length < 16) {
      throw createHttpError(400, 'secret must be a string of at least 16 characters');
    }
    if (!Array.isArray(events)) {
      throw createHttpError(400, 'events must be an array of event type strings');
    }

    const sub = await createSubscription({ url, events, secret });
    res.status(201).json({ success: true, data: sub });
  })
);

// DELETE /api/webhooks/:id — remove a subscription
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const removed = await deleteSubscription(req.params.id);
    if (!removed) {
      throw createHttpError(404, `Webhook subscription '${req.params.id}' not found`);
    }
    res.json({ success: true, message: 'Subscription deleted' });
  })
);

// POST /api/webhooks/dispatch — manually trigger an event dispatch (useful for testing)
router.post(
  '/dispatch',
  asyncHandler(async (req, res) => {
    const { event_type, payload } = req.body ?? {};
    if (!event_type || typeof event_type !== 'string') {
      throw createHttpError(400, 'event_type is required');
    }
    const ids = await enqueueEvent(event_type, payload ?? {});
    res.status(202).json({
      success: true,
      data: { enqueued: ids.length, delivery_ids: ids },
    });
  })
);

// GET /api/webhooks/deliveries — delivery history (optional ?subscription_id=)
router.get(
  '/deliveries',
  asyncHandler(async (req, res) => {
    const { subscription_id, limit } = req.query;
    const rows = await listDeliveries(
      subscription_id || null,
      Math.min(parseInt(limit, 10) || 50, 200)
    );
    res.json({ success: true, data: rows });
  })
);

export default router;
