-- Ledger continuity tracking for reorg detection, rollback and gap recovery.
CREATE TABLE IF NOT EXISTS ledgers (
    sequence BIGINT PRIMARY KEY,
    ledger_hash TEXT NOT NULL,
    parent_ledger_hash TEXT NOT NULL,
    ingested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ledgers_ledger_hash ON ledgers(ledger_hash);
