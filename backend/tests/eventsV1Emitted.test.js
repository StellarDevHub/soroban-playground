import { jest } from '@jest/globals';

jest.unstable_mockModule('../src/services/emittedEventsService.js', () => ({
  listEmittedEvents: jest.fn(),
}));

const { listEmittedEvents } = await import(
  '../src/services/emittedEventsService.js'
);

import express from 'express';
import request from 'supertest';
const { default: eventsRouter } = await import('../src/routes/v1/events.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');

const app = express();
app.use(express.json());
app.use('/api/v1/events', eventsRouter);
app.use(errorHandler);

describe('GET /api/v1/events/emitted', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns emitted events payload for frontend consumers', async () => {
    listEmittedEvents.mockResolvedValue({
      events: [
        {
          type: 'event',
          id: '9',
          contract_id: 'CABC123',
          ledger: 222,
          ledger_closed_at: '2026-06-29T12:00:00.000Z',
          event_type: 'transfer',
          data: '{"amount":10}',
        },
      ],
      pageInfo: { nextCursor: null, hasMore: false },
      filters: {
        contractId: 'CABC123',
        eventType: undefined,
        startLedger: undefined,
        endLedger: undefined,
        cursor: undefined,
        limit: 50,
      },
    });

    const res = await request(app)
      .get('/api/v1/events/emitted')
      .query({ contract_id: 'CABC123' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].contract_id).toBe('CABC123');
    expect(listEmittedEvents).toHaveBeenCalledWith(
      expect.objectContaining({ contract_id: 'CABC123' })
    );
  });

  it('keeps backward-compatible alias at GET /api/v1/events', async () => {
    listEmittedEvents.mockResolvedValue({
      events: [],
      pageInfo: { nextCursor: null, hasMore: false },
      filters: {
        contractId: undefined,
        eventType: undefined,
        startLedger: undefined,
        endLedger: undefined,
        cursor: undefined,
        limit: 50,
      },
    });

    const res = await request(app).get('/api/v1/events');
    expect(res.status).toBe(200);
    expect(res.body.events).toEqual([]);
  });

  it('returns 400 for invalid request query', async () => {
    listEmittedEvents.mockRejectedValue(new Error('limit must be an integer'));

    const res = await request(app).get('/api/v1/events/emitted').query({
      limit: 'invalid',
    });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      message: 'limit must be an integer',
      statusCode: 400,
    });
  });
});
