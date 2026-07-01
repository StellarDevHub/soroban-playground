-- Migration V006: Multi-tenant isolation columns and indexes

ALTER TABLE files ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'public';
ALTER TABLE projects ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'public';
ALTER TABLE search_analytics ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'public';
ALTER TABLE api_keys ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'public';
ALTER TABLE rate_limit_usage ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'public';
ALTER TABLE audit_log ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'public';
ALTER TABLE webhook_subscriptions ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'public';
ALTER TABLE webhook_deliveries ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'public';

UPDATE api_keys
SET tenant_id = CASE
  WHEN organization_id IS NOT NULL THEN 'org:' || organization_id
  WHEN user_id IS NOT NULL THEN 'user:' || user_id
  ELSE 'public'
END;

UPDATE audit_log
SET tenant_id = COALESCE(
  (SELECT tenant_id FROM api_keys WHERE api_keys.id = audit_log.api_key_id),
  CASE
    WHEN user_id IS NOT NULL THEN 'user:' || user_id
    ELSE 'public'
  END
);

UPDATE rate_limit_usage
SET tenant_id = COALESCE(
  (SELECT tenant_id FROM api_keys WHERE api_keys.id = rate_limit_usage.api_key_id),
  'public'
);

CREATE TABLE IF NOT EXISTS popular_searches_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL DEFAULT 'public',
    query TEXT NOT NULL,
    search_count INTEGER DEFAULT 1,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, query)
);

INSERT INTO popular_searches_new (tenant_id, query, search_count, last_updated)
SELECT 'public', query, search_count, last_updated FROM popular_searches;

DROP TABLE popular_searches;
ALTER TABLE popular_searches_new RENAME TO popular_searches;

CREATE TABLE IF NOT EXISTS favorites_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL DEFAULT 'public',
    wallet_address TEXT NOT NULL,
    favorites TEXT NOT NULL DEFAULT '[]',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, wallet_address)
);

INSERT INTO favorites_new (tenant_id, wallet_address, favorites, updated_at)
SELECT 'public', wallet_address, favorites, updated_at FROM favorites;

DROP TABLE favorites;
ALTER TABLE favorites_new RENAME TO favorites;

CREATE INDEX IF NOT EXISTS idx_projects_tenant ON projects(tenant_id);
CREATE INDEX IF NOT EXISTS idx_files_tenant ON files(tenant_id);
CREATE INDEX IF NOT EXISTS idx_search_analytics_tenant_timestamp ON search_analytics(tenant_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_popular_searches_tenant_count ON popular_searches(tenant_id, search_count DESC);
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant_id ON api_keys(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rate_limit_usage_tenant_window ON rate_limit_usage(tenant_id, window_start, window_end);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rate_limit_usage_unique ON rate_limit_usage(api_key_id, endpoint, window_start, window_end);
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_timestamp ON audit_log(tenant_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_tenant_active ON webhook_subscriptions(tenant_id, active);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_tenant_created ON webhook_deliveries(tenant_id, created_at);
