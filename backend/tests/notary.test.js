import { jest } from '@jest/globals';

jest.unstable_mockModule('../src/services/notaryService.js', () => ({
  notarizeFile: jest.fn(),
  verifyFile: jest.fn(),
  revokeNotarization: jest.fn(),
  listNotarizations: jest.fn(),
}));

const { notarizeFile, verifyFile, revokeNotarization, listNotarizations } =
  await import('../src/services/notaryService.js');

import express from 'express';
import request from 'supertest';
const { default: notaryRoute } = await import('../src/routes/notary.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');

const app = express();
app.use(express.json());
app.use('/api/notary', notaryRoute);
app.use(errorHandler);

const VALID_HASH = 'a'.repeat(64);

describe('POST /api/notary/notarize', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 201 with recordId on success', async () => {
    notarizeFile.mockResolvedValue({ recordId: 1234567890, timestamp: 1234567890 });

    const res = await request(app)
      .post('/api/notary/notarize')
      .send({ fileHash: VALID_HASH, metadata: 'my document' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.recordId).toBe(1234567890);
    expect(notarizeFile).toHaveBeenCalledWith(VALID_HASH, 'my document', 'anonymous');
  });

  it('returns 400 when fileHash is missing', async () => {
    const res = await request(app)
      .post('/api/notary/notarize')
      .send({ metadata: 'doc' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Validation failed');
  });

  it('returns 400 when fileHash is not 64-char hex', async () => {
    const res = await request(app)
      .post('/api/notary/notarize')
      .send({ fileHash: 'not-a-hash', metadata: 'doc' });

    expect(res.status).toBe(400);
    expect(res.body.details).toContain('fileHash must be a 64-character hex string');
  });

  it('returns 400 when metadata is missing', async () => {
    const res = await request(app)
      .post('/api/notary/notarize')
      .send({ fileHash: VALID_HASH });

    expect(res.status).toBe(400);
    expect(res.body.details).toContain('metadata is required and must be a string');
  });

  it('returns 400 when metadata exceeds 500 chars', async () => {
    const res = await request(app)
      .post('/api/notary/notarize')
      .send({ fileHash: VALID_HASH, metadata: 'x'.repeat(501) });

    expect(res.status).toBe(400);
    expect(res.body.details).toContain('metadata must not exceed 500 characters');
  });

  it('propagates service errors', async () => {
    const err = new Error('File already notarized');
    err.statusCode = 409;
    notarizeFile.mockRejectedValue(err);

    const res = await request(app)
      .post('/api/notary/notarize')
      .send({ fileHash: VALID_HASH, metadata: 'doc' });

    expect(res.status).toBe(409);
  });
});

describe('GET /api/notary/verify/:fileHash', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns correct record', async () => {
    const record = {
      fileHash: VALID_HASH,
      owner: 'GABC',
      timestamp: 1000,
      metadata: 'doc',
      verified: true,
      recordId: 1000,
    };
    verifyFile.mockResolvedValue(record);

    const res = await request(app).get(`/api/notary/verify/${VALID_HASH}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject(record);
  });

  it('returns 400 for invalid fileHash', async () => {
    const res = await request(app).get('/api/notary/verify/badhash');
    expect(res.status).toBe(400);
  });

  it('returns 404 when file not found', async () => {
    const err = new Error('File not found');
    err.statusCode = 404;
    verifyFile.mockRejectedValue(err);

    const res = await request(app).get(`/api/notary/verify/${VALID_HASH}`);
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/notary/revoke/:fileHash', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 200 on success', async () => {
    revokeNotarization.mockResolvedValue(undefined);

    const res = await request(app)
      .delete(`/api/notary/revoke/${VALID_HASH}`)
      .send({ callerAddress: 'GABC' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 400 when callerAddress is missing', async () => {
    const res = await request(app)
      .delete(`/api/notary/revoke/${VALID_HASH}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 403 when caller is not owner', async () => {
    const err = new Error('Unauthorized');
    err.statusCode = 403;
    revokeNotarization.mockRejectedValue(err);

    const res = await request(app)
      .delete(`/api/notary/revoke/${VALID_HASH}`)
      .send({ callerAddress: 'GWRONG' });

    expect(res.status).toBe(403);
  });
});

describe('GET /api/notary/history', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns paginated list', async () => {
    listNotarizations.mockResolvedValue({
      records: [{ fileHash: VALID_HASH, owner: 'G1', timestamp: 1, metadata: 'm', verified: true, recordId: 1 }],
      total: 1,
      page: 1,
      limit: 20,
    });

    const res = await request(app).get('/api/notary/history');

    expect(res.status).toBe(200);
    expect(res.body.data.records).toHaveLength(1);
    expect(res.body.data.total).toBe(1);
  });

  it('passes page and limit query params', async () => {
    listNotarizations.mockResolvedValue({ records: [], total: 0, page: 2, limit: 5 });

    await request(app).get('/api/notary/history?page=2&limit=5');

    expect(listNotarizations).toHaveBeenCalledWith(2, 5);
  });
});

describe('Rate limiting', () => {
  it('returns 429 after 10 requests from same IP', async () => {
    notarizeFile.mockResolvedValue({ recordId: 1, timestamp: 1 });

    // Make 10 successful requests
    for (let i = 0; i < 10; i++) {
      await request(app)
        .post('/api/notary/notarize')
        .send({ fileHash: VALID_HASH, metadata: 'doc' });
    }

    // 11th should be rate-limited
    const res = await request(app)
      .post('/api/notary/notarize')
      .send({ fileHash: VALID_HASH, metadata: 'doc' });

    expect(res.status).toBe(429);
  });
});
