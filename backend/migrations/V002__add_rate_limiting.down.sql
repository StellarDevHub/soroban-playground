-- Migration: Remove rate limiting and API key management tables

DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS rate_limit_usage;
DROP TABLE IF EXISTS tier_limits;
DROP TABLE IF EXISTS api_keys;
DROP TABLE IF EXISTS organizations;