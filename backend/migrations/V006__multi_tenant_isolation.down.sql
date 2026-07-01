-- Rollback V006: rebuild tenant-owned tables without tenant_id columns.

DROP INDEX IF EXISTS idx_projects_tenant;
DROP INDEX IF EXISTS idx_files_tenant;
DROP INDEX IF EXISTS idx_search_analytics_tenant_timestamp;
DROP INDEX IF EXISTS idx_popular_searches_tenant_count;
DROP INDEX IF EXISTS idx_api_keys_tenant_id;
DROP INDEX IF EXISTS idx_rate_limit_usage_tenant_window;
DROP INDEX IF EXISTS idx_rate_limit_usage_unique;
DROP INDEX IF EXISTS idx_audit_log_tenant_timestamp;
DROP INDEX IF EXISTS idx_webhook_subscriptions_tenant_active;
DROP INDEX IF EXISTS idx_webhook_deliveries_tenant_created;

CREATE TABLE favorites_old (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_address TEXT NOT NULL,
    favorites TEXT NOT NULL DEFAULT '[]',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(wallet_address)
);

INSERT OR IGNORE INTO favorites_old (id, wallet_address, favorites, updated_at)
SELECT id, wallet_address, favorites, updated_at FROM favorites;

DROP TABLE favorites;
ALTER TABLE favorites_old RENAME TO favorites;

CREATE TABLE popular_searches_old (
    query TEXT PRIMARY KEY,
    search_count INTEGER DEFAULT 1,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO popular_searches_old (query, search_count, last_updated)
SELECT query, search_count, last_updated FROM popular_searches;

DROP TABLE popular_searches;
ALTER TABLE popular_searches_old RENAME TO popular_searches;
