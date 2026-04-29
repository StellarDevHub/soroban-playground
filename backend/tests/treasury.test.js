import request from 'supertest';
import app from '../src/server.js';
import { treasuryService } from '../src/services/treasuryService.js';

describe('Treasury API', () => {
  describe('GET /api/treasury/info', () => {
    it('should return treasury information', async () => {
      const response = await request(app)
        .get('/api/treasury/info')
        .expect(200);

      expect(response.body).toHaveProperty('total_balance');
      expect(response.body).toHaveProperty('total_proposals');
      expect(response.body).toHaveProperty('executed_proposals');
      expect(response.body).toHaveProperty('pending_proposals');
    });
  });

  describe('POST /api/treasury/proposals', () => {
    it('should create a new proposal', async () => {
      const response = await request(app)
        .post('/api/treasury/proposals')
        .send({
          recipient: 'GTEST123',
          amount: '1000',
          description: 'Test proposal',
          duration: 86400,
        })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('proposal_id');
    });

    it('should fail without required fields', async () => {
      const response = await request(app)
        .post('/api/treasury/proposals')
        .send({
          recipient: 'GTEST123',
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('GET /api/treasury/proposals', () => {
    it('should return all proposals', async () => {
      const response = await request(app)
        .get('/api/treasury/proposals')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('POST /api/treasury/proposals/:id/sign', () => {
    it('should sign a proposal', async () => {
      const createResponse = await request(app)
        .post('/api/treasury/proposals')
        .send({
          recipient: 'GTEST123',
          amount: '1000',
          description: 'Test proposal',
          duration: 86400,
        });

      const proposalId = createResponse.body.proposal_id;

      const response = await request(app)
        .post(`/api/treasury/proposals/${proposalId}/sign`)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
    });
  });

  describe('GET /api/treasury/signers', () => {
    it('should return list of signers', async () => {
      const response = await request(app)
        .get('/api/treasury/signers')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('GET /api/treasury/threshold', () => {
    it('should return threshold value', async () => {
      const response = await request(app)
        .get('/api/treasury/threshold')
        .expect(200);

      expect(typeof response.body).toBe('number');
    });
  });

  describe('POST /api/treasury/deposit', () => {
    it('should accept deposits', async () => {
      const response = await request(app)
        .post('/api/treasury/deposit')
        .send({
          token: 'XLM',
          amount: '500',
        })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
    });

    it('should fail without required fields', async () => {
      const response = await request(app)
        .post('/api/treasury/deposit')
        .send({
          token: 'XLM',
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });
  });
});
