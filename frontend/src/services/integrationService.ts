// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { subscriptionService } from './subscriptionService';
import { SubscriptionPlan, UserSubscription, SubscriptionStats } from '@/types/subscription';

// Configuration
const INTEGRATION_CONFIG = {
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000,
  CACHE_DURATION: 5 * 60 * 1000, // 5 minutes
  WEBSOCKET_RECONNECT_ATTEMPTS: 5,
  WEBSOCKET_RECONNECT_DELAY: 5000,
};

// Cache for API responses
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

class IntegrationService {
  private cache = new Map<string, CacheEntry<any>>();
  private eventListeners = new Map<string, Function[]>();
  private wsConnection: WebSocket | null = null;
  private wsReconnectAttempts = 0;

  constructor() {
    this.setupEventListeners();
  }

  // Cache management
  private setCache<T>(key: string, data: T, duration = INTEGRATION_CONFIG.CACHE_DURATION): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      expiresAt: Date.now() + duration,
    });
  }

  private getCache<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  private clearCache(pattern?: string): void {
    if (pattern) {
      const regex = new RegExp(pattern);
      for (const key of this.cache.keys()) {
        if (regex.test(key)) {
          this.cache.delete(key);
        }
      }
    } else {
      this.cache.clear();
    }
  }

  // Event management
  public addEventListener(event: string, callback: Function): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(callback);
  }

  public removeEventListener(event: string, callback: Function): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  private emit(event: string, data: any): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(callback => callback(data));
    }
  }

  // Retry mechanism
  private async retry<T>(
    operation: () => Promise<T>,
    attempts = INTEGRATION_CONFIG.RETRY_ATTEMPTS,
    delay = INTEGRATION_CONFIG.RETRY_DELAY
  ): Promise<T> {
    let lastError: Error;

    for (let i = 0; i < attempts; i++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        
        if (i < attempts - 1) {
          await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
        }
      }
    }

    throw lastError!;
  }

  // WebSocket connection
  private connectWebSocket(): void {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001/ws/subscription';
    
    try {
      this.wsConnection = new WebSocket(wsUrl);
      
      this.wsConnection.onopen = () => {
        console.log('WebSocket connected');
        this.wsReconnectAttempts = 0;
        this.emit('websocket:connected', null);
      };

      this.wsConnection.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleWebSocketMessage(data);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      this.wsConnection.onclose = () => {
        console.log('WebSocket disconnected');
        this.emit('websocket:disconnected', null);
        this.attemptWebSocketReconnect();
      };

      this.wsConnection.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.emit('websocket:error', error);
      };

    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      this.attemptWebSocketReconnect();
    }
  }

  private attemptWebSocketReconnect(): void {
    if (this.wsReconnectAttempts < INTEGRATION_CONFIG.WEBSOCKET_RECONNECT_ATTEMPTS) {
      this.wsReconnectAttempts++;
      console.log(`Attempting WebSocket reconnect (${this.wsReconnectAttempts}/${INTEGRATION_CONFIG.WEBSOCKET_RECONNECT_ATTEMPTS})`);
      
      setTimeout(() => {
        this.connectWebSocket();
      }, INTEGRATION_CONFIG.WEBSOCKET_RECONNECT_DELAY);
    }
  }

  private handleWebSocketMessage(data: any): void {
    switch (data.type) {
      case 'PLAN_CREATED':
      case 'PLAN_UPDATED':
      case 'PLAN_DELETED':
        this.clearCache('plans:*');
        this.emit('plan:updated', data);
        break;

      case 'SUBSCRIPTION_CREATED':
      case 'SUBSCRIPTION_UPDATED':
      case 'SUBSCRIPTION_CANCELLED':
      case 'SUBSCRIPTION_RENEWED':
        this.clearCache('subscriptions:*');
        this.emit('subscription:updated', data);
        break;

      case 'STATS_UPDATED':
        this.clearCache('stats:*');
        this.emit('stats:updated', data);
        break;

      default:
        console.log('Unknown WebSocket message type:', data.type);
    }

    this.emit('websocket:message', data);
  }

  // Plan management with integration
  async getPlans(options: {
    active?: boolean;
    page?: number;
    limit?: number;
    useCache?: boolean;
  } = {}): Promise<{ data: SubscriptionPlan[]; pagination?: any }> {
    const cacheKey = `plans:${JSON.stringify(options)}`;
    
    if (options.useCache !== false) {
      const cached = this.getCache(cacheKey);
      if (cached) return cached;
    }

    try {
      const result = await this.retry(() => subscriptionService.getPlans(options));
      
      this.setCache(cacheKey, result);
      this.emit('plans:loaded', result);
      
      return result;
    } catch (error) {
      this.emit('plans:error', error);
      throw error;
    }
  }

  async getPlan(planId: string, useCache = true): Promise<SubscriptionPlan> {
    const cacheKey = `plan:${planId}`;
    
    if (useCache) {
      const cached = this.getCache(cacheKey);
      if (cached) return cached;
    }

    try {
      const result = await this.retry(() => subscriptionService.getPlan(planId));
      
      this.setCache(cacheKey, result);
      this.emit('plan:loaded', result);
      
      return result;
    } catch (error) {
      this.emit('plan:error', error);
      throw error;
    }
  }

  async createPlan(planData: any): Promise<SubscriptionPlan> {
    try {
      const result = await this.retry(() => subscriptionService.createPlan(planData));
      
      this.clearCache('plans:*');
      this.emit('plan:created', result);
      
      return result;
    } catch (error) {
      this.emit('plan:error', error);
      throw error;
    }
  }

  async updatePlan(planId: string, updates: any): Promise<SubscriptionPlan> {
    try {
      const result = await this.retry(() => subscriptionService.updatePlan(planId, updates));
      
      this.clearCache(`plan:${planId}`);
      this.clearCache('plans:*');
      this.emit('plan:updated', result);
      
      return result;
    } catch (error) {
      this.emit('plan:error', error);
      throw error;
    }
  }

  async deletePlan(planId: string): Promise<void> {
    try {
      await this.retry(() => subscriptionService.deletePlan(planId));
      
      this.clearCache(`plan:${planId}`);
      this.clearCache('plans:*');
      this.emit('plan:deleted', { planId });
      
    } catch (error) {
      this.emit('plan:error', error);
      throw error;
    }
  }

  // Subscription management with integration
  async getUserSubscriptions(userId: string, options: {
    status?: string;
    page?: number;
    limit?: number;
    useCache?: boolean;
  } = {}): Promise<{ data: UserSubscription[]; pagination?: any }> {
    const cacheKey = `subscriptions:${userId}:${JSON.stringify(options)}`;
    
    if (options.useCache !== false) {
      const cached = this.getCache(cacheKey);
      if (cached) return cached;
    }

    try {
      const result = await this.retry(() => subscriptionService.getUserSubscriptions(userId, options));
      
      this.setCache(cacheKey, result);
      this.emit('subscriptions:loaded', result);
      
      return result;
    } catch (error) {
      this.emit('subscriptions:error', error);
      throw error;
    }
  }

  async getSubscription(subscriptionId: string, userId?: string, useCache = true): Promise<UserSubscription> {
    const cacheKey = `subscription:${subscriptionId}`;
    
    if (useCache) {
      const cached = this.getCache(cacheKey);
      if (cached) return cached;
    }

    try {
      const result = await this.retry(() => subscriptionService.getSubscription(subscriptionId, userId));
      
      this.setCache(cacheKey, result);
      this.emit('subscription:loaded', result);
      
      return result;
    } catch (error) {
      this.emit('subscription:error', error);
      throw error;
    }
  }

  async createSubscription(subscriptionData: any): Promise<UserSubscription> {
    try {
      const result = await this.retry(() => subscriptionService.createSubscription(subscriptionData));
      
      this.clearCache('subscriptions:*');
      this.emit('subscription:created', result);
      
      return result;
    } catch (error) {
      this.emit('subscription:error', error);
      throw error;
    }
  }

  async cancelSubscription(subscriptionId: string): Promise<UserSubscription> {
    try {
      const result = await this.retry(() => subscriptionService.cancelSubscription(subscriptionId));
      
      this.clearCache(`subscription:${subscriptionId}`);
      this.clearCache('subscriptions:*');
      this.emit('subscription:cancelled', result);
      
      return result;
    } catch (error) {
      this.emit('subscription:error', error);
      throw error;
    }
  }

  async renewSubscription(subscriptionId: string): Promise<UserSubscription> {
    try {
      const result = await this.retry(() => subscriptionService.renewSubscription(subscriptionId));
      
      this.clearCache(`subscription:${subscriptionId}`);
      this.clearCache('subscriptions:*');
      this.emit('subscription:renewed', result);
      
      return result;
    } catch (error) {
      this.emit('subscription:error', error);
      throw error;
    }
  }

  async toggleAutoRenew(subscriptionId: string, autoRenew: boolean): Promise<UserSubscription> {
    try {
      const result = await this.retry(() => subscriptionService.toggleAutoRenew(subscriptionId, autoRenew));
      
      this.clearCache(`subscription:${subscriptionId}`);
      this.clearCache('subscriptions:*');
      this.emit('subscription:auto_renew_toggled', result);
      
      return result;
    } catch (error) {
      this.emit('subscription:error', error);
      throw error;
    }
  }

  // Admin functions with integration
  async getStats(useCache = true): Promise<SubscriptionStats> {
    const cacheKey = 'stats';
    
    if (useCache) {
      const cached = this.getCache(cacheKey);
      if (cached) return cached;
    }

    try {
      const result = await this.retry(() => subscriptionService.getStats());
      
      this.setCache(cacheKey, result);
      this.emit('stats:loaded', result);
      
      return result;
    } catch (error) {
      this.emit('stats:error', error);
      throw error;
    }
  }

  async pauseContract(paused: boolean): Promise<{ paused: boolean; updatedAt: string }> {
    try {
      const result = await this.retry(() => subscriptionService.pauseContract(paused));
      
      this.clearCache('stats:*');
      this.emit('contract:paused', result);
      
      return result;
    } catch (error) {
      this.emit('contract:error', error);
      throw error;
    }
  }

  async updatePlatformFee(feeBps: number): Promise<{ feeBps: number; updatedAt: string }> {
    try {
      const result = await this.retry(() => subscriptionService.updatePlatformFee(feeBps));
      
      this.clearCache('stats:*');
      this.emit('platform_fee:updated', result);
      
      return result;
    } catch (error) {
      this.emit('platform_fee:error', error);
      throw error;
    }
  }

  async transferAdmin(newAdminAddress: string): Promise<{
    newAdminAddress: string;
    transferredAt: string;
    transferredBy: string;
  }> {
    try {
      const result = await this.retry(() => subscriptionService.transferAdmin(newAdminAddress));
      
      this.emit('admin:transferred', result);
      
      return result;
    } catch (error) {
      this.emit('admin:error', error);
      throw error;
    }
  }

  // Batch operations
  async batchCreateSubscriptions(subscriptions: any[]): Promise<UserSubscription[]> {
    try {
      const result = await this.retry(() => subscriptionService.batchCreateSubscriptions(subscriptions));
      
      this.clearCache('subscriptions:*');
      this.emit('subscriptions:batch_created', result);
      
      return result;
    } catch (error) {
      this.emit('subscriptions:error', error);
      throw error;
    }
  }

  async batchCancelSubscriptions(subscriptionIds: string[]): Promise<UserSubscription[]> {
    try {
      const result = await this.retry(() => subscriptionService.batchCancelSubscriptions(subscriptionIds));
      
      this.clearCache('subscriptions:*');
      this.emit('subscriptions:batch_cancelled', result);
      
      return result;
    } catch (error) {
      this.emit('subscriptions:error', error);
      throw error;
    }
  }

  // Analytics and reporting
  async getRevenueReport(options: {
    startDate: string;
    endDate: string;
    groupBy?: 'day' | 'week' | 'month';
  }): Promise<any> {
    try {
      const result = await this.retry(() => subscriptionService.getRevenueReport(options));
      
      this.emit('revenue_report:loaded', result);
      
      return result;
    } catch (error) {
      this.emit('revenue_report:error', error);
      throw error;
    }
  }

  async getChurnReport(options: {
    startDate: string;
    endDate: string;
  }): Promise<any> {
    try {
      const result = await this.retry(() => subscriptionService.getChurnReport(options));
      
      this.emit('churn_report:loaded', result);
      
      return result;
    } catch (error) {
      this.emit('churn_report:error', error);
      throw error;
    }
  }

  // Export/Import functionality
  async exportSubscriptions(format: 'json' | 'csv' = 'json'): Promise<Blob> {
    try {
      const result = await this.retry(() => subscriptionService.exportSubscriptions(format));
      
      this.emit('subscriptions:exported', { format, size: result.size });
      
      return result;
    } catch (error) {
      this.emit('subscriptions:error', error);
      throw error;
    }
  }

  async importSubscriptions(file: File): Promise<{
    imported: number;
    failed: number;
    errors: string[];
  }> {
    try {
      const result = await this.retry(() => subscriptionService.importSubscriptions(file));
      
      this.clearCache('subscriptions:*');
      this.emit('subscriptions:imported', result);
      
      return result;
    } catch (error) {
      this.emit('subscriptions:error', error);
      throw error;
    }
  }

  // Health check
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    checks: Array<{
      name: string;
      status: 'pass' | 'fail' | 'warn';
      message: string;
    }>;
  }> {
    const checks = [];
    
    // Check API connectivity
    try {
      await subscriptionService.getStats();
      checks.push({ name: 'api', status: 'pass', message: 'API is responsive' });
    } catch (error) {
      checks.push({ name: 'api', status: 'fail', message: 'API is not responding' });
    }

    // Check WebSocket connection
    if (this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN) {
      checks.push({ name: 'websocket', status: 'pass', message: 'WebSocket is connected' });
    } else {
      checks.push({ name: 'websocket', status: 'warn', message: 'WebSocket is not connected' });
    }

    // Check cache
    const cacheSize = this.cache.size;
    checks.push({ 
      name: 'cache', 
      status: cacheSize > 1000 ? 'warn' : 'pass', 
      message: `Cache contains ${cacheSize} entries` 
    });

    // Determine overall status
    const failedChecks = checks.filter(c => c.status === 'fail');
    const warnChecks = checks.filter(c => c.status === 'warn');
    
    let status: 'healthy' | 'degraded' | 'unhealthy';
    if (failedChecks.length > 0) {
      status = 'unhealthy';
    } else if (warnChecks.length > 0) {
      status = 'degraded';
    } else {
      status = 'healthy';
    }

    return { status, checks };
  }

  // Setup event listeners
  private setupEventListeners(): void {
    // Auto-reconnect WebSocket on page visibility change
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && (!this.wsConnection || this.wsConnection.readyState !== WebSocket.OPEN)) {
          this.connectWebSocket();
        }
      });
    }

    // Handle online/offline events
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        if (!this.wsConnection || this.wsConnection.readyState !== WebSocket.OPEN) {
          this.connectWebSocket();
        }
      });

      window.addEventListener('offline', () => {
        if (this.wsConnection) {
          this.wsConnection.close();
        }
      });
    }
  }

  // Initialize service
  public initialize(): void {
    this.connectWebSocket();
    console.log('Integration service initialized');
  }

  // Cleanup
  public cleanup(): void {
    if (this.wsConnection) {
      this.wsConnection.close();
      this.wsConnection = null;
    }
    
    this.cache.clear();
    this.eventListeners.clear();
    
    console.log('Integration service cleaned up');
  }
}

// Export singleton instance
export const integrationService = new IntegrationService();
export default integrationService;
