// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { jest } from '@jest/globals';

// Mock the patent service so tests don't need a live Soroban node
jest.unstable_mockModule('../src/services/patentService.js', () => ({
  filePatent: jest.fn(),
  activatePatent: jest.fn(),
  revokePatent: jest.fn(),
  transferPatent: jest.fn(),
  grantLicense: jest.fn(),
  fileDispute: jest.fn(),
  resolveDispute: jest.fn(),
  pauseContract: jest.fn(),
  unpauseContract: jest.fn(),
  getPatent: jest.fn(),
  getLicense: jest.fn(),
  getDispute: jest.fn(),
  getPatentCount: jest.fn(),
  getLicenseCount: jest.fn(),
  getDisputeCount: jest.fn(),
  getAdmin: jest.fn(),
  getIsPaused: jest.fn(),
}));

const patentService = await import('../src/services/patentService.js');

import express from 'express';
import request from 'supertest';
const { default: patentsRouter } = await import('../src/routes/patents.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');

const app = express();
app.use(express.json());
app.use('/api/patents', patentsRouter);
app.use(errorHandler);

const ok = (output) => ({ output });

beforeEach(() => jest.clearAllMocks());

// ── POST /file ────────────────────────────────────────────────────────────────

describe('POST /api/patents/file', () => {
  it('files a patent and returns output', async () => {
    patentService.filePatent.mockResolvedValue(ok(1));

    const res = await request(app).post('/api/patents/file').send({
      inventor: 'GABC',
      title: 'My Invention',
      description: 'Does something useful',
      expiryDate: 9999999999,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBe(1);
    expect(patentService.filePatent).toHaveBeenCalledWith(
      expect.objectContaining({ inventor: 'GABC', title: 'My Invention' })
    );
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app).post('/api/patents/file').send({ inventor: 'GABC' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Validation failed');
    expect(res.body.details).toContain('title is required');
  });
});

// ── POST /:id/activate ────────────────────────────────────────────────────────

describe('POST /api/patents/:id/activate', () => {
  it('activates a patent', async () => {
    patentService.activatePatent.mockResolvedValue(ok(null));

    const res = await request(app)
      .post('/api/patents/1/activate')
      .send({ admin: 'GADMIN' });

    expect(res.status).toBe(200);
    expect(patentService.activatePatent).toHaveBeenCalledWith({ admin: 'GADMIN', patentId: 1 });
  });

  it('returns 400 for non-numeric ID', async () => {
    const res = await request(app).post('/api/patents/abc/activate').send({ admin: 'GADMIN' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when admin is missing', async () => {
    const res = await request(app).post('/api/patents/1/activate').send({});
    expect(res.status).toBe(400);
    expect(res.body.details).toContain('admin is required');
  });
});

// ── POST /:id/revoke ──────────────────────────────────────────────────────────

describe('POST /api/patents/:id/revoke', () => {
  it('revokes a patent', async () => {
    patentService.revokePatent.mockResolvedValue(ok(null));

    const res = await request(app)
      .post('/api/patents/2/revoke')
      .send({ admin: 'GADMIN' });

    expect(res.status).toBe(200);
    expect(patentService.revokePatent).toHaveBeenCalledWith({ admin: 'GADMIN', patentId: 2 });
  });
});

// ── POST /:id/transfer ────────────────────────────────────────────────────────

describe('POST /api/patents/:id/transfer', () => {
  it('transfers patent ownership', async () => {
    patentService.transferPatent.mockResolvedValue(ok(null));

    const res = await request(app)
      .post('/api/patents/3/transfer')
      .send({ owner: 'GOWNER', newOwner: 'GNEW' });

    expect(res.status).toBe(200);
    expect(patentService.transferPatent).toHaveBeenCalledWith({
      owner: 'GOWNER',
      patentId: 3,
      newOwner: 'GNEW',
    });
  });

  it('returns 400 when newOwner is missing', async () => {
    const res = await request(app)
      .post('/api/patents/3/transfer')
      .send({ owner: 'GOWNER' });
    expect(res.status).toBe(400);
    expect(res.body.details).toContain('newOwner is required');
  });
});

// ── POST /:id/license ─────────────────────────────────────────────────────────

describe('POST /api/patents/:id/license', () => {
  it('grants a license', async () => {
    patentService.grantLicense.mockResolvedValue(ok(1));

    const res = await request(app)
      .post('/api/patents/1/license')
      .send({
        owner: 'GOWNER',
        licensee: 'GLICENSEE',
        licenseType: 'NonExclusive',
        fee: 1000000,
        expiryDate: 9999999999,
      });

    expect(res.status).toBe(200);
    expect(res.body.data).toBe(1);
  });

  it('returns 400 when fee is missing', async () => {
    const res = await request(app)
      .post('/api/patents/1/license')
      .send({ owner: 'GOWNER', licensee: 'GL', licenseType: 'Exclusive', expiryDate: 999 });
    expect(res.status).toBe(400);
    expect(res.body.details).toContain('fee is required');
  });
});

// ── POST /disputes ────────────────────────────────────────────────────────────

describe('POST /api/patents/disputes', () => {
  it('files a dispute', async () => {
    patentService.fileDispute.mockResolvedValue(ok(1));

    const res = await request(app)
      .post('/api/patents/disputes')
      .send({ claimant: 'GCLAIM', patentId: 1, reason: 'Prior art' });

    expect(res.status).toBe(200);
    expect(res.body.data).toBe(1);
  });

  it('returns 400 when reason is missing', async () => {
    const res = await request(app)
      .post('/api/patents/disputes')
      .send({ claimant: 'GCLAIM', patentId: 1 });
    expect(res.status).toBe(400);
  });
});

// ── POST /disputes/:id/resolve ────────────────────────────────────────────────

describe('POST /api/patents/disputes/:id/resolve', () => {
  it('resolves a dispute', async () => {
    patentService.resolveDispute.mockResolvedValue(ok(null));

    const res = await request(app)
      .post('/api/patents/disputes/1/resolve')
      .send({ admin: 'GADMIN', resolution: 'Patent is valid' });

    expect(res.status).toBe(200);
    expect(patentService.resolveDispute).toHaveBeenCalledWith(
      expect.objectContaining({ disputeId: 1, resolution: 'Patent is valid' })
    );
  });
});

// ── POST /pause & /unpause ────────────────────────────────────────────────────

describe('POST /api/patents/pause and /unpause', () => {
  it('pauses the contract', async () => {
    patentService.pauseContract.mockResolvedValue(ok(null));
    const res = await request(app).post('/api/patents/pause').send({ admin: 'GADMIN' });
    expect(res.status).toBe(200);
  });

  it('unpauses the contract', async () => {
    patentService.unpauseContract.mockResolvedValue(ok(null));
    const res = await request(app).post('/api/patents/unpause').send({ admin: 'GADMIN' });
    expect(res.status).toBe(200);
  });
});

// ── GET /stats ────────────────────────────────────────────────────────────────

describe('GET /api/patents/stats', () => {
  it('returns aggregated stats', async () => {
    patentService.getPatentCount.mockResolvedValue(ok(5));
    patentService.getLicenseCount.mockResolvedValue(ok(3));
    patentService.getDisputeCount.mockResolvedValue(ok(1));
    patentService.getIsPaused.mockResolvedValue(ok(false));

    const res = await request(app).get('/api/patents/stats');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      patentCount: 5,
      licenseCount: 3,
      disputeCount: 1,
      paused: false,
    });
  });
});

// ── GET /:id ──────────────────────────────────────────────────────────────────

describe('GET /api/patents/:id', () => {
  it('returns a patent', async () => {
    const patent = { title: 'Test', status: 'Active', owner: 'GOWNER' };
    patentService.getPatent.mockResolvedValue(ok(patent));

    const res = await request(app).get('/api/patents/1');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(patent);
    expect(patentService.getPatent).toHaveBeenCalledWith(1);
  });

  it('returns 400 for invalid ID', async () => {
    const res = await request(app).get('/api/patents/0');
    expect(res.status).toBe(400);
  });
});

// ── GET /licenses/:id ─────────────────────────────────────────────────────────

describe('GET /api/patents/licenses/:id', () => {
  it('returns a license', async () => {
    patentService.getLicense.mockResolvedValue(ok({ fee: 1000 }));
    const res = await request(app).get('/api/patents/licenses/1');
    expect(res.status).toBe(200);
    expect(res.body.data.fee).toBe(1000);
  });
});

// ── GET /disputes/:id ─────────────────────────────────────────────────────────

describe('GET /api/patents/disputes/:id', () => {
  it('returns a dispute', async () => {
    patentService.getDispute.mockResolvedValue(ok({ status: 'Open' }));
    const res = await request(app).get('/api/patents/disputes/1');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('Open');
  });
});

// ── Service error propagation ─────────────────────────────────────────────────

describe('service error propagation', () => {
  it('returns 500 when service throws', async () => {
    patentService.getPatent.mockRejectedValue(new Error('contract error'));
    const res = await request(app).get('/api/patents/1');
    expect(res.status).toBe(500);
  });
});
