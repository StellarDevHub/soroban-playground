import express from 'express';
import request from 'supertest';
import eventsRouter from '../src/routes/events.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import eventSchemaService from '../src/services/eventSchemaService.js';

const app = express();
app.use(express.json());
app.use('/api/events', eventsRouter);
app.use(errorHandler);

const v1PaymentEvent = {
  eventType: 'pifp.payment',
  schemaVersion: '1.0.0',
  payload: {
    paymentId: 'pay-1',
    payer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    payee: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    amount: 42,
    asset: 'XLM',
    createdAt: '2026-04-25T12:00:00.000Z',
    status: 'settled',
  },
};

describe('event schema validation and versioning', () => {
  beforeEach(() => {
    eventSchemaService.resetForTests();
  });

  it('validates events and quarantines schema violations on ingest', async () => {
    const res = await request(app)
      .post('/api/events/ingest')
      .send({
        eventType: 'pifp.payment',
        schemaVersion: '2.0.0',
        payload: {
          paymentId: 'pay-2',
          sourceAccount: v1PaymentEvent.payload.payer,
          destinationAccount: v1PaymentEvent.payload.payee,
          asset: 'XLM',
          network: 'testnet',
          createdAt: '2026-04-25T12:00:00.000Z',
          status: 'settled',
        },
      });

    expect(res.status).toBe(422);
    expect(res.body.data.accepted).toBe(false);
    expect(res.body.data.quarantined).toBe(true);
    expect(res.body.data.validation.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'payload.amount' }),
      ])
    );
    expect(res.body.data.quarantineItem.id).toMatch(/^q-/);
  });

  it('migrates legacy v1 payment events to the latest schema', async () => {
    const res = await request(app)
      .post('/api/events/records/migrate')
      .send({ event: v1PaymentEvent, targetVersion: '2.0.0' });

    expect(res.status).toBe(200);
    expect(res.body.data.migrated).toBe(true);
    expect(res.body.data.migrationPath).toEqual(['1.0.0', '2.0.0']);
    expect(res.body.data.event.payload).toMatchObject({
      sourceAccount: v1PaymentEvent.payload.payer,
      destinationAccount: v1PaymentEvent.payload.payee,
      network: 'testnet',
    });
    expect(res.body.data.event.payload.payer).toBeUndefined();
  });

  it('rejects breaking schema registrations by default', async () => {
    const res = await request(app)
      .post('/api/events/schemas')
      .send({
        eventType: 'pifp.payment',
        version: '3.0.0',
        fields: {
          paymentId: { type: 'string', required: true },
        },
        additionalProperties: false,
      });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Schema evolution rejected');
    expect(res.body.details.errors.length).toBeGreaterThan(0);
  });

  it('allows compatible schema evolution with optional fields', async () => {
    await request(app)
      .post('/api/events/schemas')
      .send({
        eventType: 'demo.lifecycle',
        version: '1.0.0',
        fields: {
          id: { type: 'string', required: true },
          status: { type: 'string', required: true },
        },
      })
      .expect(201);

    const res = await request(app)
      .post('/api/events/schemas')
      .send({
        eventType: 'demo.lifecycle',
        version: '1.1.0',
        fields: {
          id: { type: 'string', required: true },
          status: { type: 'string', required: true },
          reason: { type: 'string', required: false },
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.data.evolution.compatible).toBe(true);
    expect(res.body.data.evolution.compatibleChanges).toContain(
      'Added optional field "reason"'
    );
  });

  it('detects schema drift from observed events', async () => {
    const res = await request(app)
      .post('/api/events/schemas/detect')
      .send({
        eventType: 'pifp.payment',
        schemaVersion: '2.0.0',
        payload: {
          paymentId: 'pay-3',
          sourceAccount: v1PaymentEvent.payload.payer,
          destinationAccount: v1PaymentEvent.payload.payee,
          amount: '42',
          asset: 'XLM',
          network: 'testnet',
          createdAt: '2026-04-25T12:00:00.000Z',
          status: 'settled',
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.data.compatible).toBe(false);
    expect(res.body.data.changes.typeChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'amount',
          expected: 'number',
          detected: 'string',
        }),
      ])
    );
  });
});
