import { jest } from '@jest/globals';

jest.unstable_mockModule('../src/services/deployService.js', () => ({
  deployBatchContracts: jest.fn(),
}));

const { deployBatchContracts } = await import('../src/services/deployService.js');

import express from 'express';
import request from 'supertest';
const { default: deployRoute } = await import('../src/routes/v1/deploy.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');
const {
  normalizeBatchContract,
  topoSortContracts,
  validateBatchContractsInput,
} = await import('../src/services/deployUtils.js');

const app = express();
app.use(express.json());
app.use('/api/deploy', deployRoute);
app.use(errorHandler);

describe('deploy batch service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('topologically sorts dependencies', () => {
    const ordered = topoSortContracts([
      { id: 'a', dependencies: [] },
      { id: 'b', dependencies: ['a'] },
      { id: 'c', dependencies: ['b'] },
    ]);

    expect(ordered.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('rejects circular dependencies', () => {
    expect(() =>
      topoSortContracts([
        { id: 'a', dependencies: ['b'] },
        { id: 'b', dependencies: ['a'] },
      ])
    ).toThrow(/Circular dependency/);
  });

  it('validates a batch request payload', () => {
    expect(() =>
      validateBatchContractsInput([
        { contractName: 'one', wasmPath: 'one.wasm' },
      ])
    ).not.toThrow();
    expect(
      normalizeBatchContract(
        { contractName: 'one', wasmPath: 'one.wasm' },
        0,
        'testnet'
      )
    ).toMatchObject({ contractName: 'one', wasmPath: 'one.wasm' });
  });

  it('returns batch deployment payload from the route', async () => {
    deployBatchContracts.mockResolvedValue({
      success: true,
      status: 'success',
      batchId: 'batch-1',
      contracts: [{ id: 'one', contractName: 'one', contractId: 'C1' }],
      startedAt: '2026-04-22T00:00:00.000Z',
      completedAt: '2026-04-22T00:00:01.000Z',
    });

    const res = await request(app)
      .post('/api/deploy/batch')
      .send({
        contracts: [{ id: 'one', contractName: 'one', wasmPath: 'one.wasm' }],
      });

    expect(res.status).toBe(200);
    expect(res.body.batchId).toBe('batch-1');
    expect(deployBatchContracts).toHaveBeenCalled();
  });

  it('returns 400 when contracts are missing', async () => {
    const res = await request(app).post('/api/deploy/batch').send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Validation failed');
  });
});
