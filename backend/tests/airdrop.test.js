// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { jest } from '@jest/globals';

// ESM mocks must be declared before dynamic imports
jest.unstable_mockModule('../src/services/cacheService.js', () => ({
  default: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(true),
    delete: jest.fn().mockResolvedValue(true),
    initialize: jest.fn().mockResolvedValue(true),
  },
}));

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.unstable_mockModule('../src/utils/alerting.js', () => ({
  alertManager: { alert: jest.fn() },
}));

// Dynamic imports after mocks
const { default: express } = await import('express');
const { default: airdropRouter } = await import('../src/routes/airdrop.js');
const { notFoundHandler, errorHandler } = await import('../src/middleware/errorHandler.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/airdrop', airdropRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const { default: request } = await import('supertest');

const NOW = Math.floor(Date.now() / 1000);

const validCampaign = {
  admin: 'GADMIN123456789012345678901234567890123456789012345678',
  token: 'CTOKEN123456789012345678901234567890123456789012345678',
  name: 'Test Airdrop',
  description: 'A test campaign',
  amountPerClaim: 100,
  totalAmount: 10000,
  startTimestamp: NOW,
  endTimestamp: NOW + 86400,
  requireAllowlist: false,
};

describe('POST /api/airdrop/campaigns', () => {
  let app;
  beforeEach(() => { app = buildApp(); });

  it('creates a campaign with valid data', async () => {
    const res = await request(app).post('/api/airdrop/campaigns').send(validCampaign);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      name: 'Test Airdrop',
      status: 'active',
      amountPerClaim: 100,
      totalAmount: 10000,
    });
    expect(res.body.data.id).toBeDefined();
  });

  it('rejects missing admin', async () => {
    const { admin: _a, ...body } = validCampaign;
    const res = await request(app).post('/api/airdrop/campaigns').send(body);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Validation failed');
  });

  it('rejects zero amountPerClaim', async () => {
    const res = await request(app)
      .post('/api/airdrop/campaigns')
      .send({ ...validCampaign, amountPerClaim: 0 });
    expect(res.status).toBe(400);
  });

  it('rejects endTimestamp <= startTimestamp', async () => {
    const res = await request(app)
      .post('/api/airdrop/campaigns')
      .send({ ...validCampaign, endTimestamp: validCampaign.startTimestamp });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/airdrop/campaigns', () => {
  let app;
  beforeEach(() => { app = buildApp(); });

  it('returns campaign list', async () => {
    await request(app).post('/api/airdrop/campaigns').send(validCampaign);
    const res = await request(app).get('/api/airdrop/campaigns');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.items)).toBe(true);
  });

  it('filters by status', async () => {
    const res = await request(app).get('/api/airdrop/campaigns?status=active');
    expect(res.status).toBe(200);
    res.body.data.items.forEach((c) => expect(c.status).toBe('active'));
  });
});

describe('GET /api/airdrop/campaigns/:id', () => {
  let app, campaignId;
  beforeEach(async () => {
    app = buildApp();
    const res = await request(app).post('/api/airdrop/campaigns').send(validCampaign);
    campaignId = res.body.data.id;
  });

  it('returns a campaign by id', async () => {
    const res = await request(app).get(`/api/airdrop/campaigns/${campaignId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(campaignId);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app).get('/api/airdrop/campaigns/99999');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/airdrop/campaigns/:id/stats', () => {
  let app, campaignId;
  beforeEach(async () => {
    app = buildApp();
    const res = await request(app).post('/api/airdrop/campaigns').send(validCampaign);
    campaignId = res.body.data.id;
  });

  it('returns stats', async () => {
    const res = await request(app).get(`/api/airdrop/campaigns/${campaignId}/stats`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      totalAmount: 10000,
      claimedAmount: 0,
      claimCount: 0,
    });
  });
});

describe('POST /api/airdrop/campaigns/:id/claim', () => {
  let app, campaignId;
  beforeEach(async () => {
    app = buildApp();
    const res = await request(app).post('/api/airdrop/campaigns').send(validCampaign);
    campaignId = res.body.data.id;
  });

  it('records a claim', async () => {
    const address = 'GCLAIMER1234567890123456789012345678901234567890123456';
    const res = await request(app)
      .post(`/api/airdrop/campaigns/${campaignId}/claim`)
      .send({ address });
    expect(res.status).toBe(200);
    expect(res.body.data.amount).toBe(100);
  });

  it('rejects double claim', async () => {
    const address = 'GCLAIMER1234567890123456789012345678901234567890123456';
    await request(app).post(`/api/airdrop/campaigns/${campaignId}/claim`).send({ address });
    const res = await request(app)
      .post(`/api/airdrop/campaigns/${campaignId}/claim`)
      .send({ address });
    expect(res.status).toBe(409);
  });

  it('rejects missing address', async () => {
    const res = await request(app)
      .post(`/api/airdrop/campaigns/${campaignId}/claim`)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/airdrop/campaigns/:id/allowlist', () => {
  let app, campaignId;
  beforeEach(async () => {
    app = buildApp();
    const res = await request(app)
      .post('/api/airdrop/campaigns')
      .send({ ...validCampaign, requireAllowlist: true });
    campaignId = res.body.data.id;
  });

  it('adds addresses to allowlist', async () => {
    const addresses = [
      'GADDR1234567890123456789012345678901234567890123456789',
      'GADDR2234567890123456789012345678901234567890123456789',
    ];
    const res = await request(app)
      .post(`/api/airdrop/campaigns/${campaignId}/allowlist`)
      .send({ addresses });
    expect(res.status).toBe(200);
    expect(res.body.data.added).toBe(2);
  });

  it('rejects empty addresses array', async () => {
    const res = await request(app)
      .post(`/api/airdrop/campaigns/${campaignId}/allowlist`)
      .send({ addresses: [] });
    expect(res.status).toBe(400);
  });

  it('rejects more than 200 addresses', async () => {
    const addresses = Array.from({ length: 201 }, (_, i) => `GADDR${String(i).padStart(51, '0')}`);
    const res = await request(app)
      .post(`/api/airdrop/campaigns/${campaignId}/allowlist`)
      .send({ addresses });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/airdrop/campaigns/:id/eligibility/:address', () => {
  let app, campaignId;
  beforeEach(async () => {
    app = buildApp();
    const res = await request(app).post('/api/airdrop/campaigns').send(validCampaign);
    campaignId = res.body.data.id;
  });

  it('returns eligible for open campaign', async () => {
    const res = await request(app).get(
      `/api/airdrop/campaigns/${campaignId}/eligibility/GTEST123456789012345678901234567890123456789012345678`
    );
    expect(res.status).toBe(200);
    expect(res.body.data.eligible).toBe(true);
  });
});

describe('POST /api/airdrop/campaigns/:id/end', () => {
  let app, campaignId;
  beforeEach(async () => {
    app = buildApp();
    const res = await request(app).post('/api/airdrop/campaigns').send(validCampaign);
    campaignId = res.body.data.id;
  });

  it('ends a campaign', async () => {
    const res = await request(app)
      .post(`/api/airdrop/campaigns/${campaignId}/end`)
      .send({ admin: validCampaign.admin });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ended');
  });

  it('rejects unauthorized admin', async () => {
    const res = await request(app)
      .post(`/api/airdrop/campaigns/${campaignId}/end`)
      .send({ admin: 'GWRONGADMIN12345678901234567890123456789012345678901' });
    expect(res.status).toBe(403);
  });
});
