// Tests for /api/token-gated routes
import { jest } from '@jest/globals';

// Mock invokeService before importing the router
const mockInvoke = jest.fn();
jest.unstable_mockModule('../../src/services/invokeService.js', () => ({
  invokeSorobanContract: mockInvoke,
}));

const { default: express } = await import('express');
const { default: router } = await import('../../src/routes/tokenGatedAccess.js');
const { errorHandler } = await import('../../src/middleware/errorHandler.js');

const request = (await import('supertest')).default;

const app = express();
app.use(express.json());
app.use('/token-gated', router);
app.use(errorHandler);

const VALID_CONTRACT = 'C' + 'A'.repeat(55);
const VALID_ADMIN = 'G' + 'A'.repeat(55);
const VALID_USER = 'G' + 'B'.repeat(55);

beforeEach(() => mockInvoke.mockReset());

describe('POST /token-gated/mint', () => {
  it('returns 400 for missing fields', async () => {
    const res = await request(app).post('/token-gated/mint').send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid tier', async () => {
    const res = await request(app).post('/token-gated/mint').send({
      contract_id: VALID_CONTRACT,
      admin: VALID_ADMIN,
      recipient: VALID_USER,
      tier: 'Platinum',
      metadata_uri: 'ipfs://test',
    });
    expect(res.status).toBe(400);
  });

  it('mints successfully', async () => {
    mockInvoke.mockResolvedValue({ parsed: 1 });
    const res = await request(app).post('/token-gated/mint').send({
      contract_id: VALID_CONTRACT,
      admin: VALID_ADMIN,
      recipient: VALID_USER,
      tier: 'Silver',
      metadata_uri: 'ipfs://QmTest',
    });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.token_id).toBe(1);
  });
});

describe('POST /token-gated/check-access', () => {
  it('returns has_access true when contract returns true', async () => {
    mockInvoke.mockResolvedValue({ parsed: true });
    const res = await request(app).post('/token-gated/check-access').send({
      contract_id: VALID_CONTRACT,
      caller: VALID_USER,
      required_tier: 'Bronze',
    });
    expect(res.status).toBe(200);
    expect(res.body.has_access).toBe(true);
  });
});

describe('GET /token-gated/community', () => {
  it('returns community stats', async () => {
    mockInvoke
      .mockResolvedValueOnce({ parsed: 42 })
      .mockResolvedValueOnce({ parsed: false });
    const res = await request(app)
      .get('/token-gated/community')
      .query({ contract_id: VALID_CONTRACT });
    expect(res.status).toBe(200);
    expect(res.body.community.total_members).toBe(42);
    expect(res.body.community.is_paused).toBe(false);
  });

  it('returns 400 for missing contract_id', async () => {
    const res = await request(app).get('/token-gated/community');
    expect(res.status).toBe(400);
  });
});
