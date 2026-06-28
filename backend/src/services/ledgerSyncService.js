const DEFAULT_LEDGER_URLS = [
  'https://horizon-testnet.stellar.org/ledgers?order=desc&limit=1',
  'https://horizon.stellar.org/ledgers?order=desc&limit=1',
];

function parseLedgerUrls(value = process.env.LEDGER_SYNC_URLS) {
  if (!value) return DEFAULT_LEDGER_URLS;
  return value
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
}

function getRemoteSequence(payload) {
  const record = payload?._embedded?.records?.[0] ?? payload;
  const sequence = Number(record?.sequence ?? record?.ledger ?? record?.id);
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new Error('remote ledger response did not include a valid sequence');
  }
  return sequence;
}

export class LedgerSyncService {
  constructor({ db, fetchImpl = globalThis.fetch, logger = console } = {}) {
    this.db = db;
    this.fetchImpl = fetchImpl;
    this.logger = logger;
    this.timer = null;
  }

  async ensureSchema() {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS ledger_sync_cursor (
        id TEXT PRIMARY KEY,
        local_sequence INTEGER NOT NULL DEFAULT 0,
        remote_sequence INTEGER NOT NULL DEFAULT 0,
        drift INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        updated_at TEXT NOT NULL
      );
    `);
  }

  async readCursor() {
    await this.ensureSchema();
    const row = await this.db.get(
      "SELECT * FROM ledger_sync_cursor WHERE id = 'soroban-ledger'"
    );
    return (
      row ?? {
        id: 'soroban-ledger',
        local_sequence: 0,
        remote_sequence: 0,
        drift: 0,
        status: 'pending',
      }
    );
  }

  async fetchRemoteSequence(urls = parseLedgerUrls()) {
    let lastError;
    for (const url of urls) {
      try {
        const response = await this.fetchImpl(url, {
          headers: { accept: 'application/json' },
        });
        if (!response.ok) {
          throw new Error(`ledger endpoint returned ${response.status}`);
        }
        return getRemoteSequence(await response.json());
      } catch (error) {
        lastError = error;
        this.logger.warn?.(
          `Ledger sync endpoint failed: ${url} (${error.message})`
        );
      }
    }
    throw lastError ?? new Error('no ledger sync endpoints configured');
  }

  async synchronizeOnce() {
    await this.ensureSchema();
    const cursor = await this.readCursor();
    const remoteSequence = await this.fetchRemoteSequence();
    const localSequence = Number(cursor.local_sequence ?? 0);
    const drift = remoteSequence - localSequence;
    const nextLocalSequence = drift >= 0 ? remoteSequence : localSequence;
    const status = drift === 0 ? 'synced' : drift > 0 ? 'repaired' : 'ahead';

    await this.db.run(
      `
        INSERT INTO ledger_sync_cursor (
          id, local_sequence, remote_sequence, drift, status, updated_at
        )
        VALUES ('soroban-ledger', ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          local_sequence = excluded.local_sequence,
          remote_sequence = excluded.remote_sequence,
          drift = excluded.drift,
          status = excluded.status,
          updated_at = excluded.updated_at
      `,
      [
        nextLocalSequence,
        remoteSequence,
        remoteSequence - nextLocalSequence,
        status,
        new Date().toISOString(),
      ]
    );

    const warnAt = Number(process.env.LEDGER_SYNC_WARN_DRIFT ?? 10);
    if (Math.abs(drift) >= warnAt) {
      this.logger.warn?.(
        `Ledger sync drift corrected: local=${localSequence} remote=${remoteSequence} drift=${drift}`
      );
    }

    return {
      localSequence: nextLocalSequence,
      remoteSequence,
      drift: remoteSequence - nextLocalSequence,
      status,
    };
  }

  start({
    intervalMs = Number(process.env.LEDGER_SYNC_INTERVAL_MS ?? 60000),
  } = {}) {
    if (this.timer) return this.timer;

    const run = () => {
      this.synchronizeOnce().catch((error) => {
        this.logger.error?.(`Ledger sync failed: ${error.message}`);
      });
    };

    run();
    this.timer = setInterval(run, intervalMs);
    if (this.timer.unref) this.timer.unref();
    return this.timer;
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
