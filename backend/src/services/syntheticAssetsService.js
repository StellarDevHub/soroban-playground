/**
 * Synthetic Assets Service
 * 
 * Provides business logic for synthetic asset operations including:
 * - Contract interaction (mint, burn, trading)
 * - Price oracle management
 * - Position tracking and monitoring
 * - Liquidation monitoring
 * - Real-time price updates
 */

import { invokeContract } from './invokeService.js';
import { databaseService } from './databaseService.js';
import { redisService } from './redisService.js';
import { logger } from '../utils/logger.js';

const CACHE_TTL = {
  POSITION: 30, // 30 seconds
  ASSET_PRICE: 5, // 5 seconds
  LIQUIDATION_CHECK: 10, // 10 seconds
  PROTOCOL_PARAMS: 300, // 5 minutes
};

class SyntheticAssetsService {
  constructor() {
    this.contractId = process.env.SYNTHETIC_ASSETS_CONTRACT_ID;
    this.collateralToken = process.env.COLLATERAL_TOKEN;
    this.oracleAddress = process.env.ORACLE_ADDRESS;
  }

  /**
   * Register a new synthetic asset on the contract
   */
  async registerAsset(asset) {
    try {
      const { symbol, name, decimals, initialPrice } = asset;

      const result = await invokeContract({
        contractId: this.contractId,
        method: 'register_synthetic_asset',
        params: [symbol, name, decimals, initialPrice],
        auth: true,
      });

      // Cache asset metadata
      await this.cacheAsset(asset);

      // Log the registration
      await this.logAssetEvent('REGISTER', symbol, asset);

      return { success: true, data: result };
    } catch (error) {
      logger.error('Failed to register asset:', error);
      throw error;
    }
  }

  /**
   * Mint synthetic assets with collateral
   */
  async mintSynthetic(userAddress, assetSymbol, collateralAmount, mintAmount) {
    try {
      const result = await invokeContract({
        contractId: this.contractId,
        method: 'mint_synthetic',
        params: [userAddress, assetSymbol, collateralAmount, mintAmount],
        auth: true,
      });

      // Record position in database
      const positionId = result.position_id;
      await this.recordPosition({
        positionId,
        userAddress,
        assetSymbol,
        collateralAmount,
        mintedAmount: mintAmount,
        type: 'COLLATERAL',
      });

      // Log the transaction
      await this.logAssetEvent('MINT', assetSymbol, {
        user: userAddress,
        collateral: collateralAmount,
        minted: mintAmount,
      });

      return { success: true, positionId, data: result };
    } catch (error) {
      logger.error('Failed to mint synthetic:', error);
      throw error;
    }
  }

  /**
   * Burn synthetic assets and withdraw collateral
   */
  async burnSynthetic(userAddress, positionId, burnAmount) {
    try {
      const result = await invokeContract({
        contractId: this.contractId,
        method: 'burn_synthetic',
        params: [userAddress, positionId, burnAmount],
        auth: true,
      });

      // Update position in database
      await this.updatePosition(positionId, { status: 'CLOSED' });

      // Log the transaction
      await this.logAssetEvent('BURN', positionId, {
        user: userAddress,
        burned: burnAmount,
      });

      return { success: true, data: result };
    } catch (error) {
      logger.error('Failed to burn synthetic:', error);
      throw error;
    }
  }

  /**
   * Add collateral to existing position
   */
  async addCollateral(userAddress, positionId, additionalCollateral) {
    try {
      const result = await invokeContract({
        contractId: this.contractId,
        method: 'add_collateral',
        params: [userAddress, positionId, additionalCollateral],
        auth: true,
      });

      // Update position
      await this.updatePosition(positionId, {
        collateralAdded: additionalCollateral,
        lastUpdated: new Date(),
      });

      // Clear cache for this position
      await redisService.delete(`position:${positionId}`);

      return { success: true, data: result };
    } catch (error) {
      logger.error('Failed to add collateral:', error);
      throw error;
    }
  }

  /**
   * Open a leveraged trading position
   */
  async openTrade(userAddress, assetSymbol, direction, margin, leverage) {
    try {
      const result = await invokeContract({
        contractId: this.contractId,
        method: 'open_trade',
        params: [userAddress, assetSymbol, direction, margin, leverage],
        auth: true,
      });

      const positionId = result;

      // Record trading position
      await this.recordPosition({
        positionId,
        userAddress,
        assetSymbol,
        margin,
        leverage,
        direction,
        type: 'TRADING',
      });

      // Log the trade
      await this.logAssetEvent('OPEN_TRADE', assetSymbol, {
        user: userAddress,
        direction,
        margin,
        leverage,
      });

      return { success: true, positionId, data: result };
    } catch (error) {
      logger.error('Failed to open trade:', error);
      throw error;
    }
  }

  /**
   * Close a trading position
   */
  async closeTrade(userAddress, positionId) {
    try {
      const result = await invokeContract({
        contractId: this.contractId,
        method: 'close_trade',
        params: [userAddress, positionId],
        auth: true,
      });

      // Update position
      await this.updatePosition(positionId, { status: 'CLOSED' });

      // Clear cache
      await redisService.delete(`trade:${positionId}`);

      // Log the closure
      await this.logAssetEvent('CLOSE_TRADE', positionId, {
        user: userAddress,
        finalAmount: result,
      });

      return { success: true, finalAmount: result, data: result };
    } catch (error) {
      logger.error('Failed to close trade:', error);
      throw error;
    }
  }

  /**
   * Get position details with caching
   */
  async getPosition(positionId) {
    try {
      // Try cache first
      const cached = await redisService.get(`position:${positionId}`);
      if (cached) {
        return JSON.parse(cached);
      }

      const result = await invokeContract({
        contractId: this.contractId,
        method: 'get_position',
        params: [positionId],
        auth: false,
      });

      // Cache the result
      await redisService.set(
        `position:${positionId}`,
        JSON.stringify(result),
        CACHE_TTL.POSITION
      );

      return result;
    } catch (error) {
      logger.error(`Failed to get position ${positionId}:`, error);
      throw error;
    }
  }

  /**
   * Get trading position details
   */
  async getTradingPosition(positionId) {
    try {
      const cached = await redisService.get(`trade:${positionId}`);
      if (cached) {
        return JSON.parse(cached);
      }

      const result = await invokeContract({
        contractId: this.contractId,
        method: 'get_trading_position_info',
        params: [positionId],
        auth: false,
      });

      await redisService.set(
        `trade:${positionId}`,
        JSON.stringify(result),
        CACHE_TTL.POSITION
      );

      return result;
    } catch (error) {
      logger.error(`Failed to get trading position ${positionId}:`, error);
      throw error;
    }
  }

  /**
   * Update asset price
   */
  async updatePrice(assetSymbol, newPrice, confidence) {
    try {
      const result = await invokeContract({
        contractId: this.contractId,
        method: 'update_price',
        params: [assetSymbol, newPrice, confidence],
        auth: true,
      });

      // Invalidate price cache
      await redisService.delete(`price:${assetSymbol}`);

      // Log price update
      await this.logAssetEvent('PRICE_UPDATE', assetSymbol, {
        newPrice,
        confidence,
        timestamp: new Date(),
      });

      // Broadcast via WebSocket
      this.broadcastPriceUpdate(assetSymbol, newPrice);

      return { success: true, data: result };
    } catch (error) {
      logger.error(`Failed to update price for ${assetSymbol}:`, error);
      throw error;
    }
  }

  /**
   * Get current asset price with caching
   */
  async getAssetPrice(assetSymbol) {
    try {
      const cached = await redisService.get(`price:${assetSymbol}`);
      if (cached) {
        return JSON.parse(cached);
      }

      const result = await invokeContract({
        contractId: this.contractId,
        method: 'get_validated_asset_price',
        params: [assetSymbol],
        auth: false,
      });

      await redisService.set(
        `price:${assetSymbol}`,
        JSON.stringify(result),
        CACHE_TTL.ASSET_PRICE
      );

      return result;
    } catch (error) {
      logger.error(`Failed to get price for ${assetSymbol}:`, error);
      throw error;
    }
  }

  /**
   * Get collateral ratio for a position
   */
  async getCollateralRatio(positionId) {
    try {
      const result = await invokeContract({
        contractId: this.contractId,
        method: 'get_collateral_ratio',
        params: [positionId],
        auth: false,
      });

      return result;
    } catch (error) {
      logger.error(`Failed to get collateral ratio for ${positionId}:`, error);
      throw error;
    }
  }

  /**
   * Get health factor for a position
   */
  async getHealthFactor(positionId) {
    try {
      const result = await invokeContract({
        contractId: this.contractId,
        method: 'get_health_factor',
        params: [positionId],
        auth: false,
      });

      return result;
    } catch (error) {
      logger.error(`Failed to get health factor for ${positionId}:`, error);
      throw error;
    }
  }

  /**
   * Check if position is liquidatable
   */
  async isLiquidatable(positionId) {
    try {
      const cached = await redisService.get(`liquidatable:${positionId}`);
      if (cached !== null) {
        return JSON.parse(cached);
      }

      const result = await invokeContract({
        contractId: this.contractId,
        method: 'is_liquidatable',
        params: [positionId],
        auth: false,
      });

      await redisService.set(
        `liquidatable:${positionId}`,
        JSON.stringify(result),
        CACHE_TTL.LIQUIDATION_CHECK
      );

      return result;
    } catch (error) {
      logger.error(`Failed to check liquidation for ${positionId}:`, error);
      throw error;
    }
  }

  /**
   * Get protocol parameters with caching
   */
  async getProtocolParams() {
    try {
      const cached = await redisService.get('protocol:params');
      if (cached) {
        return JSON.parse(cached);
      }

      const result = await invokeContract({
        contractId: this.contractId,
        method: 'get_protocol_params',
        params: [],
        auth: false,
      });

      await redisService.set(
        'protocol:params',
        JSON.stringify(result),
        CACHE_TTL.PROTOCOL_PARAMS
      );

      return result;
    } catch (error) {
      logger.error('Failed to get protocol params:', error);
      throw error;
    }
  }

  /**
   * Update protocol parameters (admin only)
   */
  async updateProtocolParams(minCollateralRatio, liquidationThreshold, liquidationBonus, feePercentage) {
    try {
      const result = await invokeContract({
        contractId: this.contractId,
        method: 'update_protocol_params',
        params: [minCollateralRatio, liquidationThreshold, liquidationBonus, feePercentage],
        auth: true,
      });

      // Invalidate cache
      await redisService.delete('protocol:params');

      // Log the update
      await this.logAssetEvent('UPDATE_PROTOCOL_PARAMS', 'SYSTEM', {
        minCollateralRatio,
        liquidationThreshold,
        liquidationBonus,
        feePercentage,
      });

      return { success: true, data: result };
    } catch (error) {
      logger.error('Failed to update protocol params:', error);
      throw error;
    }
  }

  /**
   * Get maximum mintable amount for given collateral
   */
  async getMaxMintable(assetSymbol, collateralAmount) {
    try {
      const result = await invokeContract({
        contractId: this.contractId,
        method: 'get_max_mintable',
        params: [assetSymbol, collateralAmount],
        auth: false,
      });

      return result;
    } catch (error) {
      logger.error('Failed to calculate max mintable:', error);
      throw error;
    }
  }

  /**
   * Get trading PnL
   */
  async getTradingPnL(positionId) {
    try {
      const result = await invokeContract({
        contractId: this.contractId,
        method: 'get_trading_pnl',
        params: [positionId],
        auth: false,
      });

      return result;
    } catch (error) {
      logger.error(`Failed to get trading PnL for ${positionId}:`, error);
      throw error;
    }
  }

  /**
   * Get registered assets
   */
  async getRegisteredAssets() {
    try {
      const cached = await redisService.get('assets:registered');
      if (cached) {
        return JSON.parse(cached);
      }

      const result = await invokeContract({
        contractId: this.contractId,
        method: 'get_registered_assets',
        params: [],
        auth: false,
      });

      await redisService.set(
        'assets:registered',
        JSON.stringify(result),
        CACHE_TTL.PROTOCOL_PARAMS
      );

      return result;
    } catch (error) {
      logger.error('Failed to get registered assets:', error);
      throw error;
    }
  }

  /**
   * Monitor positions for liquidation
   */
  async monitorLiquidations() {
    try {
      const positions = await databaseService.query(
        'SELECT position_id FROM positions WHERE status = $1 AND type = $2',
        ['OPEN', 'COLLATERAL']
      );

      for (const position of positions.rows) {
        const isLiquidatable = await this.isLiquidatable(position.position_id);
        if (isLiquidatable) {
          await this.recordLiquidationAlert(position.position_id);
          this.broadcastLiquidationAlert(position.position_id);
        }
      }
    } catch (error) {
      logger.error('Error monitoring liquidations:', error);
    }
  }

  // Helper methods

  async recordPosition(positionData) {
    const {
      positionId,
      userAddress,
      assetSymbol,
      collateralAmount,
      mintedAmount,
      margin,
      leverage,
      direction,
      type,
    } = positionData;

    await databaseService.query(
      `INSERT INTO positions (position_id, user_address, asset_symbol, collateral_amount, 
       minted_amount, margin, leverage, direction, type, status, created_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
      [positionId, userAddress, assetSymbol, collateralAmount, mintedAmount, margin, leverage, direction, type, 'OPEN']
    );
  }

  async updatePosition(positionId, updates) {
    const fields = Object.keys(updates).map((key, i) => `${key} = $${i + 2}`);
    const values = Object.values(updates);

    await databaseService.query(
      `UPDATE positions SET ${fields.join(', ')}, updated_at = NOW() WHERE position_id = $1`,
      [positionId, ...values]
    );
  }

  async logAssetEvent(eventType, subject, details) {
    await databaseService.query(
      `INSERT INTO synthetic_asset_events (event_type, subject, details, created_at) 
       VALUES ($1, $2, $3, NOW())`,
      [eventType, subject, JSON.stringify(details)]
    );
  }

  async recordLiquidationAlert(positionId) {
    await databaseService.query(
      `INSERT INTO liquidation_alerts (position_id, alerted_at) VALUES ($1, NOW())
       ON CONFLICT (position_id) DO UPDATE SET alerted_at = NOW()`,
      [positionId]
    );
  }

  async cacheAsset(asset) {
    await redisService.set(
      `asset:${asset.symbol}`,
      JSON.stringify(asset),
      CACHE_TTL.PROTOCOL_PARAMS
    );
  }

  broadcastPriceUpdate(assetSymbol, price) {
    // Implement WebSocket broadcast
    // This will be connected to the WebSocket handler
    if (global.priceUpdateSubscribers) {
      global.priceUpdateSubscribers.forEach(callback => {
        callback({ assetSymbol, price });
      });
    }
  }

  broadcastLiquidationAlert(positionId) {
    if (global.liquidationAlertSubscribers) {
      global.liquidationAlertSubscribers.forEach(callback => {
        callback({ positionId });
      });
    }
  }
}

export const syntheticAssetsService = new SyntheticAssetsService();
