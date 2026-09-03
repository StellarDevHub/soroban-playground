import { HorizonService } from '../src/services/horizonService.js';

describe('HorizonService Ingestion Engine', () => {
  let mockDb;
  let mockFetch;
  let service;

  beforeEach(() => {
    mockDb = {
      exec: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue(null),
      all: jest.fn().mockResolvedValue([]),
      run: jest.fn().mockResolvedValue({ lastID: 1, changes: 1 }),
    };

    mockFetch = jest.fn();

    service = new HorizonService({
      db: mockDb,
      horizonUrls: ['https://horizon-testnet.stellar.org'],
      fetchImpl: mockFetch,
      logger: { warn: jest.fn(), error: jest.fn(), log: jest.fn() },
      pollIntervalMs: 5000,
      maxRetries: 2,
    });
  });

  afterEach(() => {
    service.stop();
  });

  describe('schema and cursor management', () => {
    it('creates database schema on ensureSchema()', async () => {
      await service.ensureSchema();
      expect(mockDb.exec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS horizon_transactions_index')
      );
    });

    it('returns default cursor when no cursor row exists', async () => {
      mockDb.get.mockResolvedValueOnce(null);
      const cursor = await service.readCursor();
      expect(cursor.cursor).toBe('now');
      expect(cursor.status).toBe('pending');
    });

    it('saves cursor into database', async () => {
      await service.saveCursor('paging-token-123', 100500, 'synced');
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO horizon_ingestion_cursor'),
        ['paging-token-123', 100500, 'synced', expect.any(String)]
      );
      expect(service.cursor).toBe('paging-token-123');
      expect(service.lastLedger).toBe(100500);
    });
  });

  describe('fetchTransactions and backoff', () => {
    it('fetches transactions successfully', async () => {
      const mockRecords = [{ hash: 'tx123', ledger: 100, paging_token: 'pt123' }];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ _embedded: { records: mockRecords } }),
      });

      const records = await service.fetchTransactions({ cursor: 'pt0' });
      expect(records).toEqual(mockRecords);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('cursor=pt0'),
        expect.any(Object)
      );
    });

    it('retries on HTTP 429 rate limit with backoff', async () => {
      mockFetch
        .mockResolvedValueOnce({ status: 429, ok: false })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            _embedded: { records: [{ hash: 'tx456', ledger: 101, paging_token: 'pt456' }] },
          }),
        });

      const records = await service.fetchTransactions();
      expect(records).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('gap detection', () => {
    it('returns no gap for contiguous ledgers', () => {
      const records = [
        { ledger: 100 },
        { ledger: 101 },
        { ledger: 102 },
      ];
      const gapResult = service.detectGaps(records, 99);
      expect(gapResult.hasGap).toBe(false);
      expect(gapResult.missingLedgers).toEqual([]);
    });

    it('detects missing ledgers and flags gap', () => {
      const records = [
        { ledger: 100 },
        { ledger: 105 },
      ];
      const gapResult = service.detectGaps(records, 99);
      expect(gapResult.hasGap).toBe(true);
      expect(gapResult.missingLedgers).toEqual([101, 102, 103, 104]);
    });
  });

  describe('indexing and queries', () => {
    it('indexes transaction records into database', async () => {
      const records = [
        {
          hash: '0xabc',
          ledger: 500,
          created_at: '2026-08-30T00:00:00Z',
          source_account: 'GABC...',
          fee_charged: 100,
          operation_count: 1,
          paging_token: 'token500',
          successful: true,
        },
      ];

      const count = await service.indexTransactions(records);
      expect(count).toBe(1);
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO horizon_transactions_index'),
        expect.arrayContaining(['0xabc', '0xabc', 500])
      );
    });

    it('queries transaction by hash', async () => {
      const mockTx = { transaction_hash: '0xhash', ledger: 123 };
      mockDb.get.mockResolvedValueOnce(mockTx);

      const result = await service.getTransactionByHash('0xhash');
      expect(result).toEqual(mockTx);
      expect(mockDb.get).toHaveBeenCalledWith(
        expect.stringContaining('WHERE transaction_hash = ?'),
        ['0xhash']
      );
    });

    it('queries transactions by account', async () => {
      const mockTxs = [{ transaction_hash: '0x1', source_account: 'GACC' }];
      mockDb.all.mockResolvedValueOnce(mockTxs);

      const results = await service.getTransactionsByAccount('GACC', 10);
      expect(results).toEqual(mockTxs);
      expect(mockDb.all).toHaveBeenCalledWith(
        expect.stringContaining('WHERE source_account = ?'),
        ['GACC', 10]
      );
    });
  });

  describe('ingestion lifecycle', () => {
    it('runs ingestNextBatch successfully', async () => {
      mockDb.get.mockResolvedValueOnce({ cursor: 'cur1', last_ledger: 99 });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          _embedded: {
            records: [
              { hash: 'tx1', ledger: 100, paging_token: 'cur2', successful: true },
            ],
          },
        }),
      });

      const batchResult = await service.ingestNextBatch();
      expect(batchResult.ingestedCount).toBe(1);
      expect(batchResult.cursor).toBe('cur2');
      expect(service.getIngestionStatus().totalIngested).toBe(1);
    });

    it('starts and stops polling timer cleanly', () => {
      service.start({ intervalMs: 1000 });
      expect(service.status.running).toBe(true);

      service.stop();
      expect(service.status.running).toBe(false);
    });
  });
});
