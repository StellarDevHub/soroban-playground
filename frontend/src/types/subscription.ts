// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

export interface SubscriptionPlan {
  planId: string;
  name: string;
  description: string;
  pricePerPeriod: number;
  billingPeriod: number; // in seconds
  features: string[];
  maxSubscribers?: number;
  currentSubscribers: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

export interface UserSubscription {
  subscriptionId: string;
  userId: string;
  planId: string;
  paymentMethod: string;
  status: 'active' | 'cancelled' | 'expired';
  currentPeriodStart: string;
  currentPeriodEnd: string;
  autoRenew: boolean;
  createdAt: string;
  updatedAt: string;
  cancelledAt?: string;
  lastRenewedAt?: string;
}

export interface SubscriptionStats {
  totalSubscriptions: number;
  activeSubscriptions: number;
  cancelledSubscriptions: number;
  totalRevenue: number;
  totalPlans: number;
  activePlans: number;
  averageRevenuePerSubscription: number;
  churnRate: number;
  monthlyGrowth: number;
}

export interface PaymentRecord {
  id: string;
  subscriptionId: string;
  amount: number;
  timestamp: string;
  paymentMethod: string;
  transactionHash: string;
  status: 'pending' | 'completed' | 'failed';
  errorMessage?: string;
}

export interface SubscriptionEvent {
  type: 'PLAN_CREATED' | 'PLAN_UPDATED' | 'PLAN_DELETED' | 
        'SUBSCRIPTION_CREATED' | 'SUBSCRIPTION_UPDATED' | 'SUBSCRIPTION_CANCELLED' | 
        'SUBSCRIPTION_RENEWED' | 'STATS_UPDATED';
  timestamp: string;
  data: {
    plan?: SubscriptionPlan;
    subscription?: UserSubscription;
    stats?: SubscriptionStats;
  };
}

export interface CreateSubscriptionPlanRequest {
  planId: string;
  name: string;
  description?: string;
  pricePerPeriod: number;
  billingPeriod: number;
  features?: string[];
  maxSubscribers?: number;
  isActive?: boolean;
}

export interface UpdateSubscriptionPlanRequest {
  name?: string;
  description?: string;
  pricePerPeriod?: number;
  billingPeriod?: number;
  features?: string[];
  maxSubscribers?: number;
  isActive?: boolean;
}

export interface CreateSubscriptionRequest {
  planId: string;
  paymentMethod: string;
}

export interface SubscriptionFilters {
  status?: string;
  planId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface SubscriptionAnalytics {
  revenueReport: {
    totalRevenue: number;
    revenueByPeriod: Array<{
      period: string;
      revenue: number;
      subscriptions: number;
    }>;
  };
  churnReport: {
    churnRate: number;
    totalChurned: number;
    churnByReason: Array<{
      reason: string;
      count: number;
      percentage: number;
    }>;
  };
  growthMetrics: {
    newSubscriptions: number;
    cancelledSubscriptions: number;
    netGrowth: number;
    growthRate: number;
  };
}

export interface SubscriptionNotification {
  id: string;
  userId: string;
  type: 'renewal_reminder' | 'payment_failed' | 'subscription_expired' | 'plan_updated';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  metadata?: Record<string, any>;
}

export interface SubscriptionSettings {
  autoRenewalEnabled: boolean;
  renewalReminderDays: number;
  paymentRetryAttempts: number;
  gracePeriodDays: number;
  defaultPaymentMethod?: string;
}

export interface BillingPeriod {
  label: string;
  value: number;
  duration: string;
}

export const BILLING_PERIODS: BillingPeriod[] = [
  { label: 'Daily', value: 86400, duration: 'day' },
  { label: 'Weekly', value: 604800, duration: 'week' },
  { label: 'Monthly', value: 2592000, duration: 'month' },
  { label: 'Quarterly', value: 7776000, duration: 'quarter' },
  { label: 'Yearly', value: 31536000, duration: 'year' },
];

export interface SubscriptionTier {
  id: string;
  name: string;
  features: string[];
  priceRanges: Array<{
    minUsers: number;
    maxUsers: number;
    pricePerUser: number;
  }>;
}

export interface UsageMetrics {
  subscriptionId: string;
  period: string;
  metrics: {
    apiCalls: number;
    storageUsed: number;
    bandwidthUsed: number;
    activeUsers: number;
  };
}

export interface SubscriptionInvoice {
  id: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  period: {
    start: string;
    end: string;
  };
  status: 'draft' | 'sent' | 'paid' | 'overdue';
  createdAt: string;
  dueDate: string;
  paidAt?: string;
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
}

export interface PaymentMethod {
  id: string;
  type: 'card' | 'bank_account' | 'crypto';
  provider: string;
  lastFour?: string;
  expiryMonth?: number;
  expiryYear?: number;
  brand?: string;
  isDefault: boolean;
  createdAt: string;
}

export interface SubscriptionDiscount {
  id: string;
  code: string;
  type: 'percentage' | 'fixed';
  value: number;
  maxUses?: number;
  currentUses: number;
  expiresAt?: string;
  applicablePlans: string[];
}

export interface SubscriptionPromotion {
  id: string;
  name: string;
  description: string;
  discount: SubscriptionDiscount;
  startDate: string;
  endDate: string;
  applicablePlans: string[];
  isActive: boolean;
}

export interface SubscriptionAuditLog {
  id: string;
  subscriptionId: string;
  userId: string;
  action: string;
  oldValue?: any;
  newValue?: any;
  ipAddress: string;
  userAgent: string;
  timestamp: string;
}

export interface SubscriptionWebhook {
  id: string;
  url: string;
  events: string[];
  secret: string;
  isActive: boolean;
  lastTriggered?: string;
  createdAt: string;
}

export interface SubscriptionExport {
  format: 'json' | 'csv' | 'xlsx';
  data: any[];
  filename: string;
  generatedAt: string;
}

export interface SubscriptionImportResult {
  imported: number;
  failed: number;
  errors: Array<{
    row: number;
    error: string;
    data: any;
  }>;
}

export interface SubscriptionHealthCheck {
  overall: 'healthy' | 'warning' | 'critical';
  checks: Array<{
    name: string;
    status: 'pass' | 'fail' | 'warning';
    message: string;
    details?: any;
  }>;
  timestamp: string;
}

export interface SubscriptionMetrics {
  mrr: number; // Monthly Recurring Revenue
  arr: number; // Annual Recurring Revenue
  ltv: number; // Lifetime Value
  cac: number; // Customer Acquisition Cost
  arpu: number; // Average Revenue Per User
  nps: number; // Net Promoter Score
}

// Utility types
export type SubscriptionPlanFormData = Omit<SubscriptionPlan, 'planId' | 'createdAt' | 'updatedAt' | 'currentSubscribers'>;
export type SubscriptionFormData = Omit<UserSubscription, 'subscriptionId' | 'createdAt' | 'updatedAt'>;

// Error types
export class SubscriptionError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any
  ) {
    super(message);
    this.name = 'SubscriptionError';
  }
}

// API Response types
export interface ApiError {
  success: false;
  error: string;
  details?: string[];
  code?: string;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  message?: string;
}

// WebSocket message types
export interface WebSocketMessage {
  type: string;
  payload: any;
  timestamp: string;
}

export interface SubscriptionWebSocketMessage extends WebSocketMessage {
  type: 'subscription_update' | 'plan_update' | 'stats_update' | 'payment_update';
  payload: {
    action: string;
    data: any;
  };
}
