/**
 * REIT Service - Business logic for Tokenized REIT operations
 * @module services/reitService
 */

import { LRUCache } from 'lru-cache';
import { getDb } from '../database/init.js';
import logger from '../utils/logger.js';

// Cache configuration
const propertyCache = new LRUCache({
  max: 100,
  ttl: 1000 * 60 * 5, // 5 minutes
});

const investorCache = new LRUCache({
  max: 500,
  ttl: 1000 * 60 * 2, // 2 minutes
});

const statsCache = new LRUCache({
  max: 10,
  ttl: 1000 * 60 * 1, // 1 minute
});

/**
 * REIT Service class for managing tokenized real estate operations
 */
class ReitService {
  constructor() {
    this.db = null;
    this.initialized = false;
  }

  /**
   * Initialize the service and ensure database tables exist
   */
  async initialize() {
    if (this.initialized) return;

    this.db = await getDb();
    
    // Create REIT tables if they don't exist
    await this.createTables();
    
    this.initialized = true;
    logger.info('REIT Service initialized');
  }

  /**
   * Create necessary database tables
   */
  async createTables() {
    // Properties table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS reit_properties (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contract_id TEXT NOT NULL,
        property_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        location TEXT,
        total_shares INTEGER NOT NULL,
        shares_sold INTEGER DEFAULT 0,
        price_per_share INTEGER NOT NULL,
        total_valuation INTEGER NOT NULL,
        status TEXT DEFAULT 'Listed',
        target_yield_bps INTEGER DEFAULT 0,
        metadata_uri TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(contract_id, property_id)
      )
    `);

    // Investors table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS reit_investors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        address TEXT UNIQUE NOT NULL,
        total_properties INTEGER DEFAULT 0,
        total_shares INTEGER DEFAULT 0,
        total_invested INTEGER DEFAULT 0,
        total_dividends_claimed INTEGER DEFAULT 0,
        first_investment_at INTEGER,
        last_activity_at INTEGER,
        is_blacklisted INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Ownership records
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS reit_ownership (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contract_id TEXT NOT NULL,
        property_id INTEGER NOT NULL,
        investor_address TEXT NOT NULL,
        shares INTEGER NOT NULL,
        dividend_claimed INTEGER DEFAULT 0,
        last_claimed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(contract_id, property_id, investor_address)
      )
    `);

    // Dividend distributions
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS reit_distributions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contract_id TEXT NOT NULL,
        distribution_id INTEGER NOT NULL,
        property_id INTEGER NOT NULL,
        total_amount INTEGER NOT NULL,
        amount_per_share INTEGER NOT NULL,
        distribution_type TEXT NOT NULL,
        distributed_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(contract_id, distribution_id)
      )
    `);

    // Transactions log
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS reit_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contract_id TEXT NOT NULL,
        tx_hash TEXT,
        tx_type TEXT NOT NULL,
        property_id INTEGER,
        investor_address TEXT,
        amount INTEGER,
        shares INTEGER,
        status TEXT DEFAULT 'pending',
        error_message TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Events index
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS reit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contract_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_data TEXT NOT NULL,
        ledger_sequence INTEGER,
        transaction_hash TEXT,
        created_at INTEGER NOT NULL
      )
    `);

    // REIT configuration
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS reit_config (
        id INTEGER PRIMARY KEY,
        contract_id TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        symbol TEXT NOT NULL,
        admin_address TEXT NOT NULL,
        total_properties INTEGER DEFAULT 0,
        total_investors INTEGER DEFAULT 0,
        total_value_locked INTEGER DEFAULT 0,
        total_dividends_distributed INTEGER DEFAULT 0,
        platform_fee_bps INTEGER DEFAULT 100,
        min_investment INTEGER DEFAULT 10000000,
        max_investment_per_property INTEGER DEFAULT 100000000000,
        is_paused INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Create indexes for performance
    await this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_properties_status ON reit_properties(status);
      CREATE INDEX IF NOT EXISTS idx_ownership_investor ON reit_ownership(investor_address);
      CREATE INDEX IF NOT EXISTS idx_ownership_property ON reit_ownership(contract_id, property_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_investor ON reit_transactions(investor_address);
      CREATE INDEX IF NOT EXISTS idx_transactions_type ON reit_transactions(tx_type);
      CREATE INDEX IF NOT EXISTS idx_distributions_property ON reit_distributions(contract_id, property_id);
      CREATE INDEX IF NOT EXISTS idx_events_contract ON reit_events(contract_id, event_type);
    `);

    logger.info('REIT database tables created');
  }

  // ── Property Operations ───────────────────────────────────────────────────────

  /**
   * Create or update a property record
   */
  async syncProperty(contractId, propertyData) {
    await this.initialize();

    const now = Date.now();
    const {
      property_id,
      name,
      description,
      location,
      total_shares,
      shares_sold,
      price_per_share,
      total_valuation,
      status,
      target_yield_bps,
      metadata_uri,
      created_at,
    } = propertyData;

    await this.db.run(
      `INSERT INTO reit_properties 
       (contract_id, property_id, name, description, location, total_shares, 
        shares_sold, price_per_share, total_valuation, status, target_yield_bps,
        metadata_uri, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(contract_id, property_id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       location = excluded.location,
       total_shares = excluded.total_shares,
       shares_sold = excluded.shares_sold,
       price_per_share = excluded.price_per_share,
       total_valuation = excluded.total_valuation,
       status = excluded.status,
       target_yield_bps = excluded.target_yield_bps,
       metadata_uri = excluded.metadata_uri,
       updated_at = excluded.updated_at`,
      [
        contractId, property_id, name, description, location,
        total_shares, shares_sold, price_per_share, total_valuation,
        status, target_yield_bps, metadata_uri, created_at, now,
      ]
    );

    // Invalidate cache
    propertyCache.delete(`${contractId}:${property_id}`);
    
    logger.info(`Property synced: ${contractId}:${property_id}`);
    return property_id;
  }

  /**
   * Get property by ID
   */
  async getProperty(contractId, propertyId) {
    await this.initialize();

    const cacheKey = `${contractId}:${propertyId}`;
    const cached = propertyCache.get(cacheKey);
    if (cached) return cached;

    const property = await this.db.get(
      'SELECT * FROM reit_properties WHERE contract_id = ? AND property_id = ?',
      [contractId, propertyId]
    );

    if (property) {
      propertyCache.set(cacheKey, property);
    }

    return property;
  }

  /**
   * Get properties with filtering and pagination
   */
  async getProperties(filters = {}, pagination = {}) {
    await this.initialize();

    const { status, minPrice, maxPrice, location } = filters;
    const { page = 1, limit = 20 } = pagination;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (status) {
      whereClause += ' AND status = ?';
      params.push(status);
    }
    if (minPrice) {
      whereClause += ' AND price_per_share >= ?';
      params.push(minPrice);
    }
    if (maxPrice) {
      whereClause += ' AND price_per_share <= ?';
      params.push(maxPrice);
    }
    if (location) {
      whereClause += ' AND location LIKE ?';
      params.push(`%${location}%`);
    }

    // Get total count
    const countResult = await this.db.get(
      `SELECT COUNT(*) as total FROM reit_properties ${whereClause}`,
      params
    );

    // Get paginated results
    const properties = await this.db.all(
      `SELECT * FROM reit_properties ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return {
      data: properties,
      pagination: {
        page,
        limit,
        total: countResult.total,
        totalPages: Math.ceil(countResult.total / limit),
      },
    };
  }

  /**
   * Get property statistics
   */
  async getPropertyStats(contractId) {
    await this.initialize();

    const cacheKey = `stats:${contractId}`;
    const cached = statsCache.get(cacheKey);
    if (cached) return cached;

    const stats = await this.db.get(
      `SELECT 
        COUNT(*) as total_properties,
        SUM(CASE WHEN status = 'Listed' THEN 1 ELSE 0 END) as listed_count,
        SUM(CASE WHEN status = 'Active' THEN 1 ELSE 0 END) as active_count,
        SUM(CASE WHEN status = 'Funded' THEN 1 ELSE 0 END) as funded_count,
        SUM(total_valuation) as total_valuation,
        SUM(shares_sold * price_per_share) as total_funded,
        AVG(target_yield_bps) as avg_yield_bps
       FROM reit_properties 
       WHERE contract_id = ?`,
      [contractId]
    );

    statsCache.set(cacheKey, stats);
    return stats;
  }

  // ── Investor Operations ──────────────────────────────────────────────────────

  /**
   * Sync investor data
   */
  async syncInvestor(contractId, investorAddress, investorData) {
    await this.initialize();

    const now = Date.now();
    const {
      properties_count,
      total_shares,
      total_invested,
      total_dividends_claimed,
      first_investment_at,
      last_activity_at,
    } = investorData;

    await this.db.run(
      `INSERT INTO reit_investors 
       (address, total_properties, total_shares, total_invested, 
        total_dividends_claimed, first_investment_at, last_activity_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(address) DO UPDATE SET
       total_properties = excluded.total_properties,
       total_shares = excluded.total_shares,
       total_invested = excluded.total_invested,
       total_dividends_claimed = excluded.total_dividends_claimed,
       first_investment_at = COALESCE(excluded.first_investment_at, reit_investors.first_investment_at),
       last_activity_at = excluded.last_activity_at,
       updated_at = excluded.updated_at`,
      [
        investorAddress, properties_count, total_shares, total_invested,
        total_dividends_claimed, first_investment_at, last_activity_at, now, now,
      ]
    );

    investorCache.delete(investorAddress);
    
    logger.info(`Investor synced: ${investorAddress}`);
  }

  /**
   * Get investor by address
   */
  async getInvestor(address) {
    await this.initialize();

    const cached = investorCache.get(address);
    if (cached) return cached;

    const investor = await this.db.get(
      'SELECT * FROM reit_investors WHERE address = ?',
      [address]
    );

    if (investor) {
      investorCache.set(address, investor);
    }

    return investor;
  }

  /**
   * Get investor's properties
   */
  async getInvestorProperties(contractId, investorAddress) {
    await this.initialize();

    const ownership = await this.db.all(
      `SELECT o.*, p.name, p.location, p.status, p.price_per_share
       FROM reit_ownership o
       JOIN reit_properties p ON o.property_id = p.property_id AND o.contract_id = p.contract_id
       WHERE o.contract_id = ? AND o.investor_address = ? AND o.shares > 0`,
      [contractId, investorAddress]
    );

    return ownership;
  }

  /**
   * Get investor portfolio summary
   */
  async getInvestorPortfolio(contractId, investorAddress) {
    await this.initialize();

    const portfolio = await this.db.get(
      `SELECT 
        COUNT(DISTINCT o.property_id) as property_count,
        SUM(o.shares) as total_shares,
        SUM(o.shares * p.price_per_share) as portfolio_value,
        SUM(o.dividend_claimed) as total_dividends,
        AVG(p.target_yield_bps) as avg_yield_bps
       FROM reit_ownership o
       JOIN reit_properties p ON o.property_id = p.property_id AND o.contract_id = p.contract_id
       WHERE o.contract_id = ? AND o.investor_address = ?`,
      [contractId, investorAddress]
    );

    return portfolio;
  }

  // ── Ownership Operations ──────────────────────────────────────────────────

  /**
   * Sync ownership record
   */
  async syncOwnership(contractId, propertyId, investorAddress, ownershipData) {
    await this.initialize();

    const now = Date.now();
    const { shares, dividend_claimed, last_claimed_at } = ownershipData;

    await this.db.run(
      `INSERT INTO reit_ownership 
       (contract_id, property_id, investor_address, shares, dividend_claimed, last_claimed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(contract_id, property_id, investor_address) DO UPDATE SET
       shares = excluded.shares,
       dividend_claimed = excluded.dividend_claimed,
       last_claimed_at = excluded.last_claimed_at,
       updated_at = excluded.updated_at`,
      [contractId, propertyId, investorAddress, shares, dividend_claimed, last_claimed_at, now, now]
    );

    logger.info(`Ownership synced: ${investorAddress}:${propertyId}`);
  }

  // ── Distribution Operations ───────────────────────────────────────────────

  /**
   * Record a dividend distribution
   */
  async recordDistribution(contractId, distributionData) {
    await this.initialize();

    const now = Date.now();
    const {
      distribution_id,
      property_id,
      total_amount,
      amount_per_share,
      distribution_type,
      distributed_at,
    } = distributionData;

    await this.db.run(
      `INSERT INTO reit_distributions 
       (contract_id, distribution_id, property_id, total_amount, amount_per_share, 
        distribution_type, distributed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(contract_id, distribution_id) DO UPDATE SET
       total_amount = excluded.total_amount,
       amount_per_share = excluded.amount_per_share,
       distribution_type = excluded.distribution_type,
       distributed_at = excluded.distributed_at`,
      [contractId, distribution_id, property_id, total_amount, amount_per_share, 
       distribution_type, distributed_at, now]
    );

    logger.info(`Distribution recorded: ${distribution_id}`);
  }

  /**
   * Get distributions for a property
   */
  async getPropertyDistributions(contractId, propertyId, pagination = {}) {
    await this.initialize();

    const { page = 1, limit = 20 } = pagination;
    const offset = (page - 1) * limit;

    const distributions = await this.db.all(
      `SELECT * FROM reit_distributions 
       WHERE contract_id = ? AND property_id = ?
       ORDER BY distributed_at DESC LIMIT ? OFFSET ?`,
      [contractId, propertyId, limit, offset]
    );

    return distributions;
  }

  // ── Transaction Operations ──────────────────────────────────────────────────

  /**
   * Log a transaction
   */
  async logTransaction(transactionData) {
    await this.initialize();

    const now = Date.now();
    const {
      contract_id,
      tx_hash,
      tx_type,
      property_id,
      investor_address,
      amount,
      shares,
      status = 'pending',
      error_message,
    } = transactionData;

    const result = await this.db.run(
      `INSERT INTO reit_transactions 
       (contract_id, tx_hash, tx_type, property_id, investor_address, amount, shares, status, error_message, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [contract_id, tx_hash, tx_type, property_id, investor_address, amount, shares, status, error_message, now, now]
    );

    return result.lastID;
  }

  /**
   * Update transaction status
   */
  async updateTransaction(txId, status, errorMessage = null) {
    await this.initialize();

    await this.db.run(
      `UPDATE reit_transactions 
       SET status = ?, error_message = ?, updated_at = ?
       WHERE id = ?`,
      [status, errorMessage, Date.now(), txId]
    );
  }

  /**
   * Get transactions with filtering
   */
  async getTransactions(filters = {}, pagination = {}) {
    await this.initialize();

    const { 
      contract_id, 
      investor_address, 
      tx_type, 
      status,
      startDate,
      endDate,
    } = filters;
    const { page = 1, limit = 20 } = pagination;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (contract_id) {
      whereClause += ' AND contract_id = ?';
      params.push(contract_id);
    }
    if (investor_address) {
      whereClause += ' AND investor_address = ?';
      params.push(investor_address);
    }
    if (tx_type) {
      whereClause += ' AND tx_type = ?';
      params.push(tx_type);
    }
    if (status) {
      whereClause += ' AND status = ?';
      params.push(status);
    }
    if (startDate) {
      whereClause += ' AND created_at >= ?';
      params.push(startDate);
    }
    if (endDate) {
      whereClause += ' AND created_at <= ?';
      params.push(endDate);
    }

    // Get total count
    const countResult = await this.db.get(
      `SELECT COUNT(*) as total FROM reit_transactions ${whereClause}`,
      params
    );

    // Get paginated results
    const transactions = await this.db.all(
      `SELECT * FROM reit_transactions ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return {
      data: transactions,
      pagination: {
        page,
        limit,
        total: countResult.total,
        totalPages: Math.ceil(countResult.total / limit),
      },
    };
  }

  // ── Event Operations ────────────────────────────────────────────────────────

  /**
   * Index a contract event
   */
  async indexEvent(contractId, eventData) {
    await this.initialize();

    const now = Date.now();
    const { event_type, event_data, ledger_sequence, transaction_hash } = eventData;

    await this.db.run(
      `INSERT INTO reit_events 
       (contract_id, event_type, event_data, ledger_sequence, transaction_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [contractId, event_type, JSON.stringify(event_data), ledger_sequence, transaction_hash, now]
    );

    logger.info(`Event indexed: ${event_type}`);
  }

  /**
   * Get events with filtering
   */
  async getEvents(filters = {}, pagination = {}) {
    await this.initialize();

    const { contract_id, event_type, startLedger, endLedger } = filters;
    const { page = 1, limit = 50 } = pagination;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (contract_id) {
      whereClause += ' AND contract_id = ?';
      params.push(contract_id);
    }
    if (event_type) {
      whereClause += ' AND event_type = ?';
      params.push(event_type);
    }
    if (startLedger) {
      whereClause += ' AND ledger_sequence >= ?';
      params.push(startLedger);
    }
    if (endLedger) {
      whereClause += ' AND ledger_sequence <= ?';
      params.push(endLedger);
    }

    const events = await this.db.all(
      `SELECT * FROM reit_events ${whereClause} ORDER BY ledger_sequence DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // Parse event_data JSON
    events.forEach(event => {
      try {
        event.event_data = JSON.parse(event.event_data);
      } catch {
        // Keep as string if not valid JSON
      }
    });

    return events;
  }

  // ── REIT Configuration ───────────────────────────────────────────────────────

  /**
   * Sync REIT configuration
   */
  async syncReitConfig(contractId, configData) {
    await this.initialize();

    const now = Date.now();
    const {
      name,
      symbol,
      admin_address,
      total_properties,
      total_investors,
      total_value_locked,
      total_dividends_distributed,
      platform_fee_bps,
      min_investment,
      max_investment_per_property,
      is_paused,
    } = configData;

    await this.db.run(
      `INSERT INTO reit_config 
       (contract_id, name, symbol, admin_address, total_properties, total_investors,
        total_value_locked, total_dividends_distributed, platform_fee_bps,
        min_investment, max_investment_per_property, is_paused, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(contract_id) DO UPDATE SET
       name = excluded.name,
       symbol = excluded.symbol,
       admin_address = excluded.admin_address,
       total_properties = excluded.total_properties,
       total_investors = excluded.total_investors,
       total_value_locked = excluded.total_value_locked,
       total_dividends_distributed = excluded.total_dividends_distributed,
       platform_fee_bps = excluded.platform_fee_bps,
       min_investment = excluded.min_investment,
       max_investment_per_property = excluded.max_investment_per_property,
       is_paused = excluded.is_paused,
       updated_at = excluded.updated_at`,
      [contractId, name, symbol, admin_address, total_properties, total_investors,
       total_value_locked, total_dividends_distributed, platform_fee_bps,
       min_investment, max_investment_per_property, is_paused ? 1 : 0, now, now]
    );

    statsCache.delete(`stats:${contractId}`);
    logger.info(`REIT config synced: ${contractId}`);
  }

  /**
   * Get REIT configuration
   */
  async getReitConfig(contractId) {
    await this.initialize();

    return await this.db.get(
      'SELECT * FROM reit_config WHERE contract_id = ?',
      [contractId]
    );
  }

  // ── Analytics & Reporting ───────────────────────────────────────────────────

  /**
   * Get REIT performance metrics
   */
  async getPerformanceMetrics(contractId, period = '30d') {
    await this.initialize();

    const periodMs = {
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
      '90d': 90 * 24 * 60 * 60 * 1000,
      '1y': 365 * 24 * 60 * 60 * 1000,
    }[period] || 30 * 24 * 60 * 60 * 1000;

    const startTime = Date.now() - periodMs;

    const metrics = await this.db.get(
      `SELECT 
        COUNT(DISTINCT CASE WHEN created_at >= ? THEN investor_address END) as new_investors,
        SUM(CASE WHEN created_at >= ? AND tx_type = 'buy_shares' THEN amount ELSE 0 END) as total_invested,
        SUM(CASE WHEN created_at >= ? AND tx_type = 'claim_dividends' THEN amount ELSE 0 END) as total_dividends,
        COUNT(CASE WHEN created_at >= ? THEN id END) as total_transactions
       FROM reit_transactions
       WHERE contract_id = ?`,
      [startTime, startTime, startTime, startTime, contractId]
    );

    return metrics;
  }

  /**
   * Get yield analytics
   */
  async getYieldAnalytics(contractId) {
    await this.initialize();

    const analytics = await this.db.all(
      `SELECT 
        p.property_id,
        p.name,
        p.target_yield_bps,
        p.total_valuation,
        COUNT(d.id) as distribution_count,
        SUM(d.total_amount) as total_distributed,
        CASE 
          WHEN p.total_valuation > 0 
          THEN (SUM(d.total_amount) * 10000.0 / p.total_valuation) 
          ELSE 0 
        END as actual_yield_bps
       FROM reit_properties p
       LEFT JOIN reit_distributions d ON p.property_id = d.property_id AND p.contract_id = d.contract_id
       WHERE p.contract_id = ? AND p.status IN ('Active', 'Funded')
       GROUP BY p.property_id`
      , [contractId]
    );

    return analytics;
  }

  // ── Caching ───────────────────────────────────────────────────────────────

  /**
   * Clear all caches
   */
  clearCache() {
    propertyCache.clear();
    investorCache.clear();
    statsCache.clear();
    logger.info('REIT caches cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      properties: {
        size: propertyCache.size,
        hits: propertyCache.hits,
        misses: propertyCache.misses,
      },
      investors: {
        size: investorCache.size,
        hits: investorCache.hits,
        misses: investorCache.misses,
      },
      stats: {
        size: statsCache.size,
        hits: statsCache.hits,
        misses: statsCache.misses,
      },
    };
  }
}

// Export singleton instance
export const reitService = new ReitService();
export default reitService;
