const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

interface Plan {
  id: number;
  name: string;
  price: string;
  duration: number;
  features: string[];
  active: boolean;
}

interface Subscription {
  user: string;
  plan_id: number;
  start_time: number;
  end_time: number;
  auto_renew: boolean;
  active: boolean;
  payments_made: number;
}

interface UsageMetrics {
  api_calls: number;
  storage_used: number;
  bandwidth: number;
  last_updated: number;
}

class SubscriptionApi {
  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Request failed' }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    return response.json();
  }

  async getPlans(): Promise<Plan[]> {
    return this.request<Plan[]>('/subscriptions/plans');
  }

  async subscribe(planId: number, autoRenew: boolean): Promise<void> {
    await this.request('/subscriptions/subscribe', {
      method: 'POST',
      body: JSON.stringify({ plan_id: planId, auto_renew: autoRenew }),
    });
  }

  async renewSubscription(): Promise<void> {
    await this.request('/subscriptions/renew', {
      method: 'POST',
    });
  }

  async cancelSubscription(): Promise<void> {
    await this.request('/subscriptions/cancel', {
      method: 'POST',
    });
  }

  async getSubscription(): Promise<Subscription | null> {
    try {
      return await this.request<Subscription>('/subscriptions/me');
    } catch {
      return null;
    }
  }

  async getUsage(): Promise<UsageMetrics | null> {
    try {
      return await this.request<UsageMetrics>('/subscriptions/usage');
    } catch {
      return null;
    }
  }

  async recordUsage(apiCalls: number, storage: number, bandwidth: number): Promise<void> {
    await this.request('/subscriptions/usage', {
      method: 'POST',
      body: JSON.stringify({ api_calls: apiCalls, storage, bandwidth }),
    });
  }
}

export const subscriptionApi = new SubscriptionApi();
