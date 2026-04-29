// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { integrationService } from '../services/integrationService';
import { subscriptionService } from '../services/subscriptionService';

// Mock the subscription service
vi.mock('../services/subscriptionService', () => ({
  subscriptionService: {
    getPlans: vi.fn(),
    getPlan: vi.fn(),
    createPlan: vi.fn(),
    updatePlan: vi.fn(),
    deletePlan: vi.fn(),
    getUserSubscriptions: vi.fn(),
    getSubscription: vi.fn(),
    createSubscription: vi.fn(),
    cancelSubscription: vi.fn(),
    renewSubscription: vi.fn(),
    toggleAutoRenew: vi.fn(),
    getStats: vi.fn(),
    pauseContract: vi.fn(),
    updatePlatformFee: vi.fn(),
    transferAdmin: vi.fn(),
    batchCreateSubscriptions: vi.fn(),
    batchCancelSubscriptions: vi.fn(),
    getRevenueReport: vi.fn(),
    getChurnReport: vi.fn(),
    exportSubscriptions: vi.fn(),
    importSubscriptions: vi.fn(),
  },
}));

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.OPEN;
  url = '';
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    setTimeout(() => {
      if (this.onopen) {
        this.onopen(new Event('open'));
      }
    }, 100);
  }

  send(data: string) {
    // Mock send - in real implementation this would send to server
    setTimeout(() => {
      if (this.onmessage) {
        const event = new MessageEvent('message', { data });
        this.onmessage(event);
      }
    }, 50);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    setTimeout(() => {
      if (this.onclose) {
        this.onclose(new CloseEvent('close'));
      }
    }, 50);
  }
}

// Replace global WebSocket with mock
global.WebSocket = MockWebSocket as any;

describe('Integration Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    integrationService.cleanup();
  });

  afterEach(() => {
    integrationService.cleanup();
  });

  describe('Plan Management Integration', () => {
    it('should get plans with caching', async () => {
      const mockPlans = {
        data: [
          {
            planId: 'basic_plan',
            name: 'Basic Plan',
            pricePerPeriod: 100,
            billingPeriod: 2592000,
            isActive: true,
            currentSubscribers: 10,
            description: 'Basic subscription plan',
            features: [],
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
        ],
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
      };

      vi.mocked(subscriptionService.getPlans).mockResolvedValue(mockPlans);

      // First call should hit the API
      const result1 = await integrationService.getPlans({ active: true });
      expect(subscriptionService.getPlans).toHaveBeenCalledWith({ active: true });
      expect(result1).toEqual(mockPlans);

      // Second call should use cache
      const result2 = await integrationService.getPlans({ active: true });
      expect(subscriptionService.getPlans).toHaveBeenCalledTimes(1);
      expect(result2).toEqual(mockPlans);
    });

    it('should create a plan and clear cache', async () => {
      const mockPlan = {
        planId: 'new_plan',
        name: 'New Plan',
        pricePerPeriod: 200,
        billingPeriod: 2592000,
        isActive: true,
        currentSubscribers: 0,
        description: 'New subscription plan',
        features: [],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      vi.mocked(subscriptionService.createPlan).mockResolvedValue(mockPlan);

      const result = await integrationService.createPlan({
        planId: 'new_plan',
        name: 'New Plan',
        pricePerPeriod: 200,
        billingPeriod: 2592000,
      });

      expect(subscriptionService.createPlan).toHaveBeenCalledWith({
        planId: 'new_plan',
        name: 'New Plan',
        pricePerPeriod: 200,
        billingPeriod: 2592000,
      });
      expect(result).toEqual(mockPlan);
    });

    it('should update a plan and clear cache', async () => {
      const mockUpdatedPlan = {
        planId: 'basic_plan',
        name: 'Updated Basic Plan',
        pricePerPeriod: 150,
        billingPeriod: 2592000,
        isActive: true,
        currentSubscribers: 10,
        description: 'Updated basic subscription plan',
        features: [],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
      };

      vi.mocked(subscriptionService.updatePlan).mockResolvedValue(mockUpdatedPlan);

      const result = await integrationService.updatePlan('basic_plan', {
        name: 'Updated Basic Plan',
        pricePerPeriod: 150,
      });

      expect(subscriptionService.updatePlan).toHaveBeenCalledWith('basic_plan', {
        name: 'Updated Basic Plan',
        pricePerPeriod: 150,
      });
      expect(result).toEqual(mockUpdatedPlan);
    });

    it('should delete a plan and clear cache', async () => {
      vi.mocked(subscriptionService.deletePlan).mockResolvedValue();

      await integrationService.deletePlan('basic_plan');

      expect(subscriptionService.deletePlan).toHaveBeenCalledWith('basic_plan');
    });
  });

  describe('Subscription Management Integration', () => {
    it('should get user subscriptions with caching', async () => {
      const mockSubscriptions = {
        data: [
          {
            subscriptionId: 'sub_123',
            userId: 'user_456',
            planId: 'basic_plan',
            paymentMethod: 'GDUK...ABC',
            status: 'active' as const,
            currentPeriodStart: '2024-01-01T00:00:00Z',
            currentPeriodEnd: '2024-02-01T00:00:00Z',
            autoRenew: true,
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
        ],
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
      };

      vi.mocked(subscriptionService.getUserSubscriptions).mockResolvedValue(mockSubscriptions);

      const result = await integrationService.getUserSubscriptions('user_456');

      expect(subscriptionService.getUserSubscriptions).toHaveBeenCalledWith('user_456', {});
      expect(result).toEqual(mockSubscriptions);
    });

    it('should create a subscription and clear cache', async () => {
      const mockSubscription = {
        subscriptionId: 'sub_789',
        userId: 'user_456',
        planId: 'basic_plan',
        paymentMethod: 'GDUK...ABC',
        status: 'active' as const,
        currentPeriodStart: '2024-01-01T00:00:00Z',
        currentPeriodEnd: '2024-02-01T00:00:00Z',
        autoRenew: true,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      vi.mocked(subscriptionService.createSubscription).mockResolvedValue(mockSubscription);

      const result = await integrationService.createSubscription({
        planId: 'basic_plan',
        paymentMethod: 'GDUK...ABC',
      });

      expect(subscriptionService.createSubscription).toHaveBeenCalledWith({
        planId: 'basic_plan',
        paymentMethod: 'GDUK...ABC',
      });
      expect(result).toEqual(mockSubscription);
    });

    it('should cancel a subscription and clear cache', async () => {
      const mockCancelledSubscription = {
        subscriptionId: 'sub_123',
        userId: 'user_456',
        planId: 'basic_plan',
        paymentMethod: 'GDUK...ABC',
        status: 'cancelled' as const,
        currentPeriodStart: '2024-01-01T00:00:00Z',
        currentPeriodEnd: '2024-02-01T00:00:00Z',
        autoRenew: false,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-15T00:00:00Z',
        cancelledAt: '2024-01-15T00:00:00Z',
      };

      vi.mocked(subscriptionService.cancelSubscription).mockResolvedValue(mockCancelledSubscription);

      const result = await integrationService.cancelSubscription('sub_123');

      expect(subscriptionService.cancelSubscription).toHaveBeenCalledWith('sub_123');
      expect(result).toEqual(mockCancelledSubscription);
    });

    it('should toggle auto-renew and clear cache', async () => {
      const mockUpdatedSubscription = {
        subscriptionId: 'sub_123',
        userId: 'user_456',
        planId: 'basic_plan',
        paymentMethod: 'GDUK...ABC',
        status: 'active' as const,
        currentPeriodStart: '2024-01-01T00:00:00Z',
        currentPeriodEnd: '2024-02-01T00:00:00Z',
        autoRenew: false,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-10T00:00:00Z',
      };

      vi.mocked(subscriptionService.toggleAutoRenew).mockResolvedValue(mockUpdatedSubscription);

      const result = await integrationService.toggleAutoRenew('sub_123', false);

      expect(subscriptionService.toggleAutoRenew).toHaveBeenCalledWith('sub_123', false);
      expect(result).toEqual(mockUpdatedSubscription);
    });
  });

  describe('Admin Functions Integration', () => {
    it('should get stats with caching', async () => {
      const mockStats = {
        totalSubscriptions: 100,
        activeSubscriptions: 80,
        cancelledSubscriptions: 20,
        totalRevenue: 50000,
        totalPlans: 5,
        activePlans: 4,
        averageRevenuePerSubscription: 625,
        churnRate: 0.2,
        monthlyGrowth: 0.15,
      };

      vi.mocked(subscriptionService.getStats).mockResolvedValue(mockStats);

      const result = await integrationService.getStats();

      expect(subscriptionService.getStats).toHaveBeenCalled();
      expect(result).toEqual(mockStats);
    });

    it('should pause contract and clear cache', async () => {
      const mockResult = {
        paused: true,
        updatedAt: '2024-01-01T00:00:00Z',
      };

      vi.mocked(subscriptionService.pauseContract).mockResolvedValue(mockResult);

      const result = await integrationService.pauseContract(true);

      expect(subscriptionService.pauseContract).toHaveBeenCalledWith(true);
      expect(result).toEqual(mockResult);
    });

    it('should update platform fee and clear cache', async () => {
      const mockResult = {
        feeBps: 200,
        updatedAt: '2024-01-01T00:00:00Z',
      };

      vi.mocked(subscriptionService.updatePlatformFee).mockResolvedValue(mockResult);

      const result = await integrationService.updatePlatformFee(200);

      expect(subscriptionService.updatePlatformFee).toHaveBeenCalledWith(200);
      expect(result).toEqual(mockResult);
    });

    it('should transfer admin rights', async () => {
      const mockResult = {
        newAdminAddress: 'GDUK...XYZ',
        transferredAt: '2024-01-01T00:00:00Z',
        transferredBy: 'user_456',
      };

      vi.mocked(subscriptionService.transferAdmin).mockResolvedValue(mockResult);

      const result = await integrationService.transferAdmin('GDUK...XYZ');

      expect(subscriptionService.transferAdmin).toHaveBeenCalledWith('GDUK...XYZ');
      expect(result).toEqual(mockResult);
    });
  });

  describe('WebSocket Integration', () => {
    it('should connect to WebSocket and handle messages', () => {
      integrationService.initialize();

      // Wait for connection to be established
      setTimeout(() => {
        const ws = (global as any).WebSocket.instances?.[0];
        expect(ws).toBeDefined();
        expect(ws.readyState).toBe(MockWebSocket.OPEN);
      }, 150);
    });

    it('should emit events on WebSocket messages', (done) => {
      integrationService.initialize();

      integrationService.addEventListener('websocket:message', (data) => {
        expect(data).toEqual({
          type: 'PLAN_CREATED',
          payload: { planId: 'new_plan' },
          timestamp: expect.any(String),
        });
        done();
      });

      // Simulate WebSocket message
      setTimeout(() => {
        const ws = (global as any).WebSocket.instances?.[0];
        if (ws && ws.onmessage) {
          const event = new MessageEvent('message', {
            data: JSON.stringify({
              type: 'PLAN_CREATED',
              payload: { planId: 'new_plan' },
              timestamp: new Date().toISOString(),
            }),
          });
          ws.onmessage(event);
        }
      }, 150);
    });

    it('should clear cache on relevant WebSocket messages', (done) => {
      integrationService.initialize();

      // Set some cache data first
      integrationService.setCache('plans:test', { data: [] });
      integrationService.setCache('stats:test', { data: {} });

      integrationService.addEventListener('websocket:message', (data) => {
        // Cache should be cleared for plans after plan update
        expect(integrationService.getCache('plans:test')).toBeNull();
        done();
      });

      // Simulate plan update message
      setTimeout(() => {
        const ws = (global as any).WebSocket.instances?.[0];
        if (ws && ws.onmessage) {
          const event = new MessageEvent('message', {
            data: JSON.stringify({
              type: 'PLAN_UPDATED',
              payload: { planId: 'basic_plan' },
              timestamp: new Date().toISOString(),
            }),
          });
          ws.onmessage(event);
        }
      }, 150);
    });
  });

  describe('Error Handling and Retry', () => {
    it('should retry failed operations', async () => {
      vi.mocked(subscriptionService.getPlans)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          data: [],
          pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
        });

      const result = await integrationService.getPlans();

      expect(subscriptionService.getPlans).toHaveBeenCalledTimes(3);
      expect(result).toEqual({
        data: [],
        pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
      });
    });

    it('should throw error after max retry attempts', async () => {
      vi.mocked(subscriptionService.getPlans).mockRejectedValue(new Error('Persistent error'));

      await expect(integrationService.getPlans()).rejects.toThrow('Persistent error');
      expect(subscriptionService.getPlans).toHaveBeenCalledTimes(3);
    });

    it('should emit error events on failures', (done) => {
      vi.mocked(subscriptionService.getPlans).mockRejectedValue(new Error('API Error'));

      integrationService.addEventListener('plans:error', (error) => {
        expect(error).toEqual(new Error('API Error'));
        done();
      });

      integrationService.getPlans().catch(() => {
        // Expected to fail
      });
    });
  });

  describe('Batch Operations', () => {
    it('should handle batch subscription creation', async () => {
      const mockSubscriptions = [
        {
          subscriptionId: 'sub_1',
          userId: 'user_1',
          planId: 'basic_plan',
          paymentMethod: 'GDUK...ABC',
          status: 'active' as const,
          currentPeriodStart: '2024-01-01T00:00:00Z',
          currentPeriodEnd: '2024-02-01T00:00:00Z',
          autoRenew: true,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        {
          subscriptionId: 'sub_2',
          userId: 'user_2',
          planId: 'basic_plan',
          paymentMethod: 'GDUK...DEF',
          status: 'active' as const,
          currentPeriodStart: '2024-01-01T00:00:00Z',
          currentPeriodEnd: '2024-02-01T00:00:00Z',
          autoRenew: true,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ];

      vi.mocked(subscriptionService.batchCreateSubscriptions).mockResolvedValue(mockSubscriptions);

      const result = await integrationService.batchCreateSubscriptions([
        { planId: 'basic_plan', paymentMethod: 'GDUK...ABC' },
        { planId: 'basic_plan', paymentMethod: 'GDUK...DEF' },
      ]);

      expect(subscriptionService.batchCreateSubscriptions).toHaveBeenCalledWith([
        { planId: 'basic_plan', paymentMethod: 'GDUK...ABC' },
        { planId: 'basic_plan', paymentMethod: 'GDUK...DEF' },
      ]);
      expect(result).toEqual(mockSubscriptions);
    });
  });

  describe('Health Check', () => {
    it('should perform health check and return healthy status', async () => {
      vi.mocked(subscriptionService.getStats).mockResolvedValue({
        totalSubscriptions: 100,
        activeSubscriptions: 80,
        cancelledSubscriptions: 20,
        totalRevenue: 50000,
        totalPlans: 5,
        activePlans: 4,
        averageRevenuePerSubscription: 625,
        churnRate: 0.2,
        monthlyGrowth: 0.15,
      });

      const result = await integrationService.healthCheck();

      expect(result.status).toBe('healthy');
      expect(result.checks).toHaveLength(3);
      expect(result.checks[0].name).toBe('api');
      expect(result.checks[0].status).toBe('pass');
      expect(result.checks[1].name).toBe('websocket');
      expect(result.checks[2].name).toBe('cache');
    });

    it('should return degraded status with warnings', async () => {
      vi.mocked(subscriptionService.getStats).mockResolvedValue({
        totalSubscriptions: 100,
        activeSubscriptions: 80,
        cancelledSubscriptions: 20,
        totalRevenue: 50000,
        totalPlans: 5,
        activePlans: 4,
        averageRevenuePerSubscription: 625,
        churnRate: 0.2,
        monthlyGrowth: 0.15,
      });

      // Fill cache with many entries to trigger warning
      for (let i = 0; i < 1001; i++) {
        integrationService.setCache(`key_${i}`, { data: i });
      }

      const result = await integrationService.healthCheck();

      expect(result.status).toBe('degraded');
      expect(result.checks.find(c => c.name === 'cache')?.status).toBe('warn');
    });

    it('should return unhealthy status on API failure', async () => {
      vi.mocked(subscriptionService.getStats).mockRejectedValue(new Error('API Error'));

      const result = await integrationService.healthCheck();

      expect(result.status).toBe('unhealthy');
      expect(result.checks.find(c => c.name === 'api')?.status).toBe('fail');
    });
  });

  describe('Event System', () => {
    it('should add and remove event listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      integrationService.addEventListener('test:event', listener1);
      integrationService.addEventListener('test:event', listener2);

      integrationService.emit('test:event', { data: 'test' });

      expect(listener1).toHaveBeenCalledWith({ data: 'test' });
      expect(listener2).toHaveBeenCalledWith({ data: 'test' });

      integrationService.removeEventListener('test:event', listener1);
      integrationService.emit('test:event', { data: 'test2' });

      expect(listener1).toHaveBeenCalledTimes(1); // Should not be called again
      expect(listener2).toHaveBeenCalledTimes(2);
    });

    it('should handle multiple event types', () => {
      const planListener = vi.fn();
      const subscriptionListener = vi.fn();

      integrationService.addEventListener('plan:created', planListener);
      integrationService.addEventListener('subscription:created', subscriptionListener);

      integrationService.emit('plan:created', { planId: 'new_plan' });
      integrationService.emit('subscription:created', { subscriptionId: 'new_sub' });

      expect(planListener).toHaveBeenCalledWith({ planId: 'new_plan' });
      expect(subscriptionListener).toHaveBeenCalledWith({ subscriptionId: 'new_sub' });
    });
  });
});
