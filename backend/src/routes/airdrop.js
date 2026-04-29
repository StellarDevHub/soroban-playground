// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';
import {
  getAirdropSnapshot,
  getEligibility,
  verifyEligibility,
} from '../services/airdropService.js';
import { airdropEventBus } from '../services/airdropEvents.js';
import { sendSuccess } from '../utils/response.js';

const router = express.Router();
const ADDRESS_PATTERN = /^G[A-Z0-9]{55}$/;
const HASH_PATTERN = /^[0-9a-fA-F]{64}$/;

function normalizeAddress(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim().toUpperCase();
  return trimmed.length > 0 ? trimmed : null;
}

router.get(
  '/config',
  asyncHandler(async (_req, res) => {
    const snapshot = getAirdropSnapshot();
    return sendSuccess(res, {
      data: snapshot,
      message: 'Airdrop configuration loaded',
    });
  })
);

router.post(
  '/eligibility',
  asyncHandler(async (req, res, next) => {
    const address = normalizeAddress(req.body?.address);
    if (!address) {
      return next(createHttpError(400, 'address is required'));
    }
    if (!ADDRESS_PATTERN.test(address)) {
      return next(createHttpError(400, 'address must be a valid Stellar account'));
    }

    const result = getEligibility(address);
    return sendSuccess(res, {
      data: result,
      message: result.eligible
        ? 'Address is eligible for airdrop'
        : 'Address is not eligible',
    });
  })
);

router.post(
  '/claim',
  asyncHandler(async (req, res, next) => {
    const address = normalizeAddress(req.body?.address);
    if (!address) {
      return next(createHttpError(400, 'address is required'));
    }
    if (!ADDRESS_PATTERN.test(address)) {
      return next(createHttpError(400, 'address must be a valid Stellar account'));
    }

    const eligibility = getEligibility(address);
    if (!eligibility.eligible) {
      return next(createHttpError(404, 'Address is not eligible'));
    }

    const amount = String(req.body?.amount ?? eligibility.amount);
    if (amount !== eligibility.amount) {
      return next(createHttpError(400, 'amount does not match allocation'));
    }

    const rawProof = Array.isArray(req.body?.proof)
      ? req.body.proof
      : eligibility.proof;

    if (!Array.isArray(rawProof)) {
      return next(createHttpError(400, 'proof must be an array'));
    }

    const proof = rawProof.map((node) => ({
      hash: node?.hash,
      is_left: node?.is_left ?? node?.isLeft,
    }));

    for (const node of proof) {
      if (!HASH_PATTERN.test(String(node.hash || ''))) {
        return next(createHttpError(400, 'proof hash must be 32-byte hex'));
      }
      if (typeof node.is_left !== 'boolean') {
        return next(createHttpError(400, 'proof is_left must be boolean'));
      }
    }

    const verification = verifyEligibility({ address, amount, proof });
    if (!verification.valid) {
      return next(createHttpError(400, 'Invalid Merkle proof'));
    }

    const event = {
      address,
      amount,
      root: verification.root,
      timestamp: new Date().toISOString(),
    };
    airdropEventBus.emit('claim', event);

    return sendSuccess(res, {
      data: {
        claim: {
          address,
          amount,
          proof,
          root: verification.root,
        },
        invoke: {
          functionName: 'claim',
          args: {
            claimant: address,
            amount,
            proof,
          },
        },
      },
      message: 'Claim verified and ready for submission',
    });
  })
);

export default router;
