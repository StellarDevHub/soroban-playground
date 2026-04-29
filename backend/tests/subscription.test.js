import request from 'supertest';
import app from '../src/server.js';
import { subscriptionService } from '../src/services/subscriptionService.js';

describe('Subscription API', () => {
  beforeAll(async () => {
    await subscriptionService.createPlan('Basic', '100 XLM', 2592000, ['Feature 1', 'Feature 2']);
    await subscriptionService.createPlan('Pro', '500 XLM', 2592000, ['All Basic', 'Feature 3']);
  });

  describe('GET /api/subscriptions/plans', () => {
    it('should return all active plans', async () => {
      const response = await request(app)
        .get('/api/subscriptions/plans')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body[0]).toHaveProperty('name');
      expect(response.body[0]).toHaveProperty('price');
    });
  });

  describe('POST /api/subscriptions/subscribe', () => {
    it('should create a new subscription', async () => {
      const response = await request(app)
        .post('/api/subscriptions/subscribe')
        .send({ plan_id: 1, auto_renew: true })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('subscription_id');
    });

    it('should fail without plan_id', async () => {
      const response = await request(app)
        .post('/api/subscriptions/subscribe')
        .send({ auto_renew: true })
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('GET /api/subscriptions/me', () => {
    it('should return user subscription', async () => {
      await request(app)
        .post('/api/subscriptions/subscribe')
        .send({ plan_id: 1, auto_renew: true });

      const response = await request(app)
        .get('/api/subscriptions/me')
        .expect(200);

      expect(response.body).toHaveProperty('plan_id');
      expect(response.body).toHaveProperty('active');
    });
  });

  describe('POST /api/subscriptions/usage', () => {
    it('should record usage metrics', async () => {
      const response = await request(app)
        .post('/api/subscriptions/usage')
        .send({ api_calls: 100, storage: 500, bandwidth: 1000 })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
    });
  });

  describe('POST /api/subscriptions/renew', () => {
    it('should renew subscription', async () => {
      await request(app)
        .post('/api/subscriptions/subscribe')
        .send({ plan_id: 1, auto_renew: true });

      const response = await request(app)
        .post('/api/subscriptions/renew')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
    });
  });

  describe('POST /api/subscriptions/cancel', () => {
    it('should cancel subscription', async () => {
      await request(app)
        .post('/api/subscriptions/subscribe')
        .send({ plan_id: 1, auto_renew: true });

      const response = await request(app)
        .post('/api/subscriptions/cancel')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
    });
  });
});
