import { LedgerSyncService } from '../src/services/ledgerSyncService.js';

function makeDb(cursor) {
  return {
    exec: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(cursor),
    run: jest.fn().mockResolvedValue(undefined),
  };
}

function makeFetch(sequence) {
  return jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ _embedded: { records: [{ sequence }] } }),
  });
}

describe('LedgerSyncService', () => {
  it('repairs local drift by advancing the cursor to the remote sequence', async () => {
    const db = makeDb({ local_sequence: 40 });
    const service = new LedgerSyncService({
      db,
      fetchImpl: makeFetch(42),
      logger: { warn: jest.fn(), error: jest.fn() },
    });

    const result = await service.synchronizeOnce();

    expect(result).toEqual({
      localSequence: 42,
      remoteSequence: 42,
      drift: 0,
      status: 'repaired',
    });
    expect(db.run).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT'),
      [42, 42, 0, 'repaired', expect.any(String)]
    );
  });

  it('fails over to the next ledger endpoint', async () => {
    const db = makeDb({ local_sequence: 1 });
    const fetchImpl = jest
      .fn()
      .mockRejectedValueOnce(new Error('primary down'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sequence: 3 }),
      });
    const service = new LedgerSyncService({
      db,
      fetchImpl,
      logger: { warn: jest.fn(), error: jest.fn() },
    });

    const sequence = await service.fetchRemoteSequence([
      'https://a',
      'https://b',
    ]);

    expect(sequence).toBe(3);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
