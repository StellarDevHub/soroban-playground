// Avoid pulling in the full server (which auto-connects to Redis at
// import time). We mount only the oracle router on a fresh express app.
import express from 'express';
import request from 'supertest';

import oracleRoute from '../../src/routes/oracle.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import { resetOracleServiceForTests } from '../../src/services/oracle/oracleService.js';

const app = express();
app.use(express.json());
app.use('/api/oracle', oracleRoute);
app.use(errorHandler);

describe('oracle HTTP routes', () => {
  beforeEach(() => resetOracleServiceForTests());

  it('rejects a proof submission with no payload', async () => {
    const res = await request(app).post('/api/oracle/proofs').send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/payload is required/);
  });

  it('accepts a proof and returns a proofId', async () => {
    const res = await request(app)
      .post('/api/oracle/proofs')
      .send({ payload: { price: 99 }, wait: true });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toMatch(/[a-f0-9]{16}/);
    expect(['submitted', 'no_quorum']).toContain(res.body.data.status);
  });

  it('GET /proofs/:id returns a stored proof', async () => {
    const submit = await request(app)
      .post('/api/oracle/proofs')
      .send({ payload: { v: 1 }, wait: true });
    const id = submit.body.data.id;
    const res = await request(app).get(`/api/oracle/proofs/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(id);
  });

  it('GET /proofs/:id returns 404 for unknown id', async () => {
    const res = await request(app).get('/api/oracle/proofs/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('GET /nodes returns the node roster', async () => {
    const res = await request(app).get('/api/oracle/nodes');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('GET /health returns service shape', async () => {
    const res = await request(app).get('/api/oracle/health');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('backend');
    expect(res.body.data).toHaveProperty('nodes');
    expect(res.body.data).toHaveProperty('threshold');
  });
});
