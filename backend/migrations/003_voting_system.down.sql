-- Rollback voting system tables

DROP INDEX IF EXISTS idx_whitelisted_address;
DROP INDEX IF EXISTS idx_votes_voter;
DROP INDEX IF EXISTS idx_votes_proposal;
DROP INDEX IF EXISTS idx_vote_commitments_voter;
DROP INDEX IF EXISTS idx_vote_commitments_proposal;
DROP INDEX IF EXISTS idx_proposals_creator;
DROP INDEX IF EXISTS idx_proposals_end_time;
DROP INDEX IF EXISTS idx_proposals_status;

DROP TABLE IF EXISTS whitelisted_users;
DROP TABLE IF EXISTS votes;
DROP TABLE IF EXISTS vote_commitments;
DROP TABLE IF EXISTS proposals;
