// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Airdrop service — in-memory store with optional Redis caching.
 * In production this would persist to a database and interact with
 * the deployed Soroban contract via Stellar SDK.
 */

import cacheService from './cacheService.js';
import logger from '../utils/logger.js';

// ── In-memory store (replace with DB in production) ───────────────────────────

const campaigns = new Map();
let nextId = 1;

// ── Helpers ───────────────────────────────────────────────────────────────────

function campaignCacheKey(id) {
  return `airdrop:campaign:${id}`;
}

function listCacheKey() {
  return 'airdrop:campaigns:list';
}

// ── Service methods ───────────────────────────────────────────────────────────

export async function createCampaign({
  admin,
  token,
  amountPerClaim,
  totalAmount,
  startTimestamp,
  endTimestamp,
  requireAllowlist,
  name,
  description,
}) {
  const id = nextId++;
  const campaign = {
    id,
    admin,
    token,
    amountPerClaim: Number(amountPerClaim),
    totalAmount: Number(totalAmount),
    claimedAmount: 0,
    startTimestamp: Number(startTimestamp),
    endTimestamp: Number(endTimestamp),
    requireAllowlist: Boolean(requireAllowlist),
    name: name || `Campaign #${id}`,
    description: description || '',
    status: 'active',
    allowlist: new Set(),
    claimed: new Set(),
    createdAt: Date.now(),
  };

  campaigns.set(id, campaign);

  // Invalidate list cache
  await cacheService.delete(listCacheKey()).catch(() => {});

  logger.info('Airdrop campaign created', { id, admin, token, totalAmount });
  return serializeCampaign(campaign);
}

export async function getCampaign(id) {
  const cacheKey = campaignCacheKey(id);

  // Try cache first
  const cached = await cacheService.get(cacheKey).catch(() => null);
  if (cached) return JSON.parse(cached);

  const campaign = campaigns.get(Number(id));
  if (!campaign) return null;

  const serialized = serializeCampaign(campaign);
  await cacheService.set(cacheKey, JSON.stringify(serialized), 30).catch(() => {});
  return serialized;
}

export async function listCampaigns({ status, page = 1, limit = 20 } = {}) {
  let list = Array.from(campaigns.values());

  if (status) {
    list = list.filter((c) => c.status === status);
  }

  const total = list.length;
  const offset = (page - 1) * limit;
  const items = list.slice(offset, offset + limit).map(serializeCampaign);

  return { items, total, page, limit };
}

export async function addToAllowlist(campaignId, addresses) {
  const campaign = campaigns.get(Number(campaignId));
  if (!campaign) return null;

  for (const addr of addresses) {
    campaign.allowlist.add(addr);
  }

  // Bust cache
  await cacheService.delete(campaignCacheKey(campaignId)).catch(() => {});
  logger.info('Allowlist updated', { campaignId, added: addresses.length });
  return { added: addresses.length };
}

export async function removeFromAllowlist(campaignId, address) {
  const campaign = campaigns.get(Number(campaignId));
  if (!campaign) return null;

  campaign.allowlist.delete(address);
  await cacheService.delete(campaignCacheKey(campaignId)).catch(() => {});
  return { removed: 1 };
}

export async function checkEligibility(campaignId, address) {
  const campaign = campaigns.get(Number(campaignId));
  if (!campaign) return null;

  const hasClaimed = campaign.claimed.has(address);
  const isAllowlisted = !campaign.requireAllowlist || campaign.allowlist.has(address);
  const now = Math.floor(Date.now() / 1000);
  const isActive = campaign.status === 'active';
  const hasStarted = now >= campaign.startTimestamp;
  const notExpired = now <= campaign.endTimestamp;
  const hasFunds = campaign.totalAmount - campaign.claimedAmount >= campaign.amountPerClaim;

  return {
    eligible: isAllowlisted && !hasClaimed && isActive && hasStarted && notExpired && hasFunds,
    hasClaimed,
    isAllowlisted,
    isActive,
    hasStarted,
    notExpired,
    hasFunds,
  };
}

export async function recordClaim(campaignId, address) {
  const campaign = campaigns.get(Number(campaignId));
  if (!campaign) return null;

  if (campaign.claimed.has(address)) {
    return { error: 'already_claimed' };
  }

  campaign.claimed.add(address);
  campaign.claimedAmount += campaign.amountPerClaim;

  await cacheService.delete(campaignCacheKey(campaignId)).catch(() => {});
  logger.info('Claim recorded', { campaignId, address, amount: campaign.amountPerClaim });
  return { amount: campaign.amountPerClaim };
}

export async function endCampaign(campaignId, admin) {
  const campaign = campaigns.get(Number(campaignId));
  if (!campaign) return null;
  if (campaign.admin !== admin) return { error: 'unauthorized' };

  campaign.status = 'ended';
  await cacheService.delete(campaignCacheKey(campaignId)).catch(() => {});
  await cacheService.delete(listCacheKey()).catch(() => {});
  logger.info('Campaign ended', { campaignId });
  return serializeCampaign(campaign);
}

export async function getCampaignStats(campaignId) {
  const campaign = campaigns.get(Number(campaignId));
  if (!campaign) return null;

  return {
    id: campaign.id,
    totalAmount: campaign.totalAmount,
    claimedAmount: campaign.claimedAmount,
    remainingAmount: campaign.totalAmount - campaign.claimedAmount,
    claimCount: campaign.claimed.size,
    allowlistSize: campaign.allowlist.size,
    claimRate:
      campaign.totalAmount > 0
        ? ((campaign.claimedAmount / campaign.totalAmount) * 100).toFixed(2)
        : '0.00',
    status: campaign.status,
  };
}

// ── Serializer (strips internal Sets) ────────────────────────────────────────

function serializeCampaign(c) {
  return {
    id: c.id,
    admin: c.admin,
    token: c.token,
    name: c.name,
    description: c.description,
    amountPerClaim: c.amountPerClaim,
    totalAmount: c.totalAmount,
    claimedAmount: c.claimedAmount,
    remainingAmount: c.totalAmount - c.claimedAmount,
    startTimestamp: c.startTimestamp,
    endTimestamp: c.endTimestamp,
    requireAllowlist: c.requireAllowlist,
    status: c.status,
    claimCount: c.claimed.size,
    allowlistSize: c.allowlist.size,
    createdAt: c.createdAt,
  };
}
