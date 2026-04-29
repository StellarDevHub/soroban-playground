/**
 * REIT Service - Frontend API client for Tokenized REIT operations
 */

import { reitEventBus } from './eventBus';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

// Types
export interface Property {
  id: number;
  contract_id: string;
  property_id: number;
  name: string;
  description: string;
  location: string;
  total_shares: number;
  shares_sold: number;
  shares_reserved: number;
  price_per_share: number;
  total_valuation: number;
  status: 'Listed' | 'Funded' | 'Active' | 'Suspended' | 'Delisted';
  target_yield_bps: number;
  metadata_uri: string;
  created_at: number;
  updated_at: number;
}

export interface PropertyStats {
  total_properties: number;
  listed_count: number;
  active_count: number;
  funded_count: number;
  total_valuation: number;
  total_funded: number;
  avg_yield_bps: number;
}

export interface Investor {
  id: number;
  address: string;
  total_properties: number;
  total_shares: number;
  total_invested: number;
  total_dividends_claimed: number;
  first_investment_at: number;
  last_activity_at: number;
  is_blacklisted: boolean;
}

export interface Ownership {
  id: number;
  property_id: number;
  investor_address: string;
  shares: number;
  dividend_claimed: number;
  last_claimed_at: number;
  name?: string;
  location?: string;
  status?: string;
  price_per_share?: number;
}

export interface Portfolio {
  property_count: number;
  total_shares: number;
  portfolio_value: number;
  total_dividends: number;
  avg_yield_bps: number;
}

export interface Distribution {
  id: number;
  distribution_id: number;
  property_id: number;
  total_amount: number;
  amount_per_share: number;
  distribution_type: 'Quarterly' | 'Special' | 'SaleProceeds' | 'RentalIncome';
  distributed_at: number;
}

export interface ReitConfig {
  contract_id: string;
  name: string;
  symbol: string;
  admin_address: string;
  total_properties: number;
  total_investors: number;
  total_value_locked: number;
  total_dividends_distributed: number;
  platform_fee_bps: number;
  min_investment: number;
  max_investment_per_property: number;
  is_paused: boolean;
}

export interface Transaction {
  id: number;
  tx_hash?: string;
  tx_type: string;
  property_id?: number;
  investor_address?: string;
  amount?: number;
  shares?: number;
  status: 'pending' | 'success' | 'failed';
  created_at: number;
}

export interface PaginationData<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// API Client
class ReitApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private async fetch(endpoint: string, options?: RequestInit): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
      },
      ...options,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // Properties
  async getProperties(
    contractId: string,
    filters?: {
      status?: string;
      minPrice?: number;
      maxPrice?: number;
      location?: string;
    },
    pagination?: { page?: number; limit?: number }
  ): Promise<PaginationData<Property>> {
    const params = new URLSearchParams();
    params.append('contractId', contractId);
    
    if (filters?.status) params.append('status', filters.status);
    if (filters?.minPrice) params.append('minPrice', filters.minPrice.toString());
    if (filters?.maxPrice) params.append('maxPrice', filters.maxPrice.toString());
    if (filters?.location) params.append('location', filters.location);
    if (pagination?.page) params.append('page', pagination.page.toString());
    if (pagination?.limit) params.append('limit', pagination.limit.toString());

    return this.fetch(`/api/reit/properties?${params}`);
  }

  async getProperty(contractId: string, propertyId: number): Promise<Property> {
    const result = await this.fetch(`/api/reit/properties/${propertyId}?contractId=${contractId}`);
    return result.data;
  }

  async getPropertyStats(contractId: string): Promise<PropertyStats> {
    const result = await this.fetch(`/api/reit/properties/stats?contractId=${contractId}`);
    return result.data;
  }

  // Investors
  async getInvestor(address: string): Promise<Investor> {
    const result = await this.fetch(`/api/reit/investors/${address}`);
    return result.data;
  }

  async getInvestorProperties(contractId: string, address: string): Promise<{ properties: Ownership[]; portfolio_summary: Portfolio }> {
    const result = await this.fetch(`/api/reit/investors/${address}/properties?contractId=${contractId}`);
    return result.data;
  }

  async getClaimableDividends(contractId: string, address: string): Promise<{
    total_claimable: number;
    by_property: Array<{
      property_id: number;
      property_name: string;
      shares: number;
      claimable_amount: number;
    }>;
  }> {
    const result = await this.fetch(`/api/reit/investors/${address}/claimable?contractId=${contractId}`);
    return result.data;
  }

  // Transactions
  async getTransactions(
    filters?: {
      contract_id?: string;
      investor?: string;
      type?: string;
      status?: string;
      startDate?: number;
      endDate?: number;
    },
    pagination?: { page?: number; limit?: number }
  ): Promise<PaginationData<Transaction>> {
    const params = new URLSearchParams();
    
    if (filters?.contract_id) params.append('contractId', filters.contract_id);
    if (filters?.investor) params.append('investor', filters.investor);
    if (filters?.type) params.append('type', filters.type);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.startDate) params.append('startDate', filters.startDate.toString());
    if (filters?.endDate) params.append('endDate', filters.endDate.toString());
    if (pagination?.page) params.append('page', pagination.page.toString());
    if (pagination?.limit) params.append('limit', pagination.limit.toString());

    return this.fetch(`/api/reit/transactions?${params}`);
  }

  // Distributions
  async getDistributions(contractId: string, propertyId?: number): Promise<Distribution[]> {
    const params = new URLSearchParams();
    params.append('contractId', contractId);
    if (propertyId) params.append('propertyId', propertyId.toString());

    const result = await this.fetch(`/api/reit/distributions?${params}`);
    return result.data;
  }

  // REIT Config
  async getReitConfig(contractId: string): Promise<ReitConfig> {
    const result = await this.fetch(`/api/reit/config?contractId=${contractId}`);
    return result.data;
  }

  // Analytics
  async getPerformanceMetrics(contractId: string, period: '7d' | '30d' | '90d' | '1y' = '30d'): Promise<{
    new_investors: number;
    total_invested: number;
    total_dividends: number;
    total_transactions: number;
  }> {
    const result = await this.fetch(`/api/reit/analytics/performance?contractId=${contractId}&period=${period}`);
    return result.data;
  }

  async getYieldAnalytics(contractId: string): Promise<Array<{
    property_id: number;
    name: string;
    target_yield_bps: number;
    total_valuation: number;
    distribution_count: number;
    total_distributed: number;
    actual_yield_bps: number;
  }>> {
    const result = await this.fetch(`/api/reit/analytics/yield?contractId=${contractId}`);
    return result.data;
  }

  async getDashboardData(contractId: string): Promise<{
    reit_info: ReitConfig;
    property_stats: PropertyStats;
    performance_30d: {
      new_investors: number;
      total_invested: number;
      total_dividends: number;
      total_transactions: number;
    };
    yield_analytics: Array<{
      property_id: number;
      name: string;
      target_yield_bps: number;
      actual_yield_bps: number;
    }>;
  }> {
    const result = await this.fetch(`/api/reit/analytics/dashboard?contractId=${contractId}`);
    return result.data;
  }

  // Contract Interactions
  async buyShares(contractId: string, source: string, propertyId: number, shares: number): Promise<{
    transaction_id: number;
    status: string;
    message: string;
  }> {
    return this.fetch('/api/reit/invoke/buy-shares', {
      method: 'POST',
      body: JSON.stringify({ contractId, source, propertyId, shares }),
    });
  }

  async claimDividends(contractId: string, source: string, propertyId: number): Promise<{
    transaction_id: number;
    status: string;
    message: string;
  }> {
    return this.fetch('/api/reit/invoke/claim-dividends', {
      method: 'POST',
      body: JSON.stringify({ contractId, source, propertyId }),
    });
  }

  // Events
  async getEvents(
    contractId: string,
    filters?: {
      eventType?: string;
      startLedger?: number;
      endLedger?: number;
    },
    pagination?: { page?: number; limit?: number }
  ): Promise<any[]> {
    const params = new URLSearchParams();
    params.append('contractId', contractId);
    
    if (filters?.eventType) params.append('eventType', filters.eventType);
    if (filters?.startLedger) params.append('startLedger', filters.startLedger.toString());
    if (filters?.endLedger) params.append('endLedger', filters.endLedger.toString());
    if (pagination?.page) params.append('page', pagination.page.toString());
    if (pagination?.limit) params.append('limit', pagination.limit.toString());

    return this.fetch(`/api/reit/events?${params}`);
  }
}

// Export singleton
export const reitApi = new ReitApiClient();
export default reitApi;
