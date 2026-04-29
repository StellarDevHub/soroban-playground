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
