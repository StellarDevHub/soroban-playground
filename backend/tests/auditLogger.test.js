import express from 'express';
import request from 'supertest';
import {
  buildAuditEvent,
  createAuditLogger,
  sanitizePayload,
} from '../src/middleware/auditLogger.js';

function waitForAsyncLogger() {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('audit logger middleware', () => {
  it('redacts sensitive request fields recursively', () => {
    expect(
      sanitizePayload({
        username: 'alice',
        password: 'secret',
        nested: { Authorization: 'Bearer abc', visible: true },
      })
    ).toEqual({
      username: 'alice',
      password: '[REDACTED]',
      nested: { Authorization: '[REDACTED]', visible: true },
    });
  });

  it('builds a stable audit event payload', () => {
    const event = buildAuditEvent(
      {
        method: 'POST',
        originalUrl: '/api/invoke',
        headers: { 'x-user-id': 'user-1' },
        params: { id: '1' },
        query: { dryRun: 'true' },
        body: { privateKey: 'sk', amount: 10 },
      },
      201
    );

    expect(event.event_type).toBe('POST_API_INVOKE');
    expect(event.actor).toBe('user-1');
    expect(JSON.parse(event.payload)).toMatchObject({
      path: '/api/invoke',
      method: 'POST',
      body: { privateKey: '[REDACTED]', amount: 10 },
      status: 201,
    });
  });

  it('logs successful state-changing requests to the indexer', async () => {
    const fetchClient = jest.fn().mockResolvedValue({ ok: true });
    const app = express();
    app.use(express.json());
    app.use(
      createAuditLogger({
        fetchClient,
        indexerUrl: 'http://indexer.test/',
        timeoutMs: 50,
      })
    );
    app.post('/contracts', (req, res) => res.status(201).json({ ok: true }));

    await request(app)
      .post('/contracts')
      .send({ token: 'secret', name: 'contract' })
      .expect(201);
    await waitForAsyncLogger();

    expect(fetchClient).toHaveBeenCalledTimes(1);
    const [url, options] = fetchClient.mock.calls[0];
    expect(url).toBe('http://indexer.test/api/audit/log');
    expect(options.method).toBe('POST');
    expect(JSON.parse(JSON.parse(options.body).payload).body).toEqual({
      token: '[REDACTED]',
      name: 'contract',
    });
  });

  it('does not log read-only or failed requests', async () => {
    const fetchClient = jest.fn().mockResolvedValue({ ok: true });
    const app = express();
    app.use(createAuditLogger({ fetchClient }));
    app.get('/contracts', (_req, res) => res.json({ ok: true }));
    app.post('/contracts', (_req, res) => res.status(500).json({ ok: false }));

    await request(app).get('/contracts').expect(200);
    await request(app).post('/contracts').expect(500);
    await waitForAsyncLogger();

    expect(fetchClient).not.toHaveBeenCalled();
  });
});
