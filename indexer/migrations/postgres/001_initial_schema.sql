-- Initial PostgreSQL Schema for Soroban Indexer
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL,
    ledger BIGINT NOT NULL,
    ledger_closed_at TIMESTAMP WITH TIME ZONE NOT NULL,
    event_type TEXT NOT NULL,
    data TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_contract_id ON events(contract_id);
CREATE INDEX IF NOT EXISTS idx_events_ledger ON events(ledger DESC);
