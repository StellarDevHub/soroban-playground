import { jest } from '@jest/globals';

jest.unstable_mockModule('../src/services/airdropService.js', () => ({
  getAirdropSnapshot: jest.fn(),
  getEligibility: jest.fn(),
  verifyEligibility: jest.fn(),
}));

const { getAirdropSnapshot, getEligibility, verifyEligibility } =
  await import('../src/services/airdropService.js');

import express from 'express';
import request from 'supertest';
const { default: airdropRouter } = await import('../src/routes/airdrop.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');

const app = express();
app.use(express.json());
app.use('/api/airdrop', airdropRouter);
app.use(errorHandler);

const ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

describe('Airdrop API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns airdrop config snapshot', async () => {
    getAirdropSnapshot.mockReturnValue({
      root: 'root',
      count: 2,
      totalAmount: '3750',
      token: { symbol: 'DROP' },
    });

    const res = await request(app).get('/api/airdrop/config');

    expect(res.status).toBe(200);
    expect(res.body.data.root).toBe('root');
    expect(getAirdropSnapshot).toHaveBeenCalled();
  });

  it('rejects invalid eligibility requests', async () => {
    const res = await request(app)
      .post('/api/airdrop/eligibility')
      .send({ address: 'bad' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('address must be a valid Stellar account');
  });

  it('returns eligibility payload for eligible address', async () => {
    getEligibility.mockReturnValue({
      eligible: true,
      address: ADDRESS,
      amount: '100',
      proof: [],
      root: 'root',
      token: null,
    });

    const res = await request(app)
      .post('/api/airdrop/eligibility')
      .send({ address: ADDRESS });

    expect(res.status).toBe(200);
    expect(res.body.data.eligible).toBe(true);
    expect(res.body.data.amount).toBe('100');
  });

  it('verifies claim payloads', async () => {
    getEligibility.mockReturnValue({
      eligible: true,
      address: ADDRESS,
      amount: '100',
      proof: [{ hash: '0'.repeat(64), is_left: false }],
      root: 'root',
      token: null,
    });
    verifyEligibility.mockReturnValue({ valid: true, root: 'root', leaf: 'leaf' });

    const res = await request(app)
      .post('/api/airdrop/claim')
      .send({ address: ADDRESS, amount: '100', proof: [] });

    expect(res.status).toBe(200);
    expect(res.body.data.invoke.functionName).toBe('claim');
    expect(verifyEligibility).toHaveBeenCalled();
  });
});
