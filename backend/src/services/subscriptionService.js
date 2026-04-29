// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { 
  invokeContract, 
  deployContract, 
  getContractEvents,
  getContractData 
} from './stellarService.js';
import { cacheGet, cacheSet, cacheDelete } from '../utils/cache.js';
import { logger } from '../utils/logger.js';
import { validateAddress } from '../utils/validation.js';

// Contract configuration
const SUBSCRIPTION_CONTRACT_ID = process.env.SUBSCRIPTION_CONTRACT_ID;
const NETWORK = process.env.STELLAR_NETWORK || 'testnet';

// Cache TTL in seconds
const CACHE_TTL = {
  PLANS: 300, // 5 minutes
  SUBSCRIPTIONS: 60, // 1 minute
  STATS: 180, // 3 minutes
};

/**
 * Create a new subscription plan
 */
export async function createSubscriptionPlan(planData) {
  const { planId, name, description, pricePerPeriod, billingPeriod, features, maxSubscribers, isActive, createdBy } = planData;
  
  try {
    logger.info('Creating subscription plan', { planId, name, createdBy });

    // Invoke smart contract to create plan
    const result = await invokeContract({
      contractId: SUBSCRIPTION_CONTRACT_ID,
      method: 'create_plan',
      args: [
        createdBy, // caller address
        planId,
        name,
        description || '',
        pricePerPeriod.toString(),
        billingPeriod.toString(),
        isActive
      ],
      network: NETWORK
    });

    // Clear cache
    await cacheDelete('subscription:plans:*');

    logger.info('Subscription plan created successfully', { planId, result });
    
    return {
      planId,
      name,
      description: description || '',
      pricePerPeriod,
      billingPeriod,
      features: features || [],
      maxSubscribers,
      isActive,
      currentSubscribers: 0,
      createdBy,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error('Failed to create subscription plan', { planId, error: error.message });
    throw new Error(`Failed to create subscription plan: ${error.message}`);
  }
}

/**
 * Get all subscription plans with pagination and filtering
 */
export async function getSubscriptionPlans(options = {}) {
  const { active, page = 1, limit = 10 } = options;
  const cacheKey = `subscription:plans:${JSON.stringify({ active, page, limit })}`;
  
  try {
    // Try to get from cache first
    const cached = await cacheGet(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    logger.info('Fetching subscription plans', { active, page, limit });

    // In a real implementation, this would query the blockchain or a database
    // For now, we'll simulate the response
    const plans = await simulateGetPlans(active, page, limit);

    // Cache the result
    await cacheSet(cacheKey, JSON.stringify(plans), CACHE_TTL.PLANS);

    logger.info('Subscription plans retrieved successfully', { count: plans.data.length });
    return plans;
  } catch (error) {
    logger.error('Failed to get subscription plans', { error: error.message });
    throw new Error(`Failed to get subscription plans: ${error.message}`);
  }
}

/**
 * Get a specific subscription plan
 */
export async function getSubscriptionPlan(planId) {
  const cacheKey = `subscription:plan:${planId}`;
  
  try {
    // Try to get from cache first
    const cached = await cacheGet(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    logger.info('Fetching subscription plan', { planId });

    // Query smart contract for plan details
    const result = await invokeContract({
      contractId: SUBSCRIPTION_CONTRACT_ID,
      method: 'get_plan_details',
      args: [planId],
      network: NETWORK
    });

    const plan = {
      planId,
      name: result[0],
      description: result[1] || '',
      pricePerPeriod: parseInt(result[2]),
      billingPeriod: parseInt(result[3]),
      isActive: result[4],
      currentSubscribers: 0, // Would be tracked in a real implementation
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Cache the result
    await cacheSet(cacheKey, JSON.stringify(plan), CACHE_TTL.PLANS);

    logger.info('Subscription plan retrieved successfully', { planId });
    return plan;
  } catch (error) {
    logger.error('Failed to get subscription plan', { planId, error: error.message });
    if (error.message.includes('contract_error(4)')) {
      return null; // Plan not found
    }
    throw new Error(`Failed to get subscription plan: ${error.message}`);
  }
}

/**
 * Update a subscription plan
 */
export async function updateSubscriptionPlan(planId, updates, updatedBy) {
  try {
    logger.info('Updating subscription plan', { planId, updatedBy });

    // In a real implementation, this would invoke the smart contract
    // For now, we'll simulate the update
    const existingPlan = await getSubscriptionPlan(planId);
    if (!existingPlan) {
      throw new Error('Subscription plan not found');
    }

    const updatedPlan = {
      ...existingPlan,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    // Clear cache
    await cacheDelete(`subscription:plan:${planId}`);
    await cacheDelete('subscription:plans:*');

    logger.info('Subscription plan updated successfully', { planId });
    return updatedPlan;
  } catch (error) {
    logger.error('Failed to update subscription plan', { planId, error: error.message });
    throw new Error(`Failed to update subscription plan: ${error.message}`);
  }
}

/**
 * Delete a subscription plan
 */
export async function deleteSubscriptionPlan(planId, deletedBy) {
  try {
    logger.info('Deleting subscription plan', { planId, deletedBy });

    // Check if plan exists
    const existingPlan = await getSubscriptionPlan(planId);
    if (!existingPlan) {
      return false;
    }

    // In a real implementation, this would invoke the smart contract
    // to deactivate or delete the plan

    // Clear cache
    await cacheDelete(`subscription:plan:${planId}`);
    await cacheDelete('subscription:plans:*');

    logger.info('Subscription plan deleted successfully', { planId });
    return true;
  } catch (error) {
    logger.error('Failed to delete subscription plan', { planId, error: error.message });
    throw new Error(`Failed to delete subscription plan: ${error.message}`);
  }
}

/**
 * Create a new subscription
 */
export async function createSubscription(subscriptionData) {
  const { planId, paymentMethod, userId } = subscriptionData;
  
  try {
    logger.info('Creating subscription', { planId, userId });

    // Validate payment method address
    if (!validateAddress(paymentMethod)) {
      throw new Error('Invalid payment method address');
    }

    // Get plan details to validate
    const plan = await getSubscriptionPlan(planId);
    if (!plan) {
      throw new Error('Subscription plan not found');
    }

    if (!plan.isActive) {
      throw new Error('Subscription plan is not active');
    }

    // Check if user already has an active subscription
    const existingSubscriptions = await getUserSubscriptions(userId, { status: 'active' });
    if (existingSubscriptions.data.length > 0) {
      throw new Error('User already has an active subscription');
    }

    // In a real implementation, this would invoke the smart contract
    const subscriptionId = `sub_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    
    const subscription = {
      subscriptionId,
      userId,
      planId,
      paymentMethod,
      status: 'active',
      currentPeriodStart: new Date().toISOString(),
      currentPeriodEnd: new Date(Date.now() + plan.billingPeriod * 1000).toISOString(),
      autoRenew: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Clear cache
    await cacheDelete(`subscription:user:${userId}:*`);

    logger.info('Subscription created successfully', { subscriptionId, userId });
    return subscription;
  } catch (error) {
    logger.error('Failed to create subscription', { planId, userId, error: error.message });
    throw new Error(`Failed to create subscription: ${error.message}`);
  }
}

/**
 * Get user's subscriptions
 */
export async function getUserSubscriptions(userId, options = {}) {
  const { status, page = 1, limit = 10 } = options;
  const cacheKey = `subscription:user:${userId}:${JSON.stringify({ status, page, limit })}`;
  
  try {
    // Try to get from cache first
    const cached = await cacheGet(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    logger.info('Fetching user subscriptions', { userId, status, page, limit });

    // In a real implementation, this would query the blockchain or a database
    const subscriptions = await simulateGetUserSubscriptions(userId, status, page, limit);

    // Cache the result
    await cacheSet(cacheKey, JSON.stringify(subscriptions), CACHE_TTL.SUBSCRIPTIONS);

    logger.info('User subscriptions retrieved successfully', { userId, count: subscriptions.data.length });
    return subscriptions;
  } catch (error) {
    logger.error('Failed to get user subscriptions', { userId, error: error.message });
    throw new Error(`Failed to get user subscriptions: ${error.message}`);
  }
}

/**
 * Get a specific subscription
 */
export async function getSubscription(subscriptionId, userId) {
  const cacheKey = `subscription:${subscriptionId}`;
  
  try {
    // Try to get from cache first
    const cached = await cacheGet(cacheKey);
    if (cached) {
      const subscription = JSON.parse(cached);
      // Verify ownership
      if (subscription.userId !== userId) {
        throw new Error('Access denied');
      }
      return subscription;
    }

    logger.info('Fetching subscription', { subscriptionId, userId });

    // In a real implementation, this would query the blockchain or database
    const subscription = await simulateGetSubscription(subscriptionId, userId);

    if (subscription) {
      // Cache the result
      await cacheSet(cacheKey, JSON.stringify(subscription), CACHE_TTL.SUBSCRIPTIONS);
    }

    return subscription;
  } catch (error) {
    logger.error('Failed to get subscription', { subscriptionId, userId, error: error.message });
    throw new Error(`Failed to get subscription: ${error.message}`);
  }
}

/**
 * Cancel a subscription
 */
export async function cancelSubscription(subscriptionId, userId) {
  try {
    logger.info('Cancelling subscription', { subscriptionId, userId });

    const subscription = await getSubscription(subscriptionId, userId);
    if (!subscription) {
      return false;
    }

    if (subscription.status === 'cancelled') {
      throw new Error('Subscription is already cancelled');
    }

    // In a real implementation, this would invoke the smart contract
    const updatedSubscription = {
      ...subscription,
      status: 'cancelled',
      autoRenew: false,
      cancelledAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Clear cache
    await cacheDelete(`subscription:${subscriptionId}`);
    await cacheDelete(`subscription:user:${userId}:*`);

    logger.info('Subscription cancelled successfully', { subscriptionId });
    return updatedSubscription;
  } catch (error) {
    logger.error('Failed to cancel subscription', { subscriptionId, userId, error: error.message });
    throw new Error(`Failed to cancel subscription: ${error.message}`);
  }
}

/**
 * Renew a subscription
 */
export async function renewSubscription(subscriptionId, userId) {
  try {
    logger.info('Renewing subscription', { subscriptionId, userId });

    const subscription = await getSubscription(subscriptionId, userId);
    if (!subscription) {
      return false;
    }

    if (subscription.status !== 'active') {
      throw new Error('Subscription is not active');
    }

    if (!subscription.autoRenew) {
      throw new Error('Auto-renew is disabled');
    }

    // In a real implementation, this would invoke the smart contract
    const plan = await getSubscriptionPlan(subscription.planId);
    const updatedSubscription = {
      ...subscription,
      currentPeriodStart: new Date().toISOString(),
      currentPeriodEnd: new Date(Date.now() + plan.billingPeriod * 1000).toISOString(),
      lastRenewedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Clear cache
    await cacheDelete(`subscription:${subscriptionId}`);
    await cacheDelete(`subscription:user:${userId}:*`);

    logger.info('Subscription renewed successfully', { subscriptionId });
    return updatedSubscription;
  } catch (error) {
    logger.error('Failed to renew subscription', { subscriptionId, userId, error: error.message });
    throw new Error(`Failed to renew subscription: ${error.message}`);
  }
}

/**
 * Toggle auto-renew for a subscription
 */
export async function toggleAutoRenew(subscriptionId, userId, autoRenew) {
  try {
    logger.info('Toggling auto-renew', { subscriptionId, userId, autoRenew });

    const subscription = await getSubscription(subscriptionId, userId);
    if (!subscription) {
      return false;
    }

    // In a real implementation, this would invoke the smart contract
    const updatedSubscription = {
      ...subscription,
      autoRenew,
      updatedAt: new Date().toISOString(),
    };

    // Clear cache
    await cacheDelete(`subscription:${subscriptionId}`);
    await cacheDelete(`subscription:user:${userId}:*`);

    logger.info('Auto-renew toggled successfully', { subscriptionId, autoRenew });
    return updatedSubscription;
  } catch (error) {
    logger.error('Failed to toggle auto-renew', { subscriptionId, userId, autoRenew, error: error.message });
    throw new Error(`Failed to toggle auto-renew: ${error.message}`);
  }
}

/**
 * Get subscription statistics
 */
export async function getSubscriptionStats() {
  const cacheKey = 'subscription:stats';
  
  try {
    // Try to get from cache first
    const cached = await cacheGet(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    logger.info('Fetching subscription statistics');

    // In a real implementation, this would query the blockchain or database
    const stats = await simulateGetStats();

    // Cache the result
    await cacheSet(cacheKey, JSON.stringify(stats), CACHE_TTL.STATS);

    logger.info('Subscription statistics retrieved successfully');
    return stats;
  } catch (error) {
    logger.error('Failed to get subscription statistics', { error: error.message });
    throw new Error(`Failed to get subscription statistics: ${error.message}`);
  }
}

/**
 * Pause/unpause the contract
 */
export async function pauseContract(paused, adminId) {
  try {
    logger.info('Pausing contract', { paused, adminId });

    // Invoke smart contract to pause/unpause
    const result = await invokeContract({
      contractId: SUBSCRIPTION_CONTRACT_ID,
      method: 'set_pause',
      args: [adminId, paused],
      network: NETWORK
    });

    // Clear all subscription-related cache
    await cacheDelete('subscription:*');

    logger.info('Contract pause status updated successfully', { paused });
    return { paused, updatedAt: new Date().toISOString() };
  } catch (error) {
    logger.error('Failed to pause contract', { paused, adminId, error: error.message });
    throw new Error(`Failed to pause contract: ${error.message}`);
  }
}

/**
 * Update platform fee
 */
export async function updatePlatformFee(feeBps, adminId) {
  try {
    logger.info('Updating platform fee', { feeBps, adminId });

    // In a real implementation, this would invoke the smart contract

    // Clear cache
    await cacheDelete('subscription:*');

    logger.info('Platform fee updated successfully', { feeBps });
    return { feeBps, updatedAt: new Date().toISOString() };
  } catch (error) {
    logger.error('Failed to update platform fee', { feeBps, adminId, error: error.message });
    throw new Error(`Failed to update platform fee: ${error.message}`);
  }
}

/**
 * Transfer admin rights
 */
export async function transferAdmin(newAdminAddress, currentAdminId) {
  try {
    logger.info('Transferring admin rights', { newAdminAddress, currentAdminId });

    // Validate new admin address
    if (!validateAddress(newAdminAddress)) {
      throw new Error('Invalid admin address');
    }

    // In a real implementation, this would invoke the smart contract

    logger.info('Admin rights transferred successfully', { newAdminAddress });
    return { 
      newAdminAddress, 
      transferredAt: new Date().toISOString(),
      transferredBy: currentAdminId
    };
  } catch (error) {
    logger.error('Failed to transfer admin rights', { newAdminAddress, currentAdminId, error: error.message });
    throw new Error(`Failed to transfer admin rights: ${error.message}`);
  }
}

// === Simulation Functions ===
// These functions simulate blockchain/database responses for development
// In a real implementation, these would be replaced with actual blockchain queries

async function simulateGetPlans(active, page, limit) {
  // Simulate mock data
  const mockPlans = [
    {
      planId: 'basic_monthly',
      name: 'Basic Monthly',
      description: 'Access to basic features',
      pricePerPeriod: 100,
      billingPeriod: 2592000, // 30 days
      isActive: true,
      currentSubscribers: 150,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
    {
      planId: 'premium_monthly',
      name: 'Premium Monthly',
      description: 'Access to all premium features',
      pricePerPeriod: 500,
      billingPeriod: 2592000, // 30 days
      isActive: true,
      currentSubscribers: 75,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
    {
      planId: 'enterprise_monthly',
      name: 'Enterprise Monthly',
      description: 'Full enterprise access with support',
      pricePerPeriod: 1000,
      billingPeriod: 2592000, // 30 days
      isActive: false,
      currentSubscribers: 25,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
  ];

  let filteredPlans = mockPlans;
  if (active !== undefined) {
    filteredPlans = mockPlans.filter(plan => plan.isActive === active);
  }

  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + limit;
  const paginatedPlans = filteredPlans.slice(startIndex, endIndex);

  return {
    data: paginatedPlans,
    pagination: {
      page,
      limit,
      total: filteredPlans.length,
      totalPages: Math.ceil(filteredPlans.length / limit),
    },
  };
}

async function simulateGetUserSubscriptions(userId, status, page, limit) {
  // Simulate mock data
  const mockSubscriptions = [
    {
      subscriptionId: 'sub_1234567890',
      userId,
      planId: 'basic_monthly',
      paymentMethod: 'GDUK...ABC',
      status: 'active',
      currentPeriodStart: '2024-01-15T00:00:00Z',
      currentPeriodEnd: '2024-02-15T00:00:00Z',
      autoRenew: true,
      createdAt: '2024-01-15T00:00:00Z',
      updatedAt: '2024-01-15T00:00:00Z',
    },
    {
      subscriptionId: 'sub_0987654321',
      userId,
      planId: 'premium_monthly',
      paymentMethod: 'GDUK...XYZ',
      status: 'cancelled',
      currentPeriodStart: '2023-12-01T00:00:00Z',
      currentPeriodEnd: '2024-01-01T00:00:00Z',
      autoRenew: false,
      createdAt: '2023-12-01T00:00:00Z',
      updatedAt: '2023-12-20T00:00:00Z',
    },
  ];

  let filteredSubscriptions = mockSubscriptions;
  if (status) {
    filteredSubscriptions = mockSubscriptions.filter(sub => sub.status === status);
  }

  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + limit;
  const paginatedSubscriptions = filteredSubscriptions.slice(startIndex, endIndex);

  return {
    data: paginatedSubscriptions,
    pagination: {
      page,
      limit,
      total: filteredSubscriptions.length,
      totalPages: Math.ceil(filteredSubscriptions.length / limit),
    },
  };
}

async function simulateGetSubscription(subscriptionId, userId) {
  const mockSubscriptions = {
    'sub_1234567890': {
      subscriptionId: 'sub_1234567890',
      userId,
      planId: 'basic_monthly',
      paymentMethod: 'GDUK...ABC',
      status: 'active',
      currentPeriodStart: '2024-01-15T00:00:00Z',
      currentPeriodEnd: '2024-02-15T00:00:00Z',
      autoRenew: true,
      createdAt: '2024-01-15T00:00:00Z',
      updatedAt: '2024-01-15T00:00:00Z',
    },
  };

  return mockSubscriptions[subscriptionId] || null;
}

async function simulateGetStats() {
  return {
    totalSubscriptions: 250,
    activeSubscriptions: 200,
    cancelledSubscriptions: 50,
    totalRevenue: 125000, // in tokens
    totalPlans: 3,
    activePlans: 2,
    averageRevenuePerSubscription: 625,
    churnRate: 0.2, // 20%
    monthlyGrowth: 0.15, // 15%
  };
}
