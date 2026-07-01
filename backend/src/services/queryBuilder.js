// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import {
  buildCursorClause,
  buildPageInfo,
  normalizeSort,
} from '../utils/cursorPagination.js';
import { rlsRules } from '../config/rlsRules.js';

export class QueryBuilder {
  constructor(tableName = 'contract_events') {
    this.tableName = tableName;
    this.MAX_LIMIT = 1000;
    this.params = [];
    this.operators = {
      $eq: '=',
      $gte: '>=',
      $lte: '<=',
      $in: 'IN',
      $between: 'BETWEEN',
    };
  }

  /**
   * Applies Row-Level Security restrictions to the query filter
   */
  applyRLS(filter, user, action) {
    const rule = rlsRules[this.tableName];
    if (rule) {
      const restriction = rule(user, action);
      if (restriction) {
        if (!filter || Object.keys(filter).length === 0) {
          return restriction;
        }
        return {
          $and: [
            filter,
            restriction
          ]
        };
      }
    }
    return filter;
  }

  /**
   * Main entry point to build a full SQL statement from a unified query object
   */
  buildFullQuery(jsonQuery, user = null, action = 'read') {
    this.params = []; // Reset parameters for new query
    let { filter = {}, sort = [], limit = 50, cursor, aggregate } = jsonQuery;

    if (user) {
      filter = this.applyRLS(filter, user, action);
    }

    const where = this._parseNode(filter);
    const { select, groupBy } = this.buildAggregation(aggregate);
    const { limitClause, orderBy, cursorClause } = this.buildPagination({
      limit,
      sort,
      cursor,
    });

    // Combine WHERE and Cursor logic
    const conditions = [where, cursorClause].filter(Boolean);
    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      ${select} 
      FROM ${this.tableName} 
      ${whereClause} 
      ${groupBy} 
      ${orderBy} 
      ${limitClause}
    `
      .trim()
      .replace(/\s+/g, ' ');

    return { sql, params: this.params };
  }

  _parseNode(node, logicalOp = 'AND') {
    if (!node || Object.keys(node).length === 0) return '';
    const expressions = [];

    for (const [key, value] of Object.entries(node)) {
      if (key === '$or' || key === '$and') {
        const subOp = key === '$or' ? 'OR' : 'AND';
        const subExpressions = value
          .map((subNode) => this._parseNode(subNode))
          .filter(Boolean);
        if (subExpressions.length > 0) {
          expressions.push(`(${subExpressions.join(` ${subOp} `)})`);
        }
      } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        for (const [op, opVal] of Object.entries(value)) {
          if (this.operators[op])
            expressions.push(this._buildExpression(key, op, opVal));
        }
      } else {
        expressions.push(this._buildExpression(key, '$eq', value));
      }
    }
    return expressions.join(` ${logicalOp} `);
  }

  _buildExpression(column, op, value) {
    if (!/^[a-zA-Z0-9_]+$/.test(column))
      throw new Error(`Invalid column: ${column}`);
    const sqlOp = this.operators[op];

    if (op === '$in') {
      const placeholders = value.map((v) => {
        this.params.push(v);
        return `$${this.params.length}`;
      });
      return `${column} ${sqlOp} (${placeholders.join(', ')})`;
    }

    if (op === '$between') {
      this.params.push(value[0], value[1]);
      return `${column} ${sqlOp} $${this.params.length - 1} AND $${this.params.length}`;
    }

    this.params.push(value);
    return `${column} ${sqlOp} $${this.params.length}`;
  }

  buildAggregation(agg) {
    if (!agg) return { select: 'SELECT *', groupBy: '' };
    const select = `${agg.type.toUpperCase()}(${agg.field || '*'}) as result`;
    const groupBy = agg.groupBy ? `GROUP BY ${agg.groupBy.join(', ')}` : '';
    const selectCols = agg.groupBy
      ? `${agg.groupBy.join(', ')}, ${select}`
      : select;
    return { select: `SELECT ${selectCols}`, groupBy };
  }

  buildPagination({ limit, sort, cursor } = {}) {
    const safeLimit = Math.min(limit || 50, this.MAX_LIMIT);

    // Normalize the sort (always ending on the `id` tiebreaker) so ordering and
    // cursors stay deterministic.
    const order = normalizeSort(sort);
    const orderBy = `ORDER BY ${order
      .map((s) => `${s.field} ${s.direction}`)
      .join(', ')}`;

    let cursorClause = '';
    if (cursor) {
      // Base64 cursor → WHERE comparison clause (no OFFSET). Keep this builder's
      // $N placeholder style so the fragment composes with the rest of the SQL.
      const { clause, params } = buildCursorClause({
        sort,
        cursor,
        paramOffset: this.params.length,
        placeholder: (index) => `$${index}`,
      });
      this.params.push(...params);
      cursorClause = clause;
    }

    return { limitClause: `LIMIT ${safeLimit}`, orderBy, cursorClause };
  }

  /**
   * Builds the connection payload (edges + pageInfo) from an over-fetched row
   * set. Callers request `limit + 1` rows so `hasNextPage` can be detected.
   */
  buildPageInfo(rows, limit, sort, cursor = null) {
    return buildPageInfo(rows, limit, sort, cursor);
  }
}
