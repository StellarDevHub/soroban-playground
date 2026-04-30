// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT
//
// In-memory mirror of the on-chain data-marketplace state. The Rust contract
// is the source of truth — this service projects derived views (active listings,
// per-dataset usage, per-buyer spend) so the frontend dashboard renders without
// per-request RPC chatter.
//
// All write methods mirror the contract's checks-effects-events ordering and
// throw HTTP-compatible errors that the route layer converts to JSON responses.

import crypto from 'crypto';
import { EventEmitter } from 'events';

const nowSec = () => Math.floor(Date.now() / 1000);

class DataMarketplaceService extends EventEmitter {
  constructor() {
    super();
    this.providers = new Map();          // address -> profile
    this.datasets = new Map();           // id -> dataset
    this.providerDatasets = new Map();   // address -> Set<id>
    this.licenses = new Map();           // `${id}|${buyer}` -> license
    this.datasetBuyers = new Map();      // id -> Set<buyer>
    this.datasetStats = new Map();       // id -> stats
    this.buyerStats = new Map();         // buyer -> stats
    this.queryReceipts = new Map();      // commitment(hex) -> receipt
    this.activeIds = [];                 // ring of recently listed ids
    this.ACTIVE_CAP = 100;
    this.nextId = 1;
  }

  // ── Providers ────────────────────────────────────────────────────────────

  registerProvider({ address, name, contactHash }) {
    if (this.providers.has(address)) throw httpError(409, 'Provider already registered');
    const profile = { address, name, contactHash, createdAt: nowSec() };
    this.providers.set(address, profile);
    this.providerDatasets.set(address, new Set());
    this.emit('provider:registered', profile);
    return profile;
  }

  getProvider(address) {
    return this.providers.get(address) || null;
  }

  // ── Datasets ─────────────────────────────────────────────────────────────

  listDataset({
    provider,
    title,
    schemaHash,
    manifestHash,
    encryptionPubkey,
    flatPrice = 0,
    pricePerQuery = 0,
    licenseSeconds,
  }) {
    this.requireProvider(provider);
    if (Number(flatPrice) < 0 || Number(pricePerQuery) < 0) {
      throw httpError(400, 'prices must be >= 0');
    }
    if (!Number.isFinite(Number(licenseSeconds)) || Number(licenseSeconds) <= 0) {
      throw httpError(400, 'licenseSeconds must be > 0');
    }
    const id = this.nextId++;
    const dataset = {
      id,
      provider,
      title,
      schemaHash,
      manifestHash,
      encryptionPubkey,
      flatPrice: Number(flatPrice),
      pricePerQuery: Number(pricePerQuery),
      licenseSeconds: Number(licenseSeconds),
      listedAt: nowSec(),
      delisted: false,
    };
    this.datasets.set(id, dataset);
    this.providerDatasets.get(provider).add(id);
    this.datasetBuyers.set(id, new Set());
    this.datasetStats.set(id, emptyDatasetStats());
    this.activeIds.unshift(id);
    if (this.activeIds.length > this.ACTIVE_CAP) this.activeIds.pop();
    this.emit('dataset:listed', dataset);
    return dataset;
  }

  updateDatasetPrice({ provider, id, flatPrice, pricePerQuery }) {
    const dataset = this.requireDataset(id);
    if (dataset.provider !== provider) throw httpError(403, 'Only the provider can update price');
    if (dataset.delisted) throw httpError(409, 'Dataset is delisted');
    if (flatPrice !== undefined) {
      const v = Number(flatPrice);
      if (v < 0) throw httpError(400, 'flatPrice must be >= 0');
      dataset.flatPrice = v;
    }
    if (pricePerQuery !== undefined) {
      const v = Number(pricePerQuery);
      if (v < 0) throw httpError(400, 'pricePerQuery must be >= 0');
      dataset.pricePerQuery = v;
    }
    return dataset;
  }

  delistDataset({ provider, id }) {
    const dataset = this.requireDataset(id);
    if (dataset.provider !== provider) throw httpError(403, 'Only the provider can delist');
    if (!dataset.delisted) {
      dataset.delisted = true;
      this.emit('dataset:delisted', dataset);
    }
    return dataset;
  }

  getDataset(id) {
    return this.datasets.get(Number(id)) || null;
  }

  getProviderDatasets(provider) {
    this.requireProvider(provider);
    return Array.from(this.providerDatasets.get(provider) || []).map((id) => this.datasets.get(id));
  }

  listActiveDatasets({ limit = 50 } = {}) {
    return this.activeIds
      .slice(0, Number(limit))
      .map((id) => this.datasets.get(id))
      .filter((d) => d && !d.delisted);
  }

  // ── Licenses ─────────────────────────────────────────────────────────────

  purchaseAccess({ buyer, datasetId, maxQueries }) {
    const dataset = this.requireDataset(datasetId);
    if (dataset.delisted) throw httpError(409, 'Dataset is delisted');
    if (buyer === dataset.provider) throw httpError(400, 'Providers cannot purchase their own datasets');
    const qty = Number(maxQueries);
    if (!Number.isInteger(qty) || qty <= 0) throw httpError(400, 'maxQueries must be a positive integer');
    const cost = dataset.flatPrice + dataset.pricePerQuery * qty;
    const now = nowSec();
    const key = lkey(datasetId, buyer);
    const existing = this.licenses.get(key);
    const wasActive = existing && existing.expiresAt > now && existing.queriesUsed < existing.queriesTotal;

    const license = wasActive
      ? {
          ...existing,
          expiresAt: existing.expiresAt + dataset.licenseSeconds,
          queriesTotal: existing.queriesTotal + qty,
          totalPaid: existing.totalPaid + cost,
        }
      : {
          datasetId,
          buyer,
          purchasedAt: now,
          expiresAt: now + dataset.licenseSeconds,
          queriesTotal: qty,
          queriesUsed: 0,
          totalPaid: cost,
        };
    this.licenses.set(key, license);

    const ds = this.datasetStats.get(datasetId);
    ds.revenue += cost;
    if (!wasActive) {
      ds.licenseCount += 1;
      ds.activeBuyers += 1;
      this.datasetBuyers.get(datasetId).add(buyer);
    }
    const buyerStats = this.buyerStats.get(buyer) || emptyBuyerStats();
    buyerStats.totalSpent += cost;
    if (!wasActive) buyerStats.licensesPurchased += 1;
    this.buyerStats.set(buyer, buyerStats);

    this.emit('license:purchased', { license, dataset });
    return license;
  }

  getLicense(datasetId, buyer) {
    return this.licenses.get(lkey(Number(datasetId), buyer)) || null;
  }

  // ── Privacy-preserving query receipts ────────────────────────────────────

  /// Submit a SHA-256 commitment of (query || nonce || buyer_pubkey) — the raw
  /// query never reaches the service.
  submitQuery({ buyer, datasetId, commitment }) {
    const dataset = this.requireDataset(datasetId);
    if (buyer === dataset.provider) throw httpError(400, 'Providers cannot query their own datasets');
    if (!isHex32(commitment)) throw httpError(400, 'commitment must be a 32-byte hex string');
    const cmt = commitment.toLowerCase();
    if (this.queryReceipts.has(cmt)) throw httpError(409, 'Commitment already used');

    const key = lkey(datasetId, buyer);
    const license = this.licenses.get(key);
    if (!license) throw httpError(404, 'License not found');
    const now = nowSec();
    if (license.expiresAt <= now) throw httpError(410, 'License expired');
    if (license.queriesUsed >= license.queriesTotal) throw httpError(402, 'No quota remaining');

    license.queriesUsed += 1;
    const receipt = {
      commitment: cmt,
      datasetId,
      buyer,
      timestamp: now,
      sequence: license.queriesUsed,
    };
    this.queryReceipts.set(cmt, receipt);

    const ds = this.datasetStats.get(datasetId);
    ds.queriesExecuted += 1;
    const buyerStats = this.buyerStats.get(buyer) || emptyBuyerStats();
    buyerStats.queriesExecuted += 1;
    this.buyerStats.set(buyer, buyerStats);

    this.emit('query:submitted', receipt);
    return receipt;
  }

  getQueryReceipt(commitment) {
    if (!isHex32(commitment)) throw httpError(400, 'commitment must be a 32-byte hex string');
    return this.queryReceipts.get(commitment.toLowerCase()) || null;
  }

  /// Verify that a (preimage) hashes to a recorded commitment. Used for
  /// dispute resolution when a buyer reveals their query off-chain.
  verifyCommitment(commitment, preimageHex) {
    if (!isHex32(commitment) || !/^[A-Fa-f0-9]+$/.test(preimageHex)) {
      throw httpError(400, 'commitment and preimage must be hex');
    }
    const buf = Buffer.from(preimageHex, 'hex');
    const computed = crypto.createHash('sha256').update(buf).digest('hex');
    return computed.toLowerCase() === commitment.toLowerCase();
  }

  // ── Analytics ────────────────────────────────────────────────────────────

  getDatasetStats(id) {
    const stats = this.datasetStats.get(Number(id));
    if (!stats) throw httpError(404, 'Dataset not found');
    return { ...stats };
  }

  getBuyerStats(buyer) {
    return { ...(this.buyerStats.get(buyer) || emptyBuyerStats()) };
  }

  getDatasetBuyers(id, { limit = 100, offset = 0 } = {}) {
    const dataset = this.requireDataset(id);
    const now = nowSec();
    const rows = Array.from(this.datasetBuyers.get(dataset.id) || [])
      .map((buyer) => this.licenses.get(lkey(dataset.id, buyer)))
      .filter(Boolean)
      .map((lic) => ({ ...lic, active: lic.expiresAt > now && lic.queriesUsed < lic.queriesTotal }));
    return rows.slice(Number(offset), Number(offset) + Number(limit));
  }

  getPlatformAnalytics() {
    let activeListings = 0;
    let totalRevenue = 0;
    let totalQueries = 0;
    for (const dataset of this.datasets.values()) {
      if (!dataset.delisted) activeListings += 1;
    }
    for (const stats of this.datasetStats.values()) {
      totalRevenue += stats.revenue;
      totalQueries += stats.queriesExecuted;
    }
    return {
      providers: this.providers.size,
      datasets: this.datasets.size,
      activeListings,
      buyers: this.buyerStats.size,
      totalRevenue,
      totalQueries,
      timestamp: new Date().toISOString(),
    };
  }

  reset() {
    this.providers.clear();
    this.datasets.clear();
    this.providerDatasets.clear();
    this.licenses.clear();
    this.datasetBuyers.clear();
    this.datasetStats.clear();
    this.buyerStats.clear();
    this.queryReceipts.clear();
    this.activeIds = [];
    this.nextId = 1;
  }

  requireProvider(address) {
    const profile = this.providers.get(address);
    if (!profile) throw httpError(404, 'Provider not found');
    return profile;
  }

  requireDataset(id) {
    const dataset = this.datasets.get(Number(id));
    if (!dataset) throw httpError(404, 'Dataset not found');
    return dataset;
  }
}

function lkey(datasetId, buyer) {
  return `${datasetId}|${buyer}`;
}

function isHex32(value) {
  return typeof value === 'string' && /^[A-Fa-f0-9]{64}$/.test(value);
}

function emptyDatasetStats() {
  return { licenseCount: 0, activeBuyers: 0, queriesExecuted: 0, revenue: 0 };
}

function emptyBuyerStats() {
  return { licensesPurchased: 0, queriesExecuted: 0, totalSpent: 0 };
}

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

const dataMarketplaceService = new DataMarketplaceService();
export default dataMarketplaceService;
export { DataMarketplaceService };
