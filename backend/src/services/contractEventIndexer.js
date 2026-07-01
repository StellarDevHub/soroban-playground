import config from '../config/index.js';
import DatabaseService from './databaseService.js';
import { parseEvent, dispatchEvent } from './contractEventParser.js';

const INSERT_EVENT_SQL = `
  INSERT INTO contract_events
    (contract_id, ledger_sequence, topics, value, raw_xdr, event_type)
  VALUES (?, ?, ?, ?, ?, ?)
`;

const LOAD_CURSOR_SQL =
  'SELECT last_ledger FROM contract_event_cursor WHERE id = 1';

const SAVE_CURSOR_SQL = `
  INSERT OR REPLACE INTO contract_event_cursor (id, cursor, last_ledger, updated_at)
  VALUES (1, ?, ?, CURRENT_TIMESTAMP)
`;

class ContractEventIndexer {
  constructor() {
    const { rpcUrl, contractIds, pollIntervalMs } = config.indexer;
    this._rpcUrl = rpcUrl;
    this._contractIds = contractIds;
    this._intervalMs = pollIntervalMs;
    this._db = new DatabaseService();
    this._timer = null;
  }

  async start() {
    await this._db.connect();
    const t = setInterval(
      () =>
        this._poll().catch((e) =>
          console.error('Indexer poll error:', e.message)
        ),
      this._intervalMs
    );
    t.unref();
    this._timer = t;
    // Fire once immediately without awaiting so startup is non-blocking
    this._poll().catch((e) =>
      console.error('Indexer initial poll error:', e.message)
    );
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  async _loadCursor() {
    try {
      const row = await this._db.get(LOAD_CURSOR_SQL);
      return row ? row.last_ledger : 0;
    } catch {
      return 0;
    }
  }

  async _saveCursor(lastLedger) {
    await this._db.run(SAVE_CURSOR_SQL, [String(lastLedger), lastLedger]);
  }

  async _poll() {
    if (!this._contractIds.length) return;

    // Dynamic import defers the SDK load until the first poll
    const { SorobanRpc } = await import('@stellar/stellar-sdk');
    const rpcServer = new SorobanRpc.Server(this._rpcUrl);
    const startLedger = await this._loadCursor();

    const result = await rpcServer.getEvents({
      startLedger,
      filters: [{ type: 'contract', contractIds: this._contractIds }],
      limit: 200,
    });

    const events = result.events ?? [];
    let latestLedger = startLedger;

    for (const raw of events) {
      await this._processEvent(raw).catch((e) =>
        console.error('Event parse error (skipping):', e.message)
      );
      if (raw.ledger > latestLedger) latestLedger = raw.ledger;
    }

    if (latestLedger > startLedger) {
      await this._saveCursor(latestLedger);
    }
  }

  async _processEvent(raw) {
    const parsed = parseEvent(raw);
    await this._db.run(INSERT_EVENT_SQL, [
      parsed.contractId,
      parsed.ledgerSequence,
      JSON.stringify(parsed.topics),
      JSON.stringify(parsed.value),
      parsed.rawXdr,
      parsed.eventType,
    ]);
    dispatchEvent(parsed);
  }
}

export const contractEventIndexer = new ContractEventIndexer();
export default contractEventIndexer;
