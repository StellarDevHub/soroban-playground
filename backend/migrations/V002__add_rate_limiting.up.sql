-- Migration: Add rate limiting and API key management tables

-- API Keys table
CREATE TABLE api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key_hash TEXT NOT NULL UNIQUE, -- SHA-256 hash of the API key
    key_prefix TEXT NOT NULL, -- First 8 characters for lookup
    name TEXT NOT NULL,
    description TEXT,
    tier TEXT NOT NULL CHECK (tier IN ('free', 'standard', 'premium', 'admin')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
    user_id INTEGER,
    organization_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    last_used_at DATETIME,
    usage_count INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

-- Organizations table for multi-tenancy
CREATE TABLE organizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Rate limit usage tracking
CREATE TABLE rate_limit_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    api_key_id INTEGER NOT NULL,
    endpoint TEXT NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 1,
    window_start DATETIME NOT NULL,
    window_end DATETIME NOT NULL,
    tier TEXT NOT NULL,
    FOREIGN KEY (api_key_id) REFERENCES api_keys(id)
);

-- Tier limits configuration
CREATE TABLE tier_limits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tier TEXT NOT NULL UNIQUE CHECK (tier IN ('free', 'standard', 'premium', 'admin')),
    requests_per_minute INTEGER NOT NULL,
    requests_per_hour INTEGER NOT NULL,
    requests_per_day INTEGER NOT NULL,
    burst_limit INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Audit log for API access
CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    api_key_id INTEGER,
    user_id INTEGER,
    action TEXT NOT NULL, -- 'request', 'key_generated', 'key_revoked', etc.
    endpoint TEXT,
    ip_address TEXT,
    user_agent TEXT,
    status_code INTEGER,
    response_time_ms INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT, -- JSON for additional data
    FOREIGN KEY (api_key_id) REFERENCES api_keys(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Indexes for performance
CREATE INDEX idx_api_keys_key_prefix ON api_keys(key_prefix);
CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_status ON api_keys(status);
CREATE INDEX idx_rate_limit_usage_api_key_window ON rate_limit_usage(api_key_id, window_start, window_end);
CREATE INDEX idx_audit_log_api_key_timestamp ON audit_log(api_key_id, timestamp);
CREATE INDEX idx_audit_log_timestamp ON audit_log(timestamp);

-- Insert default tier limits
INSERT INTO tier_limits (tier, requests_per_minute, requests_per_hour, requests_per_day, burst_limit) VALUES
('free', 10, 100, 1000, 20),
('standard', 100, 1000, 10000, 200),
('premium', 1000, 10000, 100000, 2000),
('admin', 10000, 100000, 1000000, 20000);