-- Rollback V004

DROP INDEX IF EXISTS idx_webhook_deliveries_status_next;
DROP TABLE IF EXISTS webhook_deliveries;
DROP TABLE IF EXISTS webhook_subscriptions;
DROP TABLE IF EXISTS cors_whitelist;
