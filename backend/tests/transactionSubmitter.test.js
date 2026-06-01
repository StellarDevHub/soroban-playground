import express from 'express';
import request from 'supertest';

import oracleRoute from '../../src/routes/oracle.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import { resetOracleServiceForTests } from '../../src/services/oracle/oracleService.js';

const app = express();
app.use(express.json());
app.use('/api/oracle', oracleRoute);
app.use(errorHandler);

describe('Transaction Submitter Endpoint', () => {
  beforeEach(() => resetOracleServiceForTests());

  it('rejects proof submission with no payload', async () => {
    const res = await request(app).post('/api/oracle/proofs').send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/payload is required/);
  });

  it('accepts proof submission and returns 202 status for async submission', async () => {
    const res = await request(app)
      .post('/api/oracle/proofs')
      .send({ payload: { price: 99 }, wait: false });
    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data).toHaveProperty('status');
    expect(['submitted', 'pending']).toContain(res.body.data.status);
  });

  it('accepts proof submission and returns 200 status for synchronous submission', async () => {
    const res = await request(app)
      .post('/api/oracle/proofs')
      .send({ payload: { price: 99 }, wait: true });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data).toHaveProperty('status');
    expect(['submitted', 'no_quorum']).toContain(res.body.data.status);
  });

  it('returns 404 for unknown proof id', async () => {
    const res = await request(app).get('/api/oracle/proofs/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('returns list of proofs with GET /proofs', async () => {
    const res = await request(app).get('/api/oracle/proofs');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
