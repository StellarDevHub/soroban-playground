import { db } from '../database/connection.js';
import { cacheService } from './cacheService.js';
import { logger } from '../utils/logger.js';

class SubscriptionService {
  constructor() {
    this.initializeDatabase();
  }

  async initializeDatabase() {
    try {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS subscription_plans (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          price TEXT NOT NULL,
          duration INTEGER NOT NULL,
          features TEXT NOT NULL,
          active INTEGER DEFAULT 1,
          created_at INTEGER DEFAULT (strftime('%s', 'now'))
        );

        CREATE TABLE IF NOT EXISTS subscriptions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          plan_id INTEGER NOT NULL,
          start_time INTEGER NOT NULL,
          end_time INTEGER NOT NULL,
          auto_renew INTEGER DEFAULT 1,
          active INTEGER DEFAULT 1,
          payments_made INTEGER DEFAULT 1,
          created_at INTEGER DEFAULT (strftime('%s', 'now')),
          FOREIGN KEY (plan_id) REFERENCES subscription_plans(id)
        );

        CREATE TABLE IF NOT EXISTS usage_metrics (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          api_calls INTEGER DEFAULT 0,
          storage_used INTEGER DEFAULT 0,
          bandwidth INTEGER DEFAULT 0,
          last_updated INTEGER DEFAULT (strftime('%s', 'now'))
        );

        CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
        CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_metrics(user_id);
      `);
      logger.info('Subscription database initialized');
    } catch (error) {
      logger.error('Failed to initialize subscription database', { error: error.message });
    }
  }

  async createPlan(name, price, duration, features) {
    const featuresJson = JSON.stringify(features);
    const result = await db.run(
      'INSERT INTO subscription_plans (name, price, duration, features) VALUES (?, ?, ?, ?)',
      [name, price, duration, featuresJson]
    );

    await cacheService.del('subscription:plans');
    logger.info('Created subscription plan', { planId: result.lastID, name });

    return { id: result.lastID, name, price, duration, features, active: true };
  }

  async getPlans() {
    const cached = await cacheService.get('subscription:plans');
    if (cached) return cached;

    const plans = await db.all('SELECT * FROM subscription_plans WHERE active = 1');
    const formattedPlans = plans.map(plan => ({
      ...plan,
      features: JSON.parse(plan.features),
      active: Boolean(plan.active),
    }));

    await cacheService.set('subscription:plans', formattedPlans, 300);
    return formattedPlans;
  }

  async subscribe(userId, planId, autoRenew = true) {
    const plan = await db.get('SELECT * FROM subscription_plans WHERE id = ? AND active = 1', [planId]);
    if (!plan) {
      throw new Error('Plan not found or inactive');
    }

    const currentTime = Math.floor(Date.now() / 1000);
    const endTime = currentTime + plan.duration;

    const result = await db.run(
      `INSERT INTO subscriptions (user_id, plan_id, start_time, end_time, auto_renew, active, payments_made)
       VALUES (?, ?, ?, ?, ?, 1, 1)`,
      [userId, planId, currentTime, endTime, autoRenew ? 1 : 0]
    );

    await db.run(
      `INSERT INTO usage_metrics (user_id, api_calls, storage_used, bandwidth, last_updated)
       VALUES (?, 0, 0, 0, ?)`,
      [userId, currentTime]
    );

    await cacheService.del(`subscription:${userId}`);
    logger.info('User subscribed', { userId, planId, subscriptionId: result.lastID });

    return { success: true, subscription_id: result.lastID };
  }

  async renewSubscription(userId) {
    const subscription = await db.get(
      'SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
      [userId]
    );

    if (!subscription) {
      throw new Error('No subscription found');
    }

    const plan = await db.get('SELECT * FROM subscription_plans WHERE id = ?', [subscription.plan_id]);
    if (!plan) {
      throw new Error('Plan not found');
    }

    const currentTime = Math.floor(Date.now() / 1000);
    const newEndTime = currentTime + plan.duration;

    await db.run(
      `UPDATE subscriptions SET end_time = ?, payments_made = payments_made + 1, active = 1
       WHERE id = ?`,
      [newEndTime, subscription.id]
    );

    await cacheService.del(`subscription:${userId}`);
    logger.info('Subscription renewed', { userId, subscriptionId: subscription.id });

    return { success: true };
  }

  async cancelSubscription(userId) {
    const result = await db.run(
      `UPDATE subscriptions SET auto_renew = 0, active = 0
       WHERE user_id = ? AND active = 1`,
      [userId]
    );

    await cacheService.del(`subscription:${userId}`);
    logger.info('Subscription cancelled', { userId });

    return { success: true };
  }

  async getSubscription(userId) {
    const cached = await cacheService.get(`subscription:${userId}`);
    if (cached) return cached;

    const subscription = await db.get(
      'SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
      [userId]
    );

    if (!subscription) {
      return null;
    }

    const formatted = {
      ...subscription,
      auto_renew: Boolean(subscription.auto_renew),
      active: Boolean(subscription.active),
    };

    await cacheService.set(`subscription:${userId}`, formatted, 60);
    return formatted;
  }

  async getUsage(userId) {
    const usage = await db.get('SELECT * FROM usage_metrics WHERE user_id = ?', [userId]);
    return usage || null;
  }

  async recordUsage(userId, apiCalls = 0, storage = 0, bandwidth = 0) {
    const currentTime = Math.floor(Date.now() / 1000);

    const existing = await db.get('SELECT * FROM usage_metrics WHERE user_id = ?', [userId]);

    if (existing) {
      await db.run(
        `UPDATE usage_metrics
         SET api_calls = api_calls + ?, storage_used = storage_used + ?, bandwidth = bandwidth + ?, last_updated = ?
         WHERE user_id = ?`,
        [apiCalls, storage, bandwidth, currentTime, userId]
      );
    } else {
      await db.run(
        `INSERT INTO usage_metrics (user_id, api_calls, storage_used, bandwidth, last_updated)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, apiCalls, storage, bandwidth, currentTime]
      );
    }

    logger.info('Usage recorded', { userId, apiCalls, storage, bandwidth });
    return { success: true };
  }
}

export const subscriptionService = new SubscriptionService();
