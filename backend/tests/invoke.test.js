import { jest } from '@jest/globals';

jest.unstable_mockModule('../src/services/invokeService.js', () => ({
  invokeSorobanContract: jest.fn(),
}));

const { invokeSorobanContract } = await import('../src/services/invokeService.js');

import express from 'express';
import request from 'supertest';
const { default: invokeRoute } = await import('../src/routes/v1/invoke.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');

const app = express();
app.use(express.json());
app.use('/api/invoke', invokeRoute);
app.use(errorHandler);

const VALID_CONTRACT_ID =
  'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

describe('POST /api/invoke', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns parsed CLI output on success', async () => {
    invokeSorobanContract.mockResolvedValue({
      contractId: VALID_CONTRACT_ID,
      functionName: 'hello',
      parsed: { value: 'hello' },
      stdout: '{"value":"hello"}',
      stderr: '',
      endedAt: '2026-04-22T00:00:00.000Z',
    });

    const res = await request(app)
      .post('/api/invoke')
      .send({
        contractId: VALID_CONTRACT_ID,
        functionName: 'hello',
        args: { name: 'Alice' },
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.output).toEqual({ value: 'hello' });
    expect(invokeSorobanContract).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: VALID_CONTRACT_ID,
        functionName: 'hello',
        args: { name: 'Alice' },
      }),
      expect.any(Object)
    );
  });

  it('returns 400 when contractId is invalid', async () => {
    const res = await request(app).post('/api/invoke').send({
      contractId: 'bad',
      functionName: 'hello',
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Validation failed');
    expect(res.body.details).toContain(
      'contractId must be a valid Stellar contract ID'
    );
  });

  it('returns 400 when functionName is invalid', async () => {
    const res = await request(app).post('/api/invoke').send({
      contractId: VALID_CONTRACT_ID,
      functionName: '1bad',
    });

    expect(res.status).toBe(400);
    expect(res.body.details).toContain(
      'functionName must be a valid identifier'
    );
  });

  it('returns 502 when the CLI layer fails', async () => {
    invokeSorobanContract.mockRejectedValue(new Error('invalid contract'));

    const res = await request(app).post('/api/invoke').send({
      contractId: VALID_CONTRACT_ID,
      functionName: 'hello',
    });

    expect(res.status).toBe(502);
    expect(res.body.message).toBe('Invocation failed');
    expect(res.body.details.join(' ')).toMatch(/invalid contract/);
  });
});
