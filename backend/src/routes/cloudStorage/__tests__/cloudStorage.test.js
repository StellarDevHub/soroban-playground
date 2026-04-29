// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import request from 'supertest';
import express from 'express';
import cloudStorageRouter from '../index.js';
import * as cloudStorageService from '../services/cloudStorageService.js';
import { createHttpError } from '../../middleware/errorHandler.js';

// Mock the service
jest.mock('../services/cloudStorageService.js');

const mockService = cloudStorageService as jest.Mocked<typeof cloudStorageService>;

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/cloud-storage', cloudStorageRouter);
  // Error handler must be after routes for error propagation
  app.use((err, _req, res, _next) => {
    const status = err.statusCode || 500;
    res.status(status).json({
      success: false,
      message: err.message,
      details: err.details,
    });
  });
  return app;
}

describe('Cloud Storage Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /files', () => {
    it('should upload file successfully', async () => {
      mockService.uploadFile.mockResolvedValue({
        owner: 'G123',
        file_id: 'Cabc',
        total_size: 1024,
        shard_count: 1,
        redundancy_factor: 1,
        shards: [],
        created_at: Date.now(),
        is_paused: false,
      });

      const app = createTestApp();
      const res = await request(app)
        .post('/api/cloud-storage/files')
        .send({
          fileId: 'Cabc',
          totalSize: 1024,
          shardHashes: ['shardhash1'],
          redundancyFactor: 1,
          owner: 'G123',
        })
        .set('x-source-account', 'GXYZ');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(mockService.uploadFile).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: 'Cabc',
          totalSize: 1024,
          shardHashes: ['shardhash1'],
          redundancyFactor: 1,
          owner: 'G123',
        })
      );
    });

    it('should return 400 for missing fields', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/cloud-storage/files')
        .send({})
        .set('x-source-account', 'GXYZ');

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Validation failed');
    });

    it('should return error when service fails', async () => {
      mockService.uploadFile.mockRejectedValue(
        createHttpError(423, 'Contract is paused')
      );

      const app = createTestApp();
      const res = await request(app)
        .post('/api/cloud-storage/files')
        .send({
          fileId: 'Cabc',
          totalSize: 1024,
          shardHashes: ['shardhash1'],
          redundancyFactor: 1,
        })
        .set('x-source-account', 'GXYZ');

      expect(res.status).toBe(423);
      expect(res.body.message).toBe('Contract is paused');
    });
  });

  describe('GET /files/:fileId', () => {
    it('should retrieve file metadata', async () => {
      const mockMeta = {
        owner: 'G123',
        file_id: 'Cabc',
        total_size: 1024,
        shard_count: 1,
        redundancy_factor: 1,
        shards: [],
        created_at: Date.now(),
        is_paused: false,
      };
      mockService.getFile.mockResolvedValue(mockMeta);

      const app = createTestApp();
      const res = await request(app).get('/api/cloud-storage/files/Cabc');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockMeta);
    });

    it('should return 404 when file not found', async () => {
      mockService.getFile.mockRejectedValue(
        createHttpError(404, 'Resource not found')
      );

      const app = createTestApp();
      const res = await request(app).get('/api/cloud-storage/files/Cnone');

      expect(res.status).toBe(404);
    });

    it('should return 400 for invalid fileId format', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/cloud-storage/files/invalid');

      expect(res.status).toBe(400);
      expect(res.body.details).toContain('fileId must be a valid contract ID');
    });
  });

  describe('DELETE /files/:fileId', () => {
    it('should delete file', async () => {
      mockService.deleteFile.mockResolvedValue({});

      const app = createTestApp();
      const res = await request(app)
        .delete('/api/cloud-storage/files/Cabc')
        .set('x-caller-address', 'G123');

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('File deleted');
    });

    it('should require caller header', async () => {
      const app = createTestApp();
      const res = await request(app).delete('/api/cloud-storage/files/Cabc');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Caller address required');
    });
  });

  describe('POST /nodes', () => {
    it('should register node', async () => {
      mockService.registerNode.mockResolvedValue({});

      const app = createTestApp();
      const res = await request(app)
        .post('/api/cloud-storage/nodes')
        .send({ nodeAddress: 'GNode123', capacityBytes: 1_048_576 })
        .set('x-network', 'testnet');

      expect(res.status).toBe(201);
      expect(mockService.registerNode).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeAddress: 'GNode123',
          capacityBytes: 1_048_576,
        })
      );
    });

    it('should reject invalid capacity', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/cloud-storage/nodes')
        .send({ nodeAddress: 'GNode123', capacityBytes: 0 });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /nodes/:nodeAddress/files', () => {
    it('should list node files', async () => {
      mockService.getNodeFiles.mockResolvedValue(['Cfile1', 'Cfile2']);

      const app = createTestApp();
      const res = await request(app).get('/api/cloud-storage/nodes/GNode123/files');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(['Cfile1', 'Cfile2']);
    });

    it('should reject invalid node address', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/cloud-storage/nodes/invalid/files');

      expect(res.status).toBe(400);
    });
  });

  describe('POST /files/:fileId/rebalance', () => {
    it('should trigger rebalance', async () => {
      mockService.rebalanceShards.mockResolvedValue({});

      const app = createTestApp();
      const res = await request(app)
        .post('/api/cloud-storage/files/Cabc/rebalance')
        .set('x-caller-address', 'GAdmin');

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Rebalance completed');
    });

    it('should require caller address', async () => {
      const app = createTestApp();
      const res = await request(app).post('/api/cloud-storage/files/Cabc/rebalance');

      expect(res.status).toBe(400);
    });
  });

  describe('GET /health', () => {
    it('should return health status', async () => {
      mockService.health.mockResolvedValue({ status: 'ok', contractId: 'C12345', network: 'testnet' });

      const app = createTestApp();
      const res = await request(app).get('/api/cloud-storage/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });
});
