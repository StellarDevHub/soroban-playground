// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import crypto from 'crypto';
import { getDatabase } from '../database/connection.js';

/**
 * API Key Management Service
 * Handles generation, validation, and management of API keys with tiered access
 */
export class ApiKeyService {
  /**
   * Generate a new API key
   * @param {Object} params
   * @param {string} params.name - Key name
   * @param {string} params.description - Key description
   * @param {string} params.tier - Access tier (free, standard, premium, admin)
   * @param {number} params.userId - User ID
   * @param {number} params.organizationId - Organization ID (optional)
   * @param {Date} params.expiresAt - Expiration date (optional)
   * @returns {Object} Generated key data
   */
  async generateKey({
    name,
    description,
    tier = 'free',
    userId,
    organizationId,
    expiresAt
  }) {
    const key = this.generateSecureKey();
    const keyHash = crypto.createHash('sha256').update(key).digest('hex');
    const keyPrefix = key.substring(0, 8);

    const db = getDatabase();
    const result = await db.run(
      `INSERT INTO api_keys (key_hash, key_prefix, name, description, tier, user_id, organization_id, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [keyHash, keyPrefix, name, description, tier, userId, organizationId, expiresAt]
    );

    // Log key generation
    await this.logAudit({
      action: 'key_generated',
      apiKeyId: result.lastID,
      userId,
      metadata: { tier, name }
    });

    return {
      id: result.lastID,
      key,
      keyPrefix,
      name,
      description,
      tier,
      status: 'active',
      createdAt: new Date().toISOString()
    };
  }

  /**
   * Validate an API key
   * @param {string} key - The API key to validate
   * @returns {Object|null} Key data if valid, null otherwise
   */
  async validateKey(key) {
    if (!key || typeof key !== 'string') return null;

    const keyPrefix = key.substring(0, 8);
    const keyHash = crypto.createHash('sha256').update(key).digest('hex');

    const db = getDatabase();
    const row = await db.get(
      `SELECT ak.*, tl.requests_per_minute, tl.requests_per_hour, tl.requests_per_day, tl.burst_limit
       FROM api_keys ak
       JOIN tier_limits tl ON ak.tier = tl.tier
       WHERE ak.key_prefix = ? AND ak.key_hash = ? AND ak.status = 'active'`,
      [keyPrefix, keyHash]
    );

    if (!row) return null;

    // Check expiration
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      await this.revokeKey(row.id, 'expired');
      return null;
    }

    // Update last used and usage count
    const db = getDatabase();
    await db.run(
      `UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP, usage_count = usage_count + 1 WHERE id = ?`,
      [row.id]
    );

    return {
      id: row.id,
      name: row.name,
      tier: row.tier,
      userId: row.user_id,
      organizationId: row.organization_id,
      limits: {
        requestsPerMinute: row.requests_per_minute,
        requestsPerHour: row.requests_per_hour,
        requestsPerDay: row.requests_per_day,
        burstLimit: row.burst_limit
      },
      usageCount: row.usage_count + 1,
      lastUsedAt: new Date().toISOString()
    };
  }

  /**
   * Get API key by ID
   * @param {number} keyId - Key ID
   * @returns {Object|null} Key data
   */
  async getKeyById(keyId) {
    const db = getDatabase();
    const row = await db.get(
      `SELECT ak.*, tl.requests_per_minute, tl.requests_per_hour, tl.requests_per_day, tl.burst_limit
       FROM api_keys ak
       JOIN tier_limits tl ON ak.tier = tl.tier
       WHERE ak.id = ?`,
      [keyId]
    );

    if (!row) return null;

    return {
      id: row.id,
      keyPrefix: row.key_prefix,
      name: row.name,
      description: row.description,
      tier: row.tier,
      status: row.status,
      userId: row.user_id,
      organizationId: row.organization_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
      lastUsedAt: row.last_used_at,
      usageCount: row.usage_count,
      limits: {
        requestsPerMinute: row.requests_per_minute,
        requestsPerHour: row.requests_per_hour,
        requestsPerDay: row.requests_per_day,
        burstLimit: row.burst_limit
      }
    };
  }

  /**
   * List API keys for a user
   * @param {number} userId - User ID
   * @param {Object} options - Query options
   * @returns {Array} List of keys
   */
  async listKeys(userId, options = {}) {
    const { limit = 50, offset = 0, status } = options;
    const db = getDatabase();

    let query = `
      SELECT ak.*, tl.requests_per_minute, tl.requests_per_hour, tl.requests_per_day, tl.burst_limit
      FROM api_keys ak
      JOIN tier_limits tl ON ak.tier = tl.tier
      WHERE ak.user_id = ?
    `;
    const params = [userId];

    if (status) {
      query += ' AND ak.status = ?';
      params.push(status);
    }

    query += ' ORDER BY ak.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = await db.all(query, params);

    return rows.map(row => ({
      id: row.id,
      keyPrefix: row.key_prefix,
      name: row.name,
      description: row.description,
      tier: row.tier,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
      lastUsedAt: row.last_used_at,
      usageCount: row.usage_count,
      limits: {
        requestsPerMinute: row.requests_per_minute,
        requestsPerHour: row.requests_per_hour,
        requestsPerDay: row.requests_per_day,
        burstLimit: row.burst_limit
      }
    }));
  }

  /**
   * Revoke an API key
   * @param {number} keyId - Key ID
   * @param {string} reason - Revocation reason
   */
  async revokeKey(keyId, reason = 'revoked') {
    const db = getDatabase();
    await db.run(
      `UPDATE api_keys SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [reason, keyId]
    );

    // Log revocation
    await this.logAudit({
      action: 'key_revoked',
      apiKeyId: keyId,
      metadata: { reason }
    });
  }

  /**
   * Get usage statistics for an API key
   * @param {number} keyId - Key ID
   * @param {Object} options - Time range options
   * @returns {Object} Usage statistics
   */
  async getUsageStats(keyId, options = {}) {
    const { days = 30 } = options;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const db = getDatabase();

    // Get daily usage
    const dailyUsage = await db.all(
      `SELECT DATE(window_start) as date, SUM(request_count) as requests
       FROM rate_limit_usage
       WHERE api_key_id = ? AND window_start >= ?
       GROUP BY DATE(window_start)
       ORDER BY date DESC`,
      [keyId, startDate.toISOString()]
    );

    // Get total usage by endpoint
    const endpointUsage = await db.all(
      `SELECT endpoint, SUM(request_count) as requests
       FROM rate_limit_usage
       WHERE api_key_id = ? AND window_start >= ?
       GROUP BY endpoint
       ORDER BY requests DESC`,
      [keyId, startDate.toISOString()]
    );

    // Get violations (if we track them)
    const violations = await db.all(
      `SELECT COUNT(*) as count, DATE(timestamp) as date
       FROM audit_log
       WHERE api_key_id = ? AND action = 'rate_limit_exceeded' AND timestamp >= ?
       GROUP BY DATE(timestamp)
       ORDER BY date DESC`,
      [keyId, startDate.toISOString()]
    );

    return {
      dailyUsage,
      endpointUsage,
      violations,
      period: `${days} days`
    };
  }

  /**
   * Generate a secure random API key
   * @returns {string} Generated key
   */
  generateSecureKey() {
    return 'sk_' + crypto.randomBytes(32).toString('hex');
  }

  /**
   * Log audit event
   * @param {Object} event - Audit event data
   */
  async logAudit(event) {
    const db = getDatabase();
    await db.run(
      `INSERT INTO audit_log (api_key_id, user_id, action, metadata) VALUES (?, ?, ?, ?)`,
      [event.apiKeyId, event.userId, event.action, JSON.stringify(event.metadata || {})]
    );
  }

  /**
   * Track rate limit usage
   * @param {number} apiKeyId - API key ID
   * @param {string} endpoint - Request endpoint
   * @param {string} tier - User tier
   * @param {number} windowMinutes - Window size in minutes
   */
  async trackUsage(apiKeyId, endpoint, tier, windowMinutes = 1) {
    const now = new Date();
    const windowStart = new Date(now.getTime() - (windowMinutes * 60 * 1000));
    const db = getDatabase();

    await db.run(
      `INSERT INTO rate_limit_usage (api_key_id, endpoint, request_count, window_start, window_end, tier)
       VALUES (?, ?, 1, ?, ?, ?)
       ON CONFLICT(api_key_id, endpoint, window_start, window_end)
       DO UPDATE SET request_count = request_count + 1`,
      [apiKeyId, endpoint, windowStart.toISOString(), now.toISOString(), tier]
    );
  }
}

export default new ApiKeyService();