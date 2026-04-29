-- Quorum System Schema
CREATE TABLE IF NOT EXISTS oracles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    reputation INTEGER DEFAULT 100,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quorums (
    id TEXT PRIMARY KEY,
    quorum_type TEXT NOT NULL, -- 'bridge', 'oracle', 'governance'
    state TEXT NOT NULL, -- 'collecting', 'threshold_reached', 'consensus_achieved', 'failed'
    strategy TEXT NOT NULL, -- 'simple_majority', 'super_majority', 'unanimous'
    threshold INTEGER NOT NULL,
    target_id TEXT, -- ID of the object being voted on (e.g. deposit_id)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE IF NOT EXISTS votes (
    id TEXT PRIMARY KEY,
    quorum_id TEXT NOT NULL REFERENCES quorums(id),
    oracle_id TEXT NOT NULL REFERENCES oracles(id),
    choice TEXT NOT NULL,
    data TEXT, -- Optional JSON data accompanying the vote
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(quorum_id, oracle_id) -- Prevent double voting
);

CREATE INDEX IF NOT EXISTS idx_votes_quorum_id ON votes(quorum_id);
CREATE INDEX IF NOT EXISTS idx_quorums_state ON quorums(state);
