-- Enhanced Database Schema for Production-Grade Search System

-- Projects table with full-text search support
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'funded', 'completed', 'cancelled')),
    creator_id INTEGER NOT NULL,
    creator_name TEXT NOT NULL,
    funding_goal REAL NOT NULL,
    current_funding REAL DEFAULT 0,
    completion_rate REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    tags TEXT, -- JSON array of tags
    metadata TEXT -- JSON for additional metadata
);

-- FTS5 virtual table for enhanced full-text search with weighted fields
CREATE VIRTUAL TABLE IF NOT EXISTS projects_fts USING fts5(
    title UNINDEXED,
    description,
    category,
    creator_name,
    tags,
    content='projects',
    content_rowid='id',
    tokenize='porter unicode61 remove_diacritics 1'
);

-- FTS triggers to keep search index synchronized
CREATE TRIGGER IF NOT EXISTS projects_fts_insert AFTER INSERT ON projects BEGIN
    INSERT INTO projects_fts(rowid, title, description, category, creator_name, tags)
    VALUES (new.id, new.title, new.description, new.category, new.creator_name, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS projects_fts_delete AFTER DELETE ON projects BEGIN
    INSERT INTO projects_fts(projects_fts, rowid, title, description, category, creator_name, tags)
    VALUES ('delete', old.id, old.title, old.description, old.category, old.creator_name, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS projects_fts_update AFTER UPDATE ON projects BEGIN
    INSERT INTO projects_fts(projects_fts, rowid, title, description, category, creator_name, tags)
    VALUES ('delete', old.id, old.title, old.description, old.category, old.creator_name, old.tags);
    INSERT INTO projects_fts(rowid, title, description, category, creator_name, tags)
    VALUES (new.id, new.title, new.description, new.category, new.creator_name, new.tags);
END;

-- Search analytics table
CREATE TABLE IF NOT EXISTS search_analytics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query TEXT NOT NULL,
    filters_applied TEXT, -- JSON object of applied filters
    results_count INTEGER NOT NULL,
    response_time_ms INTEGER NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    user_agent TEXT,
    ip_address TEXT
);

-- Search suggestions/autocomplete table
CREATE TABLE IF NOT EXISTS search_suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    suggestion TEXT NOT NULL UNIQUE,
    frequency INTEGER DEFAULT 1,
    last_used DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Popular searches cache
CREATE TABLE IF NOT EXISTS popular_searches (
    query TEXT PRIMARY KEY,
    search_count INTEGER DEFAULT 1,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_projects_category ON projects(category);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_creator ON projects(creator_id);
CREATE INDEX IF NOT EXISTS idx_projects_funding ON projects(current_funding);
CREATE INDEX IF NOT EXISTS idx_projects_created ON projects(created_at);
CREATE INDEX IF NOT EXISTS idx_projects_completion ON projects(completion_rate);
CREATE INDEX IF NOT EXISTS idx_search_analytics_timestamp ON search_analytics(timestamp);
CREATE INDEX IF NOT EXISTS idx_search_suggestions_freq ON search_suggestions(frequency DESC);

-- API Keys table for rate limiting and authentication
CREATE TABLE IF NOT EXISTS api_keys (
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
CREATE TABLE IF NOT EXISTS organizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Rate limit usage tracking
CREATE TABLE IF NOT EXISTS rate_limit_usage (
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
CREATE TABLE IF NOT EXISTS tier_limits (
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
CREATE TABLE IF NOT EXISTS audit_log (
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

-- Additional indexes for rate limiting tables
CREATE INDEX IF NOT EXISTS idx_api_keys_key_prefix ON api_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_status ON api_keys(status);
CREATE INDEX IF NOT EXISTS idx_rate_limit_usage_api_key_window ON rate_limit_usage(api_key_id, window_start, window_end);
CREATE INDEX IF NOT EXISTS idx_audit_log_api_key_timestamp ON audit_log(api_key_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);

-- Insert default tier limits
INSERT OR IGNORE INTO tier_limits (tier, requests_per_minute, requests_per_hour, requests_per_day, burst_limit) VALUES
('free', 10, 100, 1000, 20),
('standard', 100, 1000, 10000, 200),
('premium', 1000, 10000, 100000, 2000),
('admin', 10000, 100000, 1000000, 20000);

-- Sample data for testing
INSERT OR IGNORE INTO projects (title, description, category, status, creator_id, creator_name, funding_goal, current_funding, completion_rate, tags) VALUES
('Decentralized Voting Platform', 'A blockchain-based voting system ensuring transparency and immutability', 'DeFi', 'active', 1, 'Alice Johnson', 50000, 25000, 50.0, '["voting", "governance", "blockchain"]'),
('Stellar Payment Gateway', 'Seamless payment processing for merchants using Stellar network', 'Payments', 'funded', 2, 'Bob Smith', 75000, 75000, 100.0, '["payments", "stellar", "merchant"]'),
('NFT Marketplace', 'Platform for creating and trading NFTs on Stellar', 'NFT', 'active', 3, 'Carol Davis', 100000, 45000, 45.0, '["nft", "marketplace", "digital-art"]'),
('Cross-chain Bridge', 'Bridge assets between Stellar and other blockchains', 'Infrastructure', 'draft', 4, 'David Wilson', 200000, 0, 0.0, '["bridge", "cross-chain", "interoperability"]'),
('DeFi Lending Protocol', 'Decentralized lending and borrowing platform', 'DeFi', 'completed', 5, 'Emma Brown', 150000, 150000, 100.0, '["lending", "defi", "yield"]'),
('Stellar Stablecoin', 'Fiat-collateralized stablecoin on Stellar network', 'Payments', 'active', 6, 'Frank Miller', 30000, 12000, 40.0, '["stablecoin", "payments", "fiat"]'),
('Smart Contract Auditor', 'Automated smart contract security auditing tool', 'Tools', 'funded', 7, 'Grace Lee', 80000, 80000, 100.0, '["security", "auditing", "smart-contracts"]'),
('Stellar DEX Analytics', 'Advanced analytics for Stellar decentralized exchange', 'Analytics', 'active', 8, 'Henry Chen', 60000, 35000, 58.3, '["analytics", "dex", "trading"]');

-- DAO Treasury Tables
CREATE TABLE IF NOT EXISTS treasury_proposals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contract_tx_id INTEGER NOT NULL UNIQUE,
    proposer TEXT NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    recipient TEXT,
    status TEXT NOT NULL CHECK (status IN ('Pending', 'Queued', 'Executed', 'Cancelled', 'Expired')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    execute_after DATETIME NOT NULL,
    expires_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS treasury_approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    proposal_id INTEGER NOT NULL,
    signer TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(proposal_id) REFERENCES treasury_proposals(contract_tx_id)
);

CREATE TABLE IF NOT EXISTS treasury_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    data TEXT NOT NULL, -- JSON event data
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);
