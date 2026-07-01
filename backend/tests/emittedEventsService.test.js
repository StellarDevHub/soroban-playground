import {
  listEmittedEvents,
  parseEmittedEventsQuery,
} from '../src/services/emittedEventsService.js';

describe('emittedEventsService', () => {
  it('parses and normalizes query params safely', () => {
    const parsed = parseEmittedEventsQuery({
      contract_id: '  CABC123  ',
      event_type: 'transfer',
      start_ledger: '100',
      end_ledger: '200',
      limit: '999',
      cursor: '88',
    });

    expect(parsed).toEqual({
      contractId: 'CABC123',
      eventType: 'transfer',
      startLedger: 100,
      endLedger: 200,
      cursor: 88,
      limit: 200,
    });
  });

  it('returns mapped frontend events and page info', async () => {
    const db = {
      all: jest.fn().mockResolvedValue([
        {
          id: 17,
          contract_id: 'CABC123',
          ledger_sequence: 321,
          topics: '["transfer"]',
          value: '{"amount":42}',
          raw_xdr: 'xdr-1',
          event_type: 'transfer',
          indexed_at: '2026-06-29T12:00:00.000Z',
        },
      ]),
    };

    const result = await listEmittedEvents({ limit: '1' }, db);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      type: 'event',
      id: '17',
      contract_id: 'CABC123',
      ledger: 321,
      event_type: 'transfer',
      data: '{"amount":42}',
    });
    expect(result.pageInfo).toEqual({
      nextCursor: '17',
      hasMore: true,
    });
    expect(db.all).toHaveBeenCalledWith(expect.stringContaining('FROM contract_events'), [
      1,
    ]);
  });

  it('returns empty results when events table is missing', async () => {
    const db = {
      all: jest
        .fn()
        .mockRejectedValue(new Error('SQLITE_ERROR: no such table: contract_events')),
    };

    const result = await listEmittedEvents({}, db);
    expect(result.events).toEqual([]);
    expect(result.pageInfo.hasMore).toBe(false);
  });

  it('rejects invalid ledger range', async () => {
    await expect(
      listEmittedEvents(
        {
          start_ledger: '50',
          end_ledger: '10',
        },
        { all: jest.fn() }
      )
    ).rejects.toThrow('start_ledger must be less than or equal to end_ledger');
  });
});
