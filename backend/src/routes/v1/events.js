// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { QueryBuilder } from '../../services/queryBuilder.js';
import { getCachedQuery, setCachedQuery } from '../../services/cacheService.js';

const router = express.Router();
const eventBuilder = new QueryBuilder('contract_events');

/**
 * @route POST /api/v1/events/query
 * @desc Query contract events with advanced filters and caching
 */
router.post(
  '/query',
  asyncHandler(async (req, res) => {
    const { query, aggregate, pagination, sort, useCache = true } = req.body;

    // 1. Check Cache
    if (useCache) {
      const cachedResult = await getCachedQuery(req.body);
      if (cachedResult) {
        return res.json({ ...cachedResult, _cached: true });
      }
    }

    // 2. Construct SQL
    try {
      const { whereClause, params } = eventBuilder.build(query);
      const { select, groupBy } = eventBuilder.buildAggregation(aggregate);
      const { limitClause, orderBy } = eventBuilder.buildPagination({
        ...pagination,
        sort,
      });

      const fullSql = `
      ${select} 
      FROM ${eventBuilder.tableName} 
      ${whereClause} 
      ${groupBy} 
      ${orderBy} 
      ${limitClause}
    `
        .trim()
        .replace(/\s+/g, ' ');

      // 3. Execute (Simulated Database Call)
      // In a real app: const result = await db.query(fullSql, params);
      const result = {
        data: [], // Results from DB
        meta: { sql: fullSql, params, executionTime: '12ms' },
      };

      // 4. Save to Cache
      if (useCache) await setCachedQuery(req.body, result);

      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  })
);

export default router;
