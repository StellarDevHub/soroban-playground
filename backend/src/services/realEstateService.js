import { invokeSorobanContract } from './invokeService.js';
import { getDb } from '../database/connection.js';
import { cacheGet, cacheSet } from './cacheService.js';
import { EventEmitter } from 'events';

export const realEstateEvents = new EventEmitter();

export const realEstateService = {
  async listProperty(request) {
    const result = await invokeSorobanContract({
      contractId: request.contractId,
      functionName: 'list_property',
      args: {
        owner: request.owner,
        name: request.name,
        total_shares: request.totalShares,
        price_per_share: request.pricePerShare,
        metadata_url: request.metadataUrl
      }
    });

    if (result.success) {
      const propertyId = result.parsed;
      const db = await getDb();
      await db.run(
        `INSERT INTO real_estate_properties (id, owner_address, name, total_shares, price_per_share, metadata_url) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [propertyId, request.owner, request.name, request.totalShares, request.pricePerShare, request.metadataUrl]
      );
      realEstateEvents.emit('update', { type: 'property_listed', propertyId });
    }

    return result;
  },

  async buyShares(request) {
    const result = await invokeSorobanContract({
      contractId: request.contractId,
      functionName: 'buy_shares',
      args: {
        buyer: request.buyer,
        property_id: request.propertyId,
        amount: request.amount,
        payment_token: request.paymentToken
      }
    });

    if (result.success) {
      const db = await getDb();
      
      // Update local DB
      await db.run(
        `INSERT INTO real_estate_ownership (property_id, owner_address, shares) 
         VALUES (?, ?, ?) 
         ON CONFLICT(property_id, owner_address) DO UPDATE SET shares = shares + ?`,
        [request.propertyId, request.buyer, request.amount, request.amount]
      );
      
      await db.run(
        `UPDATE real_estate_properties SET sold_shares = sold_shares + ? WHERE id = ?`,
        [request.amount, request.propertyId]
      );

      realEstateEvents.emit('update', { type: 'shares_purchased', propertyId: request.propertyId, buyer: request.buyer });
    }

    return result;
  },

  async depositRent(request) {
    const result = await invokeSorobanContract({
      contractId: request.contractId,
      functionName: 'deposit_rent',
      args: {
        property_id: request.propertyId,
        amount: request.amount,
        payment_token: request.paymentToken
      }
    });

    if (result.success) {
      const db = await getDb();
      await db.run(
        `INSERT INTO real_estate_rent_deposits (property_id, amount) VALUES (?, ?)`,
        [request.propertyId, request.amount]
      );
      realEstateEvents.emit('update', { type: 'rent_deposited', propertyId: request.propertyId });
    }

    return result;
  },

  async getPortfolio(address) {
    const db = await getDb();
    const holdings = await db.all(
      `SELECT p.*, o.shares 
       FROM real_estate_ownership o 
       JOIN real_estate_properties p ON o.property_id = p.id 
       WHERE o.owner_address = ?`,
      [address]
    );
    return holdings;
  }
};
