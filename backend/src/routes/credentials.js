// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// Credential rotation webhook (issue #738).
//
// POST /api/credentials/rotate triggers a rotation — either from an explicit
// `credentials` map in the body, or by re-reading the configured source file.
// The endpoint is guarded by a constant-time shared-secret check and is disabled
// (503) unless CREDENTIAL_ROTATION_WEBHOOK_SECRET is configured, so it can never
// be reached by an unauthenticated caller (rotation is a DoS vector).
//
// Rotation requests are also rejected when the secret is shorter than the
// minimum length, so a weak webhook secret cannot silently enable the endpoint.

import express from 'express';
import crypto from 'crypto';
import credentialRotationService from '../services/credentialRotationService.js';

const router = express.Router();

const MIN_SECRET_LENGTH = 32;

function tokenMatches(provided, expected) {
  const a = crypto.createHash('sha256').update(String(provided)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  // Hashing both sides yields equal-length digests, so timingSafeEqual is safe
  // and the comparison leaks neither the expected secret's length nor content.
  return crypto.timingSafeEqual(a, b);
}

router.post('/rotate', async (req, res) => {
  const secret = process.env.CREDENTIAL_ROTATION_WEBHOOK_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    return res
      .status(503)
      .json({ error: 'Credential rotation webhook is not configured' });
  }

  const provided = req.headers['x-rotation-token'] || '';
  if (!tokenMatches(provided, secret)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    let rotated;
    if (req.body && typeof req.body.credentials === 'object') {
      const result = await credentialRotationService.rotate(
        req.body.credentials
      );
      rotated = result.rotated;
    } else {
      const updates = await credentialRotationService.checkSource();
      rotated = updates ? Object.keys(updates) : [];
    }
    res.json({ success: true, rotated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

export default router;
