import express from 'express';
import request from 'supertest';

import notaryRoute from '../../src/routes/notary.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import { resetNotaryServiceForTests } from '../../src/services/notaryService.js';

const app = express();
app.use(express.json());
app.use('/api/notary', notaryRoute);
app.use(errorHandler);

describe('File Storage Service (Notary)', () => {
  beforeEach(() => {
    // Reset the notary service for clean state before each test
    if (typeof resetNotaryServiceForTests === 'function') {
      resetNotaryServiceForTests();
    }
  });

  it('rejects notarization with invalid file hash format', async () => {
    const res = await request(app)
      .post('/api/notary/notarize')
      .send({ fileHash: 'invalid', metadata: 'test' });
    expect(res.status).toBe(400);
  });

  it('accepts valid notarization request and returns 201 status', async () => {
    const res = await request(app)
      .post('/api/notary/notarize')
      .send({ 
        fileHash: 'a'.repeat(64), 
        metadata: 'test metadata', 
        callerAddress: 'GABC123...' 
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('recordId');
    expect(res.body.data).toHaveProperty('timestamp');
  });

  it('returns 404 for unknown file hash in verify endpoint', async () => {
    const res = await request(app).get('/api/notary/verify/invalidhash');
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid file hash format in verify endpoint', async () => {
    const res = await request(app).get('/api/notary/verify/short');
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown file hash in revoke endpoint', async () => {
    const res = await request(app)
      .delete('/api/notary/revoke/invalidhash')
      .send({ callerAddress: 'GABC123...' });
    expect(res.status).toBe(404);
  });

  it('returns 400 for missing callerAddress in revoke endpoint', async () => {
    const res = await request(app)
      .delete('/api/notary/revoke/' + 'a'.repeat(64))
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns list of notarizations with GET /history', async () => {
    const res = await request(app).get('/api/notary/history');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('records');
    expect(res.body.data).toHaveProperty('total');
    expect(res.body.data).toHaveProperty('page');
    expect(res.body.data).toHaveProperty('limit');
  });
});
