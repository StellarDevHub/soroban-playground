// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import crypto from 'crypto';
import { asyncHandler, createHttpError } from '../../middleware/errorHandler.js';
import { QueryBuilder } from '../../services/queryBuilder.js';
import cacheService from '../../services/cacheService.js';
import { listEmittedEvents } from '../../services/emittedEventsService.js';

const router = express.Router();
const eventBuilder = new QueryBuilder('contract_events');

// Cache key derived from the full request body. Caching is a no-op when Redis is
// not connected (cacheService.get/set guard on isConnected).
function cacheKeyFor(body) {
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify(body ?? {}))
    .digest('hex');
  return `events:query:${hash}`;
}

/**
 * @route GET /api/v1/events/emitted
 * @desc Retrieve emitted contract events for frontend consumption
 */
router.get(
  '/emitted',
  asyncHandler(async (req, res, next) => {
    try {
      const result = await listEmittedEvents(req.query);
      return res.json({
        success: true,
        status: 'success',
        events: result.events,
        pageInfo: result.pageInfo,
        filters: result.filters,
      });
    } catch (error) {
      return next(createHttpError(400, error.message));
    }
  })
);

// Backward-compatible alias for clients that call /api/v1/events directly.
router.get(
  '/',
  asyncHandler(async (req, res, next) => {
    try {
      const result = await listEmittedEvents(req.query);
      return res.json({
        success: true,
        status: 'success',
        events: result.events,
        pageInfo: result.pageInfo,
        filters: result.filters,
      });
    } catch (error) {
      return next(createHttpError(400, error.message));
    }
  })
);

/**
 * @route POST /api/v1/events/query
 * @desc Query contract events with advanced filters and caching
 */
router.post(
  '/query',
  asyncHandler(async (req, res) => {
    const {
      filter,
      query,
      aggregate,
      pagination,
      sort,
      cursor,
      limit,
      useCache = true,
    } = req.body;

    // 1. Check Cache
    const cacheKey = cacheKeyFor(req.body);
    if (useCache) {
      const cachedResult = await cacheService.get(cacheKey);
      if (cachedResult) {
        return res.json({ ...cachedResult, _cached: true });
      }
    }

    // 2. Construct SQL with cursor-based pagination
    try {
      const pageSize = Math.min(
        Number(pagination?.limit ?? limit) || 50,
        eventBuilder.MAX_LIMIT
      );
      const pageCursor = pagination?.cursor ?? cursor;

      // Over-fetch one extra row so hasNextPage can be detected; cursor handling
      // (Base64 cursor → WHERE comparison, no OFFSET) lives in the QueryBuilder.
      const { sql, params } = eventBuilder.buildFullQuery({
        filter: filter ?? query ?? {},
        aggregate,
        sort,
        cursor: pageCursor,
        limit: pageSize + 1,
      });

      // 3. Execute (Simulated Database Call)
      // In a real app: const rows = await db.all(sql, params);
      const rows = [];
      const { edges, pageInfo } = eventBuilder.buildPageInfo(
        rows,
        pageSize,
        sort,
        pageCursor
      );

      const result = {
        data: edges.map((edge) => edge.node),
        edges,
        pageInfo,
        meta: { sql, params, executionTime: '12ms' },
      };

      // 4. Save to Cache
      if (useCache) await cacheService.set(cacheKey, result);

      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  })
);

export default router;
