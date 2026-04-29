// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { SubscriptionPlan, UserSubscription, SubscriptionStats } from '@/types/subscription';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

class SubscriptionService {
  private getAuthHeaders(): HeadersInit {
    const token = localStorage.getItem('auth_token');
    return {
      'Content-Type': 'application/json',
      ...(token && { 'Authorization': `Bearer ${token}` }),
    };
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }));
      throw new Error(error.message || `HTTP error! status: ${response.status}`);
    }
    return response.json();
  }

  // Plan Management
  async getPlans(options: {
    active?: boolean;
    page?: number;
    limit?: number;
  } = {}): Promise<ApiResponse<SubscriptionPlan[]>> {
    const params = new URLSearchParams();
    if (options.active !== undefined) params.append('active', options.active.toString());
    if (options.page) params.append('page', options.page.toString());
    if (options.limit) params.append('limit', options.limit.toString());

    const response = await fetch(`${API_BASE_URL}/subscription/plans?${params}`, {
      headers: this.getAuthHeaders(),
    });

    return this.handleResponse<ApiResponse<SubscriptionPlan[]>>(response);
  }

  async getPlan(planId: string): Promise<SubscriptionPlan> {
    const response = await fetch(`${API_BASE_URL}/subscription/plans/${planId}`, {
      headers: this.getAuthHeaders(),
    });

    const result = await this.handleResponse<ApiResponse<SubscriptionPlan>>(response);
    return result.data;
  }

  async createPlan(planData: {
    planId: string;
    name: string;
    description?: string;
    pricePerPeriod: number;
    billingPeriod: number;
    features?: string[];
    maxSubscribers?: number;
    isActive?: boolean;
  }): Promise<SubscriptionPlan> {
    const response = await fetch(`${API_BASE_URL}/subscription/plans`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(planData),
    });

    const result = await this.handleResponse<ApiResponse<SubscriptionPlan>>(response);
    return result.data;
  }

  async updatePlan(planId: string, updates: Partial<SubscriptionPlan>): Promise<SubscriptionPlan> {
    const response = await fetch(`${API_BASE_URL}/subscription/plans/${planId}`, {
      method: 'PUT',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(updates),
    });

    const result = await this.handleResponse<ApiResponse<SubscriptionPlan>>(response);
    return result.data;
  }

  async deletePlan(planId: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/subscription/plans/${planId}`, {
      method: 'DELETE',
      headers: this.getAuthHeaders(),
    });

    await this.handleResponse(response);
  }

  // Subscription Management
  async getUserSubscriptions(userId: string, options: {
    status?: string;
    page?: number;
    limit?: number;
  } = {}): Promise<ApiResponse<UserSubscription[]>> {
    const params = new URLSearchParams();
    if (options.status) params.append('status', options.status);
    if (options.page) params.append('page', options.page.toString());
    if (options.limit) params.append('limit', options.limit.toString());

    const response = await fetch(`${API_BASE_URL}/subscription/subscriptions?${params}`, {
      headers: this.getAuthHeaders(),
    });

    return this.handleResponse<ApiResponse<UserSubscription[]>>(response);
  }

  async getSubscription(subscriptionId: string, userId?: string): Promise<UserSubscription> {
    const url = userId 
      ? `${API_BASE_URL}/subscription/subscriptions/${subscriptionId}?userId=${userId}`
      : `${API_BASE_URL}/subscription/subscriptions/${subscriptionId}`;

    const response = await fetch(url, {
      headers: this.getAuthHeaders(),
    });

    const result = await this.handleResponse<ApiResponse<UserSubscription>>(response);
    return result.data;
  }

  async createSubscription(subscriptionData: {
    planId: string;
    paymentMethod: string;
  }): Promise<UserSubscription> {
    const response = await fetch(`${API_BASE_URL}/subscription/subscriptions`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(subscriptionData),
    });

    const result = await this.handleResponse<ApiResponse<UserSubscription>>(response);
    return result.data;
  }

  async cancelSubscription(subscriptionId: string): Promise<UserSubscription> {
    const response = await fetch(`${API_BASE_URL}/subscription/subscriptions/${subscriptionId}/cancel`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
    });

    const result = await this.handleResponse<ApiResponse<UserSubscription>>(response);
    return result.data;
  }

  async renewSubscription(subscriptionId: string): Promise<UserSubscription> {
    const response = await fetch(`${API_BASE_URL}/subscription/subscriptions/${subscriptionId}/renew`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
    });

    const result = await this.handleResponse<ApiResponse<UserSubscription>>(response);
    return result.data;
  }

  async toggleAutoRenew(subscriptionId: string, autoRenew: boolean): Promise<UserSubscription> {
    const response = await fetch(`${API_BASE_URL}/subscription/subscriptions/${subscriptionId}/auto-renew`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ autoRenew }),
    });

    const result = await this.handleResponse<ApiResponse<UserSubscription>>(response);
    return result.data;
  }

  // Admin Functions
  async getStats(): Promise<SubscriptionStats> {
    const response = await fetch(`${API_BASE_URL}/subscription/stats`, {
      headers: this.getAuthHeaders(),
    });

    const result = await this.handleResponse<ApiResponse<SubscriptionStats>>(response);
    return result.data;
  }

  async pauseContract(paused: boolean): Promise<{ paused: boolean; updatedAt: string }> {
    const response = await fetch(`${API_BASE_URL}/subscription/admin/pause`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ paused }),
    });

    const result = await this.handleResponse<ApiResponse<{ paused: boolean; updatedAt: string }>>(response);
    return result.data;
  }

  async updatePlatformFee(feeBps: number): Promise<{ feeBps: number; updatedAt: string }> {
    const response = await fetch(`${API_BASE_URL}/subscription/admin/platform-fee`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ feeBps }),
    });

    const result = await this.handleResponse<ApiResponse<{ feeBps: number; updatedAt: string }>>(response);
    return result.data;
  }

  async transferAdmin(newAdminAddress: string): Promise<{
    newAdminAddress: string;
    transferredAt: string;
    transferredBy: string;
  }> {
    const response = await fetch(`${API_BASE_URL}/subscription/admin/transfer-admin`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ newAdminAddress }),
    });

    const result = await this.handleResponse<ApiResponse<{
      newAdminAddress: string;
      transferredAt: string;
      transferredBy: string;
    }>>(response);
    return result.data;
  }

  // WebSocket connection for real-time updates
  createWebSocketConnection(): WebSocket {
    const token = localStorage.getItem('auth_token');
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001';
    
    return new WebSocket(`${wsUrl}/ws/subscription?token=${token}`);
  }

  // Utility methods
  async validatePlanId(planId: string): Promise<boolean> {
    try {
      await this.getPlan(planId);
      return true;
    } catch (error) {
      return false;
    }
  }

  async validateSubscriptionId(subscriptionId: string): Promise<boolean> {
    try {
      await this.getSubscription(subscriptionId);
      return true;
    } catch (error) {
      return false;
    }
  }

  // Batch operations
  async batchCreateSubscriptions(subscriptions: Array<{
    planId: string;
    paymentMethod: string;
  }>): Promise<UserSubscription[]> {
    const promises = subscriptions.map(sub => this.createSubscription(sub));
    return Promise.all(promises);
  }

  async batchCancelSubscriptions(subscriptionIds: string[]): Promise<UserSubscription[]> {
    const promises = subscriptionIds.map(id => this.cancelSubscription(id));
    return Promise.all(promises);
  }

  // Export/Import functionality
  async exportSubscriptions(format: 'json' | 'csv' = 'json'): Promise<Blob> {
    const response = await fetch(`${API_BASE_URL}/subscription/subscriptions/export?format=${format}`, {
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error('Failed to export subscriptions');
    }

    return response.blob();
  }

  async importSubscriptions(file: File): Promise<{
    imported: number;
    failed: number;
    errors: string[];
  }> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_BASE_URL}/subscription/subscriptions/import`, {
      method: 'POST',
      headers: {
        // Don't set Content-Type for FormData, it's set automatically
        ...(localStorage.getItem('auth_token') && { 
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}` 
        }),
      },
      body: formData,
    });

    return this.handleResponse(response);
  }

  // Analytics and reporting
  async getRevenueReport(options: {
    startDate: string;
    endDate: string;
    groupBy?: 'day' | 'week' | 'month';
  }): Promise<{
    totalRevenue: number;
    revenueByPeriod: Array<{
      period: string;
      revenue: number;
      subscriptions: number;
    }>;
  }> {
    const params = new URLSearchParams();
    params.append('startDate', options.startDate);
    params.append('endDate', options.endDate);
    if (options.groupBy) params.append('groupBy', options.groupBy);

    const response = await fetch(`${API_BASE_URL}/subscription/analytics/revenue?${params}`, {
      headers: this.getAuthHeaders(),
    });

    return this.handleResponse(response);
  }

  async getChurnReport(options: {
    startDate: string;
    endDate: string;
  }): Promise<{
    churnRate: number;
    totalChurned: number;
    churnByReason: Array<{
      reason: string;
      count: number;
      percentage: number;
    }>;
  }> {
    const params = new URLSearchParams();
    params.append('startDate', options.startDate);
    params.append('endDate', options.endDate);

    const response = await fetch(`${API_BASE_URL}/subscription/analytics/churn?${params}`, {
      headers: this.getAuthHeaders(),
    });

    return this.handleResponse(response);
  }
}

export const subscriptionService = new SubscriptionService();
export default subscriptionService;
