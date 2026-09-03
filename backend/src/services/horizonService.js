// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { getDatabase } from '../database/connection.js';

const DEFAULT_HORIZON_URLS = [
  'https://horizon-testnet.stellar.org',
  'https://horizon.stellar.org',
];

function parseHorizonUrls(envUrls) {
  if (!envUrls) return DEFAULT_HORIZON_URLS;
  return envUrls
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
}

/**
 * Stellar Horizon Ingestion Engine with Transaction Hash Indexing
 * Implements resilient polling with exponential backoff, gap detection,
 * transaction hash indexing, and SQLite database storage.
 */
export class HorizonService {
  constructor({
    db = null,
    horizonUrls = null,
    fetchImpl = globalThis.fetch,
    logger = console,
    pollIntervalMs = 10000,
    maxRetries = 5,
  } = {}) {
    this.db = db;
    this.horizonUrls = horizonUrls || parseHorizonUrls(process.env.HORIZON_URLS);
    this.fetchImpl = fetchImpl;
    this.logger = logger;
    this.pollIntervalMs = pollIntervalMs;
    this.maxRetries = maxRetries;

    this.timer = null;
    this.cursor = null;
    this.lastLedger = 0;

    this.status = {
      running: false,
      lastIngestedAt: null,
      totalIngested: 0,
      consecutiveErrors: 0,
      lastError: null,
      currentCursor: null,
      lastLedger: 0,
    };
  }

  async getDb() {
    if (this.db) return this.db;
    this.db = await getDatabase();
    return this.db;
  }

  async ensureSchema() {
    const db = await this.getDb();
    await db.exec(`
      CREATE TABLE IF NOT EXISTS horizon_transactions_index (
        id TEXT PRIMARY KEY,
        transaction_hash TEXT NOT NULL UNIQUE,
        ledger INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        source_account TEXT,
        fee_charged INTEGER DEFAULT 0,
        operation_count INTEGER DEFAULT 0,
        paging_token TEXT NOT NULL,
        successful INTEGER NOT NULL DEFAULT 1,
        memo TEXT,
        envelope_xdr TEXT,
        result_xdr TEXT,
        indexed_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_horizon_tx_ledger ON horizon_transactions_index(ledger);
      CREATE INDEX IF NOT EXISTS idx_horizon_tx_source ON horizon_transactions_index(source_account);
      CREATE INDEX IF NOT EXISTS idx_horizon_tx_created ON horizon_transactions_index(created_at);

      CREATE TABLE IF NOT EXISTS horizon_ingestion_cursor (
        id TEXT PRIMARY KEY,
        cursor TEXT NOT NULL,
        last_ledger INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'synced',
        updated_at TEXT NOT NULL
      );
    `);
  }

  async readCursor() {
    await this.ensureSchema();
    const db = await this.getDb();
    const row = await db.get(
      "SELECT * FROM horizon_ingestion_cursor WHERE id = 'horizon-main-cursor'"
    );

    if (row) {
      this.cursor = row.cursor;
      this.lastLedger = row.last_ledger || 0;
      this.status.currentCursor = row.cursor;
      this.status.lastLedger = row.last_ledger || 0;
      return row;
    }

    return {
      id: 'horizon-main-cursor',
      cursor: 'now',
      last_ledger: 0,
      status: 'pending',
    };
  }

  async saveCursor(cursor, lastLedger = 0, status = 'synced') {
    await this.ensureSchema();
    const db = await this.getDb();
    const now = new Date().toISOString();

    await db.run(
      `
        INSERT INTO horizon_ingestion_cursor (id, cursor, last_ledger, status, updated_at)
        VALUES ('horizon-main-cursor', ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          cursor = excluded.cursor,
          last_ledger = excluded.last_ledger,
          status = excluded.status,
          updated_at = excluded.updated_at
      `,
      [cursor, lastLedger, status, now]
    );

    this.cursor = cursor;
    this.lastLedger = lastLedger;
    this.status.currentCursor = cursor;
    this.status.lastLedger = lastLedger;
  }

  /**
   * Fetches transactions from Horizon API with exponential backoff & retry
   */
  async fetchTransactions({ cursor, limit = 50, order = 'asc' } = {}) {
    let lastError = null;

    for (const baseUrl of this.horizonUrls) {
      const cleanBase = baseUrl.replace(/\/$/, '');
      const cursorParam = cursor && cursor !== 'now' ? `&cursor=${encodeURIComponent(cursor)}` : '';
      const url = `${cleanBase}/transactions?limit=${limit}&order=${order}${cursorParam}`;

      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        try {
          if (attempt > 0) {
            const delay = Math.min(
              1000 * Math.pow(2, attempt - 1) + Math.random() * 200,
              16000
            );
            await new Promise((r) => setTimeout(r, delay));
          }

          const response = await this.fetchImpl(url, {
            headers: { Accept: 'application/json' },
          });

          if (response.status === 429) {
            this.logger.warn?.(`Horizon rate limit hit on ${baseUrl}, backing off (attempt ${attempt + 1})`);
            continue;
          }

          if (!response.ok) {
            throw new Error(`Horizon HTTP status ${response.status} from ${url}`);
          }

          const data = await response.json();
          const records = data?._embedded?.records || [];
          return records;
        } catch (err) {
          lastError = err;
          this.logger.warn?.(`Horizon request failed (attempt ${attempt + 1}): ${err.message}`);
        }
      }
    }

    throw lastError || new Error('All Horizon endpoints failed to respond');
  }

  /**
   * Detects ledger sequence gaps in ingested transaction streams
   */
  detectGaps(records, previousLedger = 0) {
    if (!records || records.length === 0) {
      return { hasGap: false, missingLedgers: [] };
    }

    const missingLedgers = [];
    let currentLedger = previousLedger;

    for (const record of records) {
      const txLedger = Number(record.ledger || 0);

      if (currentLedger > 0 && txLedger > currentLedger + 1) {
        for (let gap = currentLedger + 1; gap < txLedger; gap++) {
          missingLedgers.push(gap);
        }
      }

      currentLedger = Math.max(currentLedger, txLedger);
    }

    return {
      hasGap: missingLedgers.length > 0,
      missingLedgers,
    };
  }

  /**
   * Indexes a collection of Horizon transaction records into SQLite
   */
  async indexTransactions(records) {
    if (!records || records.length === 0) return 0;

    await this.ensureSchema();
    const db = await this.getDb();
    const now = new Date().toISOString();
    let indexedCount = 0;

    for (const tx of records) {
      const hash = tx.hash || tx.id;
      const ledger = Number(tx.ledger || 0);
      const createdAt = tx.created_at || now;
      const sourceAccount = tx.source_account || null;
      const feeCharged = Number(tx.fee_charged || 0);
      const operationCount = Number(tx.operation_count || 0);
      const pagingToken = tx.paging_token || String(tx.ledger);
      const successful = tx.successful === false ? 0 : 1;
      const memo = tx.memo || null;
      const envelopeXdr = tx.envelope_xdr || null;
      const resultXdr = tx.result_xdr || null;

      await db.run(
        `
          INSERT INTO horizon_transactions_index (
            id, transaction_hash, ledger, created_at, source_account,
            fee_charged, operation_count, paging_token, successful,
            memo, envelope_xdr, result_xdr, indexed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(transaction_hash) DO UPDATE SET
            ledger = excluded.ledger,
            created_at = excluded.created_at,
            fee_charged = excluded.fee_charged,
            operation_count = excluded.operation_count,
            paging_token = excluded.paging_token,
            successful = excluded.successful,
            indexed_at = excluded.indexed_at
        `,
        [
          hash,
          hash,
          ledger,
          createdAt,
          sourceAccount,
          feeCharged,
          operationCount,
          pagingToken,
          successful,
          memo,
          envelopeXdr,
          resultXdr,
          now,
        ]
      );

      indexedCount++;
    }

    return indexedCount;
  }

  /**
   * Ingests the next batch of transactions from Horizon
   */
  async ingestNextBatch({ limit = 50 } = {}) {
    await this.ensureSchema();
    const cursorObj = await this.readCursor();
    const currentCursor = cursorObj.cursor === 'now' ? null : cursorObj.cursor;

    try {
      const records = await this.fetchTransactions({
        cursor: currentCursor,
        limit,
        order: 'asc',
      });

      if (records.length === 0) {
        return { ingestedCount: 0, cursor: currentCursor, hasGap: false };
      }

      const gapInfo = this.detectGaps(records, this.lastLedger);
      if (gapInfo.hasGap) {
        this.logger.warn?.(
          `Horizon ingestion gap detected! Missing ledgers: ${gapInfo.missingLedgers.join(', ')}`
        );
      }

      const indexedCount = await this.indexTransactions(records);
      const lastRecord = records[records.length - 1];
      const newCursor = lastRecord.paging_token || currentCursor;
      const newLedger = Number(lastRecord.ledger || this.lastLedger);

      await this.saveCursor(newCursor, newLedger, gapInfo.hasGap ? 'gap_detected' : 'synced');

      this.status.lastIngestedAt = new Date().toISOString();
      this.status.totalIngested += indexedCount;
      this.status.consecutiveErrors = 0;
      this.status.lastError = null;

      return {
        ingestedCount: indexedCount,
        cursor: newCursor,
        hasGap: gapInfo.hasGap,
        missingLedgers: gapInfo.missingLedgers,
      };
    } catch (err) {
      this.status.consecutiveErrors++;
      this.status.lastError = err.message;
      this.logger.error?.(`Horizon ingestion batch failed: ${err.message}`);
      throw err;
    }
  }

  /**
   * Retrieves an indexed transaction by its hash
   */
  async getTransactionByHash(hash) {
    await this.ensureSchema();
    const db = await this.getDb();
    const tx = await db.get(
      'SELECT * FROM horizon_transactions_index WHERE transaction_hash = ?',
      [hash]
    );
    return tx || null;
  }

  /**
   * Retrieves indexed transactions for a given source account
   */
  async getTransactionsByAccount(account, limit = 20) {
    await this.ensureSchema();
    const db = await this.getDb();
    const rows = await db.all(
      'SELECT * FROM horizon_transactions_index WHERE source_account = ? ORDER BY ledger DESC LIMIT ?',
      [account, limit]
    );
    return rows || [];
  }

  /**
   * Returns current health and ingestion status metrics
   */
  getIngestionStatus() {
    return {
      ...this.status,
      horizonUrls: this.horizonUrls,
      pollIntervalMs: this.pollIntervalMs,
    };
  }

  /**
   * Runs a single synchronization step
   */
  async synchronizeOnce() {
    return this.ingestNextBatch();
  }

  /**
   * Starts periodic polling loop
   */
  start({ intervalMs = this.pollIntervalMs } = {}) {
    if (this.timer) return this.timer;
    this.status.running = true;

    const poll = () => {
      this.synchronizeOnce().catch((err) => {
        this.logger.error?.(`Horizon polling cycle error: ${err.message}`);
      });
    };

    poll();
    this.timer = setInterval(poll, intervalMs);
    if (this.timer.unref) this.timer.unref();

    return this.timer;
  }

  /**
   * Stops periodic polling loop
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.status.running = false;
  }
}

export default HorizonService;
