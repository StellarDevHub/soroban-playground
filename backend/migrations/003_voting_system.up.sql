-- Voting System Tables

-- Proposals table
CREATE TABLE IF NOT EXISTS proposals (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    description_hash VARCHAR(64) NOT NULL,
    duration INTEGER NOT NULL,
    creator VARCHAR(255) NOT NULL,
    created_at BIGINT NOT NULL,
    end_time BIGINT NOT NULL,
    status VARCHAR(50) DEFAULT 'active',
    votes_for BIGINT DEFAULT 0,
    votes_against BIGINT DEFAULT 0,
    total_participants INTEGER DEFAULT 0,
    finalized_at BIGINT,
    CONSTRAINT valid_status CHECK (status IN ('active', 'finalized', 'cancelled'))
);

-- Vote commitments table (privacy-preserving)
CREATE TABLE IF NOT EXISTS vote_commitments (
    id SERIAL PRIMARY KEY,
    proposal_id INTEGER NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
    voter VARCHAR(255) NOT NULL,
    commitment_hash VARCHAR(64) NOT NULL,
    timestamp BIGINT NOT NULL,
    UNIQUE(proposal_id, voter)
);

-- Votes table (revealed votes)
CREATE TABLE IF NOT EXISTS votes (
    id SERIAL PRIMARY KEY,
    proposal_id INTEGER NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
    voter VARCHAR(255) NOT NULL,
    credits INTEGER NOT NULL,
    votes INTEGER NOT NULL,
    is_for BOOLEAN NOT NULL,
    revealed_at BIGINT NOT NULL,
    UNIQUE(proposal_id, voter)
);

-- Whitelisted users table
CREATE TABLE IF NOT EXISTS whitelisted_users (
    id SERIAL PRIMARY KEY,
    address VARCHAR(255) UNIQUE NOT NULL,
    initial_credits INTEGER DEFAULT 0,
    whitelisted_by VARCHAR(255) NOT NULL,
    whitelisted_at BIGINT NOT NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
CREATE INDEX IF NOT EXISTS idx_proposals_end_time ON proposals(end_time);
CREATE INDEX IF NOT EXISTS idx_proposals_creator ON proposals(creator);
CREATE INDEX IF NOT EXISTS idx_vote_commitments_proposal ON vote_commitments(proposal_id);
CREATE INDEX IF NOT EXISTS idx_vote_commitments_voter ON vote_commitments(voter);
CREATE INDEX IF NOT EXISTS idx_votes_proposal ON votes(proposal_id);
CREATE INDEX IF NOT EXISTS idx_votes_voter ON votes(voter);
CREATE INDEX IF NOT EXISTS idx_whitelisted_address ON whitelisted_users(address);
