// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { invokeContract } from './invokeService.js';
import cacheService from './cacheService.js';

const CACHE_TTL = 60; // 1 minute

/**
 * Initialize the quadratic voting contract
 */
export async function initialize(contractId, admin, votingPeriod = null, maxCredits = null) {
  const args = { admin };
  if (votingPeriod !== null) args.voting_period = votingPeriod;
  if (maxCredits !== null) args.max_credits = maxCredits;

  return await invokeContract({
    contractId,
    functionName: 'initialize',
    args,
    network: 'testnet',
  });
}

/**
 * Create a new proposal
 */
export async function createProposal(contractId, admin, title, description, duration = null) {
  const args = { admin, title, description };
  if (duration !== null) args.duration = duration;

  const result = await invokeContract({
    contractId,
    functionName: 'create_proposal',
    args,
    network: 'testnet',
  });

  // Invalidate cache
  await cacheService.del(`qv:proposals:${contractId}`);
  await cacheService.del(`qv:count:${contractId}`);

  return result;
}

/**
 * Whitelist a voter
 */
export async function whitelistVoter(contractId, admin, voter, allow) {
  const result = await invokeContract({
    contractId,
    functionName: 'whitelist',
    args: { admin, voter, allow },
    network: 'testnet',
  });

  await cacheService.del(`qv:whitelist:${contractId}:${voter}`);
  return result;
}

/**
 * Cast a vote
 */
export async function vote(contractId, voter, proposalId, credits, isFor) {
  const result = await invokeContract({
    contractId,
    functionName: 'vote',
    args: { voter, proposal_id: proposalId, credits, is_for: isFor },
    network: 'testnet',
  });

  // Invalidate proposal cache
  await cacheService.del(`qv:proposal:${contractId}:${proposalId}`);
  await cacheService.del(`qv:proposals:${contractId}`);

  return result;
}

/**
 * Finalize a proposal
 */
export async function finalizeProposal(contractId, proposalId) {
  const result = await invokeContract({
    contractId,
    functionName: 'finalize',
    args: { proposal_id: proposalId },
    network: 'testnet',
  });

  await cacheService.del(`qv:proposal:${contractId}:${proposalId}`);
  return result;
}

/**
 * Get a proposal (cached)
 */
export async function getProposal(contractId, proposalId) {
  const cacheKey = `qv:proposal:${contractId}:${proposalId}`;
  const cached = await cacheService.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const result = await invokeContract({
    contractId,
    functionName: 'get_proposal',
    args: { id: proposalId },
    network: 'testnet',
  });

  await cacheService.set(cacheKey, JSON.stringify(result), CACHE_TTL);
  return result;
}

/**
 * Get proposal count (cached)
 */
export async function getProposalCount(contractId) {
  const cacheKey = `qv:count:${contractId}`;
  const cached = await cacheService.get(cacheKey);
  if (cached) return parseInt(cached, 10);

  const result = await invokeContract({
    contractId,
    functionName: 'get_proposal_count',
    args: {},
    network: 'testnet',
  });

  await cacheService.set(cacheKey, String(result), CACHE_TTL);
  return result;
}

/**
 * Check if voter is whitelisted (cached)
 */
export async function isWhitelisted(contractId, voter) {
  const cacheKey = `qv:whitelist:${contractId}:${voter}`;
  const cached = await cacheService.get(cacheKey);
  if (cached !== null) return cached === 'true';

  const result = await invokeContract({
    contractId,
    functionName: 'is_whitelisted',
    args: { voter },
    network: 'testnet',
  });

  await cacheService.set(cacheKey, String(result), CACHE_TTL);
  return result;
}

/**
 * Get user credits for a proposal
 */
export async function getUserCredits(contractId, voter, proposalId) {
  return await invokeContract({
    contractId,
    functionName: 'get_user_credits',
    args: { voter, proposal_id: proposalId },
    network: 'testnet',
  });
}

/**
 * Pause the contract
 */
export async function pause(contractId, admin) {
  const result = await invokeContract({
    contractId,
    functionName: 'pause',
    args: { admin },
    network: 'testnet',
  });

  await cacheService.del(`qv:paused:${contractId}`);
  return result;
}

/**
 * Unpause the contract
 */
export async function unpause(contractId, admin) {
  const result = await invokeContract({
    contractId,
    functionName: 'unpause',
    args: { admin },
    network: 'testnet',
  });

  await cacheService.del(`qv:paused:${contractId}`);
  return result;
}

/**
 * Check if contract is paused
 */
export async function isPaused(contractId) {
  const cacheKey = `qv:paused:${contractId}`;
  const cached = await cacheService.get(cacheKey);
  if (cached !== null) return cached === 'true';

  const result = await invokeContract({
    contractId,
    functionName: 'is_paused',
    args: {},
    network: 'testnet',
  });

  await cacheService.set(cacheKey, String(result), CACHE_TTL);
  return result;
}

/**
 * Calculate votes from credits (off-chain helper)
 */
export function creditsToVotes(credits) {
  if (credits <= 0) return 0;
  return Math.floor(Math.sqrt(credits));
}

export default {
  initialize,
  createProposal,
  whitelistVoter,
  vote,
  finalizeProposal,
  getProposal,
  getProposalCount,
  isWhitelisted,
  getUserCredits,
  pause,
  unpause,
  isPaused,
  creditsToVotes,
};
