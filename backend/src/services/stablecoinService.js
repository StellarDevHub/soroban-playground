import { dbService } from './dbService.js';
import cacheService from './cacheService.js';

const CACHE_PREFIX = 'stablecoin:';
const CACHE_TTL = 60; // 1 minute

class StablecoinService {
  constructor() {
    this.contractId = process.env.STABLECOIN_CONTRACT_ID || null;
    this.initialized = false;
  }

  async initialize(contractId) {
    this.contractId = contractId;
    this.initialized = true;
    
    // Initialize tables if needed
    await this._initTables();
  }

  async _initTables() {
    const db = await dbService.getDb();
    
    // Price history table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS stablecoin_price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        price INTEGER NOT NULL,
        target_price INTEGER NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Rebase history table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS stablecoin_rebase_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        old_supply INTEGER NOT NULL,
        new_supply INTEGER NOT NULL,
        price INTEGER NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Transaction history table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS stablecoin_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        address TEXT NOT NULL,
        type TEXT NOT NULL,
        amount INTEGER,
        from_address TEXT,
        to_address TEXT,
        tx_hash TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  async getMetrics() {
    const cacheKey = `${CACHE_PREFIX}metrics`;
    const cached = await cacheService.get(cacheKey);
    if (cached) return cached;

    // Simulate metrics data (in production, this would come from the contract)
    const metrics = {
      totalSupply: '1000000000000',
      totalReserve: '950000000000',
      collateralizationRatio: 0.95,
      currentPrice: 1.00,
      targetPrice: 1.00,
      priceDeviation: 0,
      lastRebase: new Date(Date.now() - 3600000).toISOString(),
      rebaseCount: 24,
      holders: 1543,
      volume24h: '50000000000',
      marketCap: '1000000000000'
    };

    await cacheService.set(cacheKey, metrics, CACHE_TTL);
    return metrics;
  }

  async getPriceHistory(days = 30) {
    const cacheKey = `${CACHE_PREFIX}price_history:${days}`;
    const cached = await cacheService.get(cacheKey);
    if (cached) return cached;

    const db = await dbService.getDb();
    const history = await db.all(`
      SELECT price, target_price, timestamp
      FROM stablecoin_price_history
      WHERE timestamp >= datetime('now', '-${days} days')
      ORDER BY timestamp ASC
    `);

    // If no data, generate simulated history
    if (history.length === 0) {
      const simulated = this._generateSimulatedPriceHistory(days);
      await cacheService.set(cacheKey, simulated, CACHE_TTL);
      return simulated;
    }

    await cacheService.set(cacheKey, history, CACHE_TTL);
    return history;
  }

  _generateSimulatedPriceHistory(days) {
    const history = [];
    const now = Date.now();
    
    for (let i = days; i >= 0; i--) {
      const timestamp = new Date(now - i * 24 * 60 * 60 * 1000).toISOString();
      // Generate price around $1.00 with small variance
      const variance = (Math.random() - 0.5) * 0.02;
      const price = 1.00 + variance;
      
      history.push({
        price: Math.round(price * 10000000),
        target_price: 10000000,
        timestamp
      });
    }
    
    return history;
  }

  async getRebaseHistory(limit = 50) {
    const cacheKey = `${CACHE_PREFIX}rebase_history:${limit}`;
    const cached = await cacheService.get(cacheKey);
    if (cached) return cached;

    const db = await dbService.getDb();
    const history = await db.all(`
      SELECT old_supply, new_supply, price, timestamp
      FROM stablecoin_rebase_history
      ORDER BY timestamp DESC
      LIMIT ?
    `, [limit]);

    // If no data, return empty array
    await cacheService.set(cacheKey, history, CACHE_TTL);
    return history;
  }

  async getReserveInfo() {
    const cacheKey = `${CACHE_PREFIX}reserve`;
    const cached = await cacheService.get(cacheKey);
    if (cached) return cached;

    // Simulated reserve data
    const reserve = {
      totalReserve: '950000000000',
      targetReserve: '1000000000000',
      reserveRatio: 0.95,
      assets: [
        { asset: 'XLM', amount: '400000000000', value: '400000000000' },
        { asset: 'USDC', amount: '300000000000', value: '300000000000' },
        { asset: 'BTC', amount: '8333', value: '250000000000' }
      ],
      lastUpdated: new Date().toISOString()
    };

    await cacheService.set(cacheKey, reserve, CACHE_TTL);
    return reserve;
  }

  async getContractStatus() {
    const cacheKey = `${CACHE_PREFIX}status`;
    const cached = await cacheService.get(cacheKey);
    if (cached) return cached;

    const status = {
      initialized: true,
      paused: false,
      contractId: this.contractId,
      targetPrice: '1.00',
      rebaseCooldown: 3600,
      lastRebase: new Date(Date.now() - 3600000).toISOString(),
      nextRebase: new Date(Date.now() + 3600000).toISOString()
    };

    await cacheService.set(cacheKey, status, CACHE_TTL);
    return status;
  }

  async updatePrice(price, signature) {
    // In production, verify oracle signature and submit to contract
    const db = await dbService.getDb();
    
    await db.run(`
      INSERT INTO stablecoin_price_history (price, target_price)
      VALUES (?, ?)
    `, [price * 10000000, 10000000]);

    await cacheService.del(`${CACHE_PREFIX}metrics`);
    await cacheService.del(`${CACHE_PREFIX}price_history`);

    return {
      success: true,
      price,
      timestamp: new Date().toISOString()
    };
  }

  async triggerRebase(adminKey) {
    // In production, invoke contract rebase function
    const db = await dbService.getDb();
    const metrics = await this.getMetrics();
    
    const oldSupply = parseInt(metrics.totalSupply);
    // Simulate rebase effect
    const newSupply = Math.floor(oldSupply * 1.001);
    
    await db.run(`
      INSERT INTO stablecoin_rebase_history (old_supply, new_supply, price)
      VALUES (?, ?, ?)
    `, [oldSupply, newSupply, 10000000]);

    await cacheService.del(`${CACHE_PREFIX}metrics`);
    await cacheService.del(`${CACHE_PREFIX}rebase_history`);

    return {
      success: true,
      oldSupply: oldSupply.toString(),
      newSupply: newSupply.toString(),
      timestamp: new Date().toISOString()
    };
  }

  async getBalance(address) {
    // In production, query contract
    return {
      address,
      balance: '1000000',
      formatted: '100.00'
    };
  }

  async getTransactions(address, limit = 20) {
    const db = await dbService.getDb();
    const transactions = await db.all(`
      SELECT type, amount, from_address, to_address, tx_hash, timestamp
      FROM stablecoin_transactions
      WHERE address = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `, [address, limit]);

    // If no transactions, return sample data
    if (transactions.length === 0) {
      return this._generateSampleTransactions(address, limit);
    }

    return transactions;
  }

  _generateSampleTransactions(address, limit) {
    const types = ['mint', 'burn', 'transfer'];
    const transactions = [];
    
    for (let i = 0; i < Math.min(limit, 5); i++) {
      transactions.push({
        type: types[i % types.length],
        amount: '100000',
        from_address: i % 2 === 0 ? address : 'GABCD...',
        to_address: i % 2 === 0 ? 'GABCD...' : address,
        tx_hash: '0x' + Math.random().toString(16).substr(2, 40),
        timestamp: new Date(Date.now() - i * 86400000).toISOString()
      });
    }
    
    return transactions;
  }

  async pause(adminKey) {
    // In production, invoke contract pause
    await cacheService.del(`${CACHE_PREFIX}status`);
    
    return {
      success: true,
      paused: true,
      timestamp: new Date().toISOString()
    };
  }

  async unpause(adminKey) {
    // In production, invoke contract unpause
    await cacheService.del(`${CACHE_PREFIX}status`);
    
    return {
      success: true,
      paused: false,
      timestamp: new Date().toISOString()
    };
  }

  async addReserve(adminKey, amount) {
    // In production, invoke contract add_reserve
    await cacheService.del(`${CACHE_PREFIX}reserve`);
    await cacheService.del(`${CACHE_PREFIX}metrics`);
    
    return {
      success: true,
      amount,
      timestamp: new Date().toISOString()
    };
  }

  async withdrawReserve(adminKey, amount) {
    // In production, invoke contract withdraw_reserve
    await cacheService.del(`${CACHE_PREFIX}reserve`);
    await cacheService.del(`${CACHE_PREFIX}metrics`);
    
    return {
      success: true,
      amount,
      timestamp: new Date().toISOString()
    };
  }
}

export default new StablecoinService();
