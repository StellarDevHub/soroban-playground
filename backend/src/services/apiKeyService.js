// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import crypto from 'crypto';
import { getDatabase } from '../database/connection.js';
import { deriveTenantId } from '../utils/tenant.js';
import { clearApiKeyCache } from './apiKeyValidationCache.js';

export const API_KEY_SCOPES = Object.freeze([
  'contracts:read',
  'contracts:compile',
  'contracts:deploy',
]);

export const DEFAULT_API_KEY_SCOPES = Object.freeze([...API_KEY_SCOPES]);

const TIERS = new Set(['free', 'standard', 'premium', 'admin']);
const REVOCATION_STATUSES = new Set(['revoked', 'expired']);
const ROTATION_ROLES = new Set(['standalone', 'predecessor', 'successor']);

function toIso(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid date value');
  }
  return date.toISOString();
}

function toPositiveInteger(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, parsed));
}

function normalizeRotationRole(role) {
  const value = role || 'standalone';
  if (!ROTATION_ROLES.has(value)) {
    throw new Error(`Invalid rotation role: ${value}`);
  }
  return value;
}

export function normalizeApiKeyScopes(scopes) {
  if (scopes === undefined || scopes === null) {
    return [...DEFAULT_API_KEY_SCOPES];
  }

  let values;
  if (Array.isArray(scopes)) {
    values = scopes;
  } else if (typeof scopes === 'string') {
    const trimmed = scopes.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        values = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        throw new Error('Invalid API key scopes JSON');
      }
    } else {
      values = trimmed.split(',');
    }
  } else {
    throw new Error(
      'API key scopes must be an array or comma-separated string'
    );
  }

  const normalized = [];
  for (const value of values) {
    if (typeof value !== 'string') {
      throw new Error('API key scopes must be strings');
    }
    for (const candidate of value.split(',')) {
      const scope = candidate.trim();
      if (!scope) continue;
      if (!API_KEY_SCOPES.includes(scope)) {
        throw new Error(
          `Invalid API key scope: ${scope}. Allowed scopes: ${API_KEY_SCOPES.join(', ')}`
        );
      }
      if (!normalized.includes(scope)) normalized.push(scope);
    }
  }

  return normalized.length > 0 ? normalized : [...DEFAULT_API_KEY_SCOPES];
}

export function parseStoredScopes(value) {
  if (value === null || value === undefined || value === '') {
    return [...DEFAULT_API_KEY_SCOPES];
  }

  let values;
  if (Array.isArray(value)) {
    values = value;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[')) {
      try {
        values = JSON.parse(trimmed);
      } catch {
        return [];
      }
    } else {
      values = trimmed.split(',');
    }
  } else {
    return [];
  }

  const scopes = [];
  for (const entry of values) {
    if (typeof entry !== 'string') continue;
    const scope = entry.trim();
    if (API_KEY_SCOPES.includes(scope) && !scopes.includes(scope)) {
      scopes.push(scope);
    }
  }
  return scopes;
}

export function hasApiKeyScope(scopes, scope) {
  return parseStoredScopes(scopes).includes(scope);
}

export class ApiKeyService {
  async assertRotationCapacity(rotationGroupId) {
    const db = getDatabase();
    const row = await db.get(
      'SELECT COUNT(*) AS count FROM api_keys WHERE rotation_group_id = ? AND status = ?',
      [rotationGroupId, 'active']
    );
    if (Number(row?.count || 0) >= 2) {
      throw new Error('Rotation group already has two active API keys');
    }
  }

  async generateKey({
    name,
    description,
    tier = 'free',
    userId,
    organizationId,
    tenantId,
    expiresAt,
    scopes,
    rotationGroupId,
    rotationRole,
    replacesKeyId,
    rotationCutoffAt,
  }) {
    if (!name) throw new Error('API key name is required');
    if (!TIERS.has(tier)) {
      throw new Error(`Invalid tier: ${tier}`);
    }

    const normalizedScopes = normalizeApiKeyScopes(scopes);
    const normalizedRotationRole = normalizeRotationRole(rotationRole);
    const key = this.generateSecureKey();
    const keyHash = crypto.createHash('sha256').update(key).digest('hex');
    const keyPrefix = key.substring(0, 8);
    const resolvedTenantId =
      deriveTenantId({ tenantId, organizationId, userId }) || 'public';

    if (rotationGroupId) {
      await this.assertRotationCapacity(rotationGroupId);
    }

    const db = getDatabase();
    const result = await db.run(
      'INSERT INTO api_keys (tenant_id, key_hash, key_prefix, name, description, tier, status, scopes, rotation_group_id, rotation_role, replaces_key_id, rotation_cutoff_at, user_id, organization_id, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        resolvedTenantId,
        keyHash,
        keyPrefix,
        name,
        description,
        tier,
        'active',
        JSON.stringify(normalizedScopes),
        rotationGroupId || null,
        normalizedRotationRole,
        replacesKeyId || null,
        toIso(rotationCutoffAt),
        userId,
        organizationId,
        toIso(expiresAt),
      ]
    );

    await this.logAudit({
      action: 'key_generated',
      apiKeyId: result.lastID,
      userId,
      tenantId: resolvedTenantId,
      metadata: {
        tier,
        name,
        scopes: normalizedScopes,
        rotationGroupId: rotationGroupId || null,
      },
    });

    return {
      id: result.lastID,
      key,
      keyPrefix,
      name,
      description,
      tier,
      scopes: normalizedScopes,
      tenantId: resolvedTenantId,
      status: 'active',
      rotationGroupId: rotationGroupId || null,
      rotationRole: normalizedRotationRole,
      replacesKeyId: replacesKeyId || null,
      rotationCutoffAt: toIso(rotationCutoffAt),
      createdAt: new Date().toISOString(),
    };
  }

  async validateKey(key) {
    if (!key || typeof key !== 'string') return null;

    const keyPrefix = key.substring(0, 8);
    const keyHash = crypto.createHash('sha256').update(key).digest('hex');

    const db = getDatabase();
    const row = await db.get(
      'SELECT ak.*, tl.requests_per_minute, tl.requests_per_hour, tl.requests_per_day, tl.burst_limit ' +
        'FROM api_keys ak ' +
        'JOIN tier_limits tl ON ak.tier = tl.tier ' +
        "WHERE ak.key_prefix = ? AND ak.key_hash = ? AND ak.status = 'active'",
      [keyPrefix, keyHash]
    );

    if (!row) return null;

    const now = new Date();
    if (
      (row.expires_at && new Date(row.expires_at) < now) ||
      (row.rotation_cutoff_at && new Date(row.rotation_cutoff_at) < now)
    ) {
      await this.revokeKey(row.id, 'expired', { tenantId: row.tenant_id });
      return null;
    }

    await db.run(
      'UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP, usage_count = usage_count + 1 WHERE id = ?',
      [row.id]
    );

    return {
      id: row.id,
      name: row.name,
      tier: row.tier,
      scopes: parseStoredScopes(row.scopes),
      userId: row.user_id,
      organizationId: row.organization_id,
      tenantId: row.tenant_id,
      rotationGroupId: row.rotation_group_id || null,
      rotationRole: row.rotation_role || 'standalone',
      replacesKeyId: row.replaces_key_id || null,
      rotationCutoffAt: row.rotation_cutoff_at || null,
      limits: {
        requestsPerMinute: row.requests_per_minute,
        requestsPerHour: row.requests_per_hour,
        requestsPerDay: row.requests_per_day,
        burstLimit: row.burst_limit,
      },
      usageCount: row.usage_count + 1,
      lastUsedAt: now.toISOString(),
    };
  }

  async getKeyById(keyId, options = {}) {
    const db = getDatabase();
    const tenantId = options.tenantId || null;
    const row = await db.get(
      'SELECT ak.*, tl.requests_per_minute, tl.requests_per_hour, tl.requests_per_day, tl.burst_limit ' +
        'FROM api_keys ak ' +
        'JOIN tier_limits tl ON ak.tier = tl.tier ' +
        'WHERE ak.id = ? AND (? IS NULL OR ak.tenant_id = ?)',
      [keyId, tenantId, tenantId]
    );

    if (!row) return null;

    return {
      id: row.id,
      keyPrefix: row.key_prefix,
      name: row.name,
      description: row.description,
      tier: row.tier,
      status: row.status,
      scopes: parseStoredScopes(row.scopes),
      tenantId: row.tenant_id,
      userId: row.user_id,
      organizationId: row.organization_id,
      rotationGroupId: row.rotation_group_id || null,
      rotationRole: row.rotation_role || 'standalone',
      replacesKeyId: row.replaces_key_id || null,
      rotationCutoffAt: row.rotation_cutoff_at || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
      lastUsedAt: row.last_used_at,
      usageCount: row.usage_count,
      limits: {
        requestsPerMinute: row.requests_per_minute,
        requestsPerHour: row.requests_per_hour,
        requestsPerDay: row.requests_per_day,
        burstLimit: row.burst_limit,
      },
    };
  }

  async listKeys(userId, options = {}) {
    const db = getDatabase();
    const tenantId = options.tenantId || null;
    const status = options.status || null;
    const limit = toPositiveInteger(options.limit, 50, 1000);
    const offset = Math.max(0, Number.parseInt(options.offset, 10) || 0);

    const rows = await db.all(
      'SELECT ak.*, tl.requests_per_minute, tl.requests_per_hour, tl.requests_per_day, tl.burst_limit ' +
        'FROM api_keys ak ' +
        'JOIN tier_limits tl ON ak.tier = tl.tier ' +
        'WHERE ak.user_id = ? ' +
        'AND (? IS NULL OR ak.tenant_id = ?) ' +
        'AND (? IS NULL OR ak.status = ?) ' +
        'ORDER BY ak.created_at DESC LIMIT ? OFFSET ?',
      [userId, tenantId, tenantId, status, status, limit, offset]
    );

    return rows.map((row) => ({
      id: row.id,
      keyPrefix: row.key_prefix,
      name: row.name,
      description: row.description,
      tier: row.tier,
      status: row.status,
      scopes: parseStoredScopes(row.scopes),
      tenantId: row.tenant_id,
      rotationGroupId: row.rotation_group_id || null,
      rotationRole: row.rotation_role || 'standalone',
      replacesKeyId: row.replaces_key_id || null,
      rotationCutoffAt: row.rotation_cutoff_at || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
      lastUsedAt: row.last_used_at,
      usageCount: row.usage_count,
      limits: {
        requestsPerMinute: row.requests_per_minute,
        requestsPerHour: row.requests_per_hour,
        requestsPerDay: row.requests_per_day,
        burstLimit: row.burst_limit,
      },
    }));
  }

  async revokeKey(keyId, reason = 'revoked', options = {}) {
    const db = getDatabase();
    const status = REVOCATION_STATUSES.has(reason) ? reason : 'revoked';
    const tenantId = options.tenantId || null;
    const result = await db.run(
      'UPDATE api_keys SET status = ?, updated_at = CURRENT_TIMESTAMP ' +
        'WHERE id = ? AND (? IS NULL OR tenant_id = ?)',
      [status, keyId, tenantId, tenantId]
    );

    if (result?.changes > 0) clearApiKeyCache();

    await this.logAudit({
      action: 'key_revoked',
      apiKeyId: keyId,
      tenantId: options.tenantId,
      metadata: { reason },
    });
  }

  async rotateKey(keyId, options = {}) {
    const db = getDatabase();
    const tenantId = options.tenantId || null;
    const row = await db.get(
      'SELECT id, tenant_id, user_id, organization_id, name, description, tier, scopes, expires_at, rotation_group_id ' +
        'FROM api_keys ' +
        'WHERE id = ? AND status = ? AND (? IS NULL OR tenant_id = ?)',
      [keyId, 'active', tenantId, tenantId]
    );
    if (!row) {
      throw new Error('Active API key not found for rotation');
    }

    const groupId = row.rotation_group_id || crypto.randomUUID();
    const overlapSeconds = toPositiveInteger(
      options.overlapSeconds,
      300,
      86_400
    );
    const cutoffAt =
      toIso(options.rotationCutoffAt) ||
      new Date(Date.now() + overlapSeconds * 1000).toISOString();

    const successor = await this.generateKey({
      name: options.name || row.name,
      description: row.description,
      tier: row.tier,
      userId: row.user_id,
      organizationId: row.organization_id,
      tenantId: row.tenant_id,
      scopes: options.scopes ?? row.scopes,
      expiresAt: row.expires_at,
      rotationGroupId: groupId,
      rotationRole: 'successor',
      replacesKeyId: row.id,
    });

    await db.run(
      'UPDATE api_keys SET rotation_group_id = ?, rotation_role = ?, rotation_cutoff_at = ?, updated_at = CURRENT_TIMESTAMP ' +
        'WHERE id = ? AND status = ?',
      [groupId, 'predecessor', cutoffAt, row.id, 'active']
    );
    clearApiKeyCache();

    await this.logAudit({
      action: 'key_rotated',
      apiKeyId: successor.id,
      userId: row.user_id,
      tenantId: row.tenant_id,
      metadata: {
        previousKeyId: row.id,
        rotationGroupId: groupId,
        cutoffAt,
        scopes: successor.scopes,
      },
    });

    return {
      ...successor,
      rotation: {
        groupId,
        previousKeyId: row.id,
        cutoffAt,
      },
    };
  }

  async completeRotation(groupId, options = {}) {
    const db = getDatabase();
    const tenantId = options.tenantId || null;
    const result = await db.run(
      'UPDATE api_keys SET status = ?, updated_at = CURRENT_TIMESTAMP ' +
        'WHERE rotation_group_id = ? AND status = ? AND rotation_role = ? ' +
        'AND (? IS NULL OR tenant_id = ?)',
      ['revoked', groupId, 'active', 'predecessor', tenantId, tenantId]
    );

    if (result?.changes > 0) clearApiKeyCache();

    await this.logAudit({
      action: 'rotation_completed',
      tenantId: options.tenantId,
      userId: options.userId,
      metadata: {
        rotationGroupId: groupId,
        revoked: result?.changes || 0,
      },
    });

    return {
      rotationGroupId: groupId,
      revoked: result?.changes || 0,
    };
  }

  async getUsageStats(keyId, options = {}) {
    const days = toPositiveInteger(options.days, 30, 365);
    const tenantId = options.tenantId || null;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const params = [keyId, startDate.toISOString(), tenantId, tenantId];
    const db = getDatabase();

    const dailyUsage = await db.all(
      'SELECT DATE(window_start) as date, SUM(request_count) as requests ' +
        'FROM rate_limit_usage ' +
        'WHERE api_key_id = ? AND window_start >= ? AND (? IS NULL OR tenant_id = ?) ' +
        'GROUP BY DATE(window_start) ' +
        'ORDER BY date DESC',
      params
    );

    const endpointUsage = await db.all(
      'SELECT endpoint, SUM(request_count) as requests ' +
        'FROM rate_limit_usage ' +
        'WHERE api_key_id = ? AND window_start >= ? AND (? IS NULL OR tenant_id = ?) ' +
        'GROUP BY endpoint ' +
        'ORDER BY requests DESC',
      params
    );

    const violations = await db.all(
      'SELECT COUNT(*) as count, DATE(timestamp) as date ' +
        'FROM audit_log ' +
        "WHERE api_key_id = ? AND action = 'rate_limit_exceeded' AND timestamp >= ? AND (? IS NULL OR tenant_id = ?) " +
        'GROUP BY DATE(timestamp) ' +
        'ORDER BY date DESC',
      params
    );

    return {
      dailyUsage,
      endpointUsage,
      violations,
      period: `${days} days`,
    };
  }

  generateSecureKey() {
    return 'sk_' + crypto.randomBytes(32).toString('hex');
  }

  async logAudit(event) {
    const db = getDatabase();
    await db.run(
      'INSERT INTO audit_log (tenant_id, api_key_id, user_id, action, endpoint, ip_address, user_agent, status_code, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        event.tenantId || 'public',
        event.apiKeyId || null,
        event.userId || null,
        event.action,
        event.endpoint || null,
        event.ipAddress || null,
        event.userAgent || null,
        event.statusCode || null,
        JSON.stringify(event.metadata || {}),
      ]
    );
  }

  async trackUsage(
    apiKeyId,
    endpoint,
    tier,
    windowMinutes = 1,
    tenantId = 'public'
  ) {
    const now = new Date();
    const windowStart = new Date(now.getTime() - windowMinutes * 60 * 1000);
    const db = getDatabase();

    await db.run(
      'INSERT INTO rate_limit_usage (tenant_id, api_key_id, endpoint, request_count, window_start, window_end, tier) ' +
        'VALUES (?, ?, ?, 1, ?, ?, ?) ' +
        'ON CONFLICT(api_key_id, endpoint, window_start, window_end) ' +
        'DO UPDATE SET request_count = request_count + 1',
      [
        tenantId,
        apiKeyId,
        endpoint,
        windowStart.toISOString(),
        now.toISOString(),
        tier,
      ]
    );
  }
}

export default new ApiKeyService();
