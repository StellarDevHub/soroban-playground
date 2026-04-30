import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// Mock the services BEFORE importing setupGraphQL
jest.unstable_mockModule('../src/services/compileService.js', () => ({
  getCompileStats: jest.fn(),
  getCompileSnapshot: jest.fn(),
}));

jest.unstable_mockModule('../src/services/deployService.js', () => ({
  getDeploymentState: jest.fn(),
}));

// Now import the things we want to test
const { setupGraphQL } = await import('../src/graphql/index.js');
const { getCompileStats, getCompileSnapshot } = await import('../src/services/compileService.js');
const { getDeploymentState } = await import('../src/services/deployService.js');

describe('GraphQL API Layer', () => {
  let app;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    await setupGraphQL(app);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('queries compileStats', async () => {
    getCompileStats.mockReturnValue({
      activeWorkers: 2,
      maxWorkers: 4,
      queueLength: 0,
      artifacts: 10,
      cacheHitRate: 80,
    });

    const query = `
      query {
        compileStats {
          activeWorkers
          maxWorkers
          artifactsCount
          cacheHitRate
        }
      }
    `;

    const res = await request(app)
      .post('/graphql')
      .send({ query });

    expect(res.status).toBe(200);
    expect(res.body.data.compileStats).toEqual({
      activeWorkers: 2,
      maxWorkers: 4,
      artifactsCount: 10,
      cacheHitRate: 80,
    });
  });

  it('queries compileHistory and uses DataLoader for artifacts', async () => {
    const mockArtifacts = [
      { hash: 'hash1', sizeBytes: 100, path: '/path/1' },
      { hash: 'hash2', sizeBytes: 200, path: '/path/2' },
    ];
    
    getCompileSnapshot.mockResolvedValue({
      history: [
        { requestId: 'req1', hash: 'hash1', timestamp: '2026-01-01' },
        { requestId: 'req2', hash: 'hash2', timestamp: '2026-01-02' },
        { requestId: 'req3', hash: 'hash1', timestamp: '2026-01-03' }, // Duplicate hash to test batching
      ],
      artifacts: mockArtifacts,
    });

    const query = `
      query {
        compileHistory {
          requestId
          hash
          artifact {
            hash
            sizeBytes
          }
        }
      }
    `;

    const res = await request(app)
      .post('/graphql')
      .send({ query });
    
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    const history = res.body.data.compileHistory;
    expect(history).toHaveLength(3);
    expect(history[0].artifact.hash).toBe('hash1');
    expect(history[1].artifact.hash).toBe('hash2');
    expect(history[2].artifact.hash).toBe('hash1');
    
    // Verify getCompileSnapshot was called
    expect(getCompileSnapshot).toHaveBeenCalled();
  });

  it('queries deployments and links to artifacts by path', async () => {
    getDeploymentState.mockReturnValue({
      history: [
        { 
          deploymentId: 'dep1', 
          contracts: [{ id: 'c1', wasmPath: '/path/1' }] 
        }
      ]
    });

    getCompileSnapshot.mockResolvedValue({
      artifacts: [
        { hash: 'hash1', sizeBytes: 100, path: '/path/1' }
      ]
    });

    const query = `
      query {
        deployments {
          deploymentId
          contracts {
            id
            artifact {
              hash
            }
          }
        }
      }
    `;

    const res = await request(app)
      .post('/graphql')
      .send({ query });

    expect(res.status).toBe(200);
    expect(res.body.data.deployments[0].contracts[0].artifact.hash).toBe('hash1');
  });
});
