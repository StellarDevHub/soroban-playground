// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Patent Registry Service
 *
 * Wraps Soroban CLI invocations for the patent-registry contract.
 * All write operations go through `invokeSorobanContract`; reads use
 * the same path so the frontend always gets consistent data shapes.
 */

import { invokeSorobanContract } from './invokeService.js';

const CONTRACT_ID = process.env.PATENT_CONTRACT_ID || '';
const NETWORK = process.env.DEFAULT_NETWORK || 'testnet';
const SOURCE = process.env.SOROBAN_SOURCE_ACCOUNT || '';

async function invoke(functionName, args = {}) {
  return invokeSorobanContract({
    requestId: `patent-${Date.now()}`,
    contractId: CONTRACT_ID,
    functionName,
    args,
    network: NETWORK,
    sourceAccount: SOURCE,
  });
}

// ── Write operations ──────────────────────────────────────────────────────────

export async function filePatent({ inventor, title, description, expiryDate }) {
  return invoke('file_patent', {
    inventor,
    title,
    description,
    expiry_date: expiryDate,
  });
}

export async function activatePatent({ admin, patentId }) {
  return invoke('activate_patent', { admin, patent_id: patentId });
}

export async function revokePatent({ admin, patentId }) {
  return invoke('revoke_patent', { admin, patent_id: patentId });
}

export async function transferPatent({ owner, patentId, newOwner }) {
  return invoke('transfer_patent', {
    owner,
    patent_id: patentId,
    new_owner: newOwner,
  });
}

export async function grantLicense({
  owner,
  patentId,
  licensee,
  licenseType,
  fee,
  expiryDate,
}) {
  return invoke('grant_license', {
    owner,
    patent_id: patentId,
    licensee,
    license_type: licenseType,
    fee,
    expiry_date: expiryDate,
  });
}

export async function fileDispute({ claimant, patentId, reason }) {
  return invoke('file_dispute', {
    claimant,
    patent_id: patentId,
    reason,
  });
}

export async function resolveDispute({ admin, disputeId, resolution }) {
  return invoke('resolve_dispute', {
    admin,
    dispute_id: disputeId,
    resolution,
  });
}

export async function pauseContract({ admin }) {
  return invoke('pause', { admin });
}

export async function unpauseContract({ admin }) {
  return invoke('unpause', { admin });
}

// ── Read operations ───────────────────────────────────────────────────────────

export async function getPatent(patentId) {
  return invoke('get_patent', { patent_id: patentId });
}

export async function getLicense(licenseId) {
  return invoke('get_license', { license_id: licenseId });
}

export async function getDispute(disputeId) {
  return invoke('get_dispute', { dispute_id: disputeId });
}

export async function getPatentCount() {
  return invoke('get_patent_count', {});
}

export async function getLicenseCount() {
  return invoke('get_license_count', {});
}

export async function getDisputeCount() {
  return invoke('get_dispute_count', {});
}

export async function getAdmin() {
  return invoke('get_admin', {});
}

export async function getIsPaused() {
  return invoke('is_paused', {});
}
