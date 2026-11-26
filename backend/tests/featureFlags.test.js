import { jest } from '@jest/globals';

jest.mock('../src/services/redisService.js', () => ({
  __esModule: true,
  default: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    delete: jest.fn().mockResolvedValue(1),
    isFallbackMode: true,
    client: null,
  },
}));

jest.mock('../src/database/connection.js', () => ({
  __esModule: true,
  getDatabase: jest.fn(),
  initializeDatabase: jest.fn().mockResolvedValue({}),
}));

const { default: redisService } = require('../src/services/redisService.js');
const { getDatabase } = require('../src/database/connection.js');

// Create a fresh service for each test suite
let featureFlagService;

const mockDb = {
  all: jest.fn(),
  get: jest.fn(),
  run: jest.fn().mockResolvedValue({ changes: 1 }),
};

function makeFlag(overrides = {}) {
  return {
    id: 1,
    key: 'test-flag',
    enabled: 1,
    rollout_pct: 100,
    description: 'test',
    environment: null,
    segments: '[]',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...overrides,
  };
}

function makeCohort(overrides = {}) {
  return {
    id: 1,
    flag_key: 'test-flag',
    cohort_id: 'org-123',
    enabled: 1,
    created_at: '2026-01-01',
    ...overrides,
  };
}

describe('featureFlagService.evaluate', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    redisService.get.mockResolvedValue(null);
    redisService.isFallbackMode = true;
    redisService.client = null;
    getDatabase.mockReturnValue(mockDb);
    // Re-import to get a fresh instance
    const mod = require(
      '../src/services/featureFlagService.js?bust=' + Math.random()
    );
    featureFlagService = mod.featureFlagService ?? mod.default;
  });

  it('returns false for unknown flag', async () => {
    mockDb.all.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    expect(await featureFlagService.evaluate('unknown', {})).toBe(false);
  });

  it('returns false when flag.enabled is 0 (kill switch)', async () => {
    mockDb.all
      .mockResolvedValueOnce([makeFlag({ enabled: 0, rollout_pct: 100 })])
      .mockResolvedValueOnce([]);
    expect(
      await featureFlagService.evaluate('test-flag', { userId: 'u1' })
    ).toBe(false);
  });

  it('returns true when enabled=1 and rollout_pct=100', async () => {
    mockDb.all
      .mockResolvedValueOnce([makeFlag({ enabled: 1, rollout_pct: 100 })])
      .mockResolvedValueOnce([]);
    expect(
      await featureFlagService.evaluate('test-flag', { userId: 'u1' })
    ).toBe(true);
  });

  it('uses cohort override (enabled=1) over rollout', async () => {
    mockDb.all
      .mockResolvedValueOnce([makeFlag({ enabled: 1, rollout_pct: 0 })])
      .mockResolvedValueOnce([
        makeCohort({ cohort_id: 'org-123', enabled: 1 }),
      ]);
    expect(
      await featureFlagService.evaluate('test-flag', { cohortId: 'org-123' })
    ).toBe(true);
  });

  it('uses cohort override (enabled=0) to disable for that cohort', async () => {
    mockDb.all
      .mockResolvedValueOnce([makeFlag({ enabled: 1, rollout_pct: 100 })])
      .mockResolvedValueOnce([
        makeCohort({ cohort_id: 'org-123', enabled: 0 }),
      ]);
    expect(
      await featureFlagService.evaluate('test-flag', { cohortId: 'org-123' })
    ).toBe(false);
  });

  it('is deterministic for same userId and flagKey', async () => {
    const results = new Set();
    for (let i = 0; i < 5; i++) {
      mockDb.all
        .mockResolvedValueOnce([makeFlag({ enabled: 1, rollout_pct: 50 })])
        .mockResolvedValueOnce([]);
      results.add(
        await featureFlagService.evaluate('test-flag', {
          userId: 'stable-user',
        })
      );
    }
    expect(results.size).toBe(1);
  });

  it('returns false when rollout_pct < 100 and no subject', async () => {
    mockDb.all
      .mockResolvedValueOnce([makeFlag({ enabled: 1, rollout_pct: 50 })])
      .mockResolvedValueOnce([]);
    expect(await featureFlagService.evaluate('test-flag', {})).toBe(false);
  });

  it('falls back to publicKey as the rollout subject', async () => {
    mockDb.all
      .mockResolvedValueOnce([makeFlag({ enabled: 1, rollout_pct: 50 })])
      .mockResolvedValueOnce([]);
    const result = await featureFlagService.evaluate('test-flag', {
      publicKey: 'GABC',
    });
    expect(typeof result).toBe('boolean');
  });

  it('enforces environment scoping', async () => {
    mockDb.all
      .mockResolvedValueOnce([
        makeFlag({ enabled: 1, rollout_pct: 100, environment: 'staging' }),
      ])
      .mockResolvedValueOnce([]);
    expect(
      await featureFlagService.evaluate('test-flag', {
        userId: 'u1',
        environment: 'production',
      })
    ).toBe(false);
  });

  it('requires a matching segment when flag declares segments', async () => {
    mockDb.all
      .mockResolvedValueOnce([
        makeFlag({
          enabled: 1,
          rollout_pct: 100,
          segments: JSON.stringify(['beta-testers']),
        }),
      ])
      .mockResolvedValueOnce([]);
    expect(
      await featureFlagService.evaluate('test-flag', {
        userId: 'u1',
        isBetaTester: false,
      })
    ).toBe(false);
  });

  it('grants access to matching network segment', async () => {
    mockDb.all
      .mockResolvedValueOnce([
        makeFlag({
          enabled: 1,
          rollout_pct: 100,
          segments: JSON.stringify(['network:testnet']),
        }),
      ])
      .mockResolvedValueOnce([]);
    expect(
      await featureFlagService.evaluate('test-flag', {
        userId: 'u1',
        network: 'testnet',
      })
    ).toBe(true);
  });
});

describe('featureFlagService HTTP routes', () => {
  let app;

  beforeEach(async () => {
    jest.clearAllMocks();
    redisService.get.mockResolvedValue(null);
    getDatabase.mockReturnValue(mockDb);
    const express = (await import('express')).default;
    const { default: featureFlagsRoute } = await import(
      '../src/routes/featureFlags.js?bust=' + Math.random()
    );
    const { errorHandler } = await import('../src/middleware/errorHandler.js');
    app = express();
    app.use(express.json());
    app.use('/api/feature-flags', featureFlagsRoute);
    app.use(errorHandler);
  });

  it('GET /api/feature-flags returns flags list', async () => {
    const request = require('supertest').default;
    mockDb.all.mockResolvedValue([makeFlag()]);
    const res = await request(app).get('/api/feature-flags');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('POST /api/feature-flags creates a flag', async () => {
    const request = require('supertest').default;
    mockDb.run.mockResolvedValue({ changes: 1 });
    mockDb.get.mockResolvedValue(makeFlag({ key: 'new-flag' }));
    const res = await request(app).post('/api/feature-flags').send({
      key: 'new-flag',
      enabled: 1,
      rollout_pct: 50,
      description: 'test',
    });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('POST /api/feature-flags returns 400 for invalid key', async () => {
    const request = require('supertest').default;
    const res = await request(app)
      .post('/api/feature-flags')
      .send({ key: 'INVALID KEY WITH SPACES', enabled: 1, rollout_pct: 50 });
    expect(res.status).toBe(400);
  });

  it('DELETE /api/feature-flags/:key returns 404 for missing flag', async () => {
    const request = require('supertest').default;
    mockDb.run.mockResolvedValue({ changes: 0 });
    const res = await request(app).delete('/api/feature-flags/no-such-flag');
    expect(res.status).toBe(404);
  });
});
