import { processSyncBatch, getSyncHistory, getPendingEntries, SYNC_STATUS } from '../src/services/syncService.js';

const mockRun = jest.fn().mockResolvedValue({ lastID: 1, changes: 1 });
const mockGet = jest.fn();
const mockAll = jest.fn().mockResolvedValue([]);

jest.mock('../src/database/connection.js', () => ({
  __esModule: true,
  getDatabase: jest.fn(async () => ({
    run: mockRun,
    get: mockGet,
    all: mockAll,
  })),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue(null);
});

const VALID_ENTRY = {
  table: 'favorites',
  record_id: 'rec-1',
  operation: 'update',
  payload: { favorites: '["tpl-1"]' },
  client_timestamp: '2026-01-01T00:00:00.000Z',
};

describe('processSyncBatch', () => {
  it('returns zeros for an empty batch', async () => {
    const result = await processSyncBatch([]);
    expect(result).toEqual({ applied: 0, skipped: 0, errors: [] });
  });

  it('applies a valid update entry', async () => {
    const result = await processSyncBatch([VALID_ENTRY]);
    expect(result.applied).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('applies a valid insert entry', async () => {
    const entry = { ...VALID_ENTRY, operation: 'insert', record_id: 'rec-2' };
    const result = await processSyncBatch([entry]);
    expect(result.applied).toBe(1);
  });

  it('applies a valid delete entry', async () => {
    const entry = { table: 'favorites', record_id: 'rec-3', operation: 'delete', client_timestamp: '2026-01-01T00:00:00.000Z' };
    const result = await processSyncBatch([entry]);
    expect(result.applied).toBe(1);
  });

  describe('last-write-wins conflict resolution', () => {
    it('skips incoming entry when a newer record already exists', async () => {
      mockGet.mockResolvedValueOnce({ client_timestamp: '2026-06-01T12:00:00.000Z' });
      const olderEntry = { ...VALID_ENTRY, client_timestamp: '2026-01-01T00:00:00.000Z' };
      const result = await processSyncBatch([olderEntry]);
      expect(result.skipped).toBe(1);
      expect(result.applied).toBe(0);
    });

    it('applies incoming entry when it is newer than the stored one', async () => {
      mockGet.mockResolvedValueOnce({ client_timestamp: '2026-01-01T00:00:00.000Z' });
      const newerEntry = { ...VALID_ENTRY, client_timestamp: '2026-06-01T12:00:00.000Z' };
      const result = await processSyncBatch([newerEntry]);
      expect(result.applied).toBe(1);
    });
  });

  describe('validation', () => {
    it('records an error for missing table', async () => {
      const bad = { ...VALID_ENTRY, table: undefined };
      const result = await processSyncBatch([bad]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].reason).toMatch(/table/);
    });

    it('records an error for invalid operation', async () => {
      const bad = { ...VALID_ENTRY, operation: 'truncate' };
      const result = await processSyncBatch([bad]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].reason).toMatch(/operation/i);
    });

    it('records an error for invalid timestamp', async () => {
      const bad = { ...VALID_ENTRY, client_timestamp: 'not-a-date' };
      const result = await processSyncBatch([bad]);
      expect(result.errors).toHaveLength(1);
    });

    it('records an error for non-syncable table', async () => {
      const bad = { ...VALID_ENTRY, table: 'users' };
      const result = await processSyncBatch([bad]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].reason).toMatch(/syncable/i);
    });

    it('records an error for missing payload on update', async () => {
      const bad = { ...VALID_ENTRY, payload: null };
      const result = await processSyncBatch([bad]);
      expect(result.errors).toHaveLength(1);
    });
  });

  describe('batch error reporting', () => {
    it('reports all errors in a mixed batch', async () => {
      const entries = [
        VALID_ENTRY,
        { ...VALID_ENTRY, record_id: 'rec-2', table: undefined },
        { ...VALID_ENTRY, record_id: 'rec-3', operation: 'bad_op' },
      ];
      const result = await processSyncBatch(entries);
      expect(result.applied).toBe(1);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0].index).toBe(1);
      expect(result.errors[1].index).toBe(2);
    });
  });
});

describe('getSyncHistory', () => {
  it('queries sync_logs for the given table and record_id', async () => {
    mockAll.mockResolvedValueOnce([{ id: 1, status: 'applied' }]);
    const history = await getSyncHistory('favorites', 'rec-1');
    expect(mockAll).toHaveBeenCalledWith(
      expect.stringContaining('sync_logs'),
      ['favorites', 'rec-1']
    );
    expect(history).toHaveLength(1);
  });
});

describe('getPendingEntries', () => {
  it('returns all pending sync log entries', async () => {
    mockAll.mockResolvedValueOnce([{ id: 2, status: 'pending' }]);
    const pending = await getPendingEntries();
    expect(mockAll).toHaveBeenCalledWith(expect.stringContaining("status = 'pending'"));
    expect(pending).toHaveLength(1);
  });
});
