// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// IPFS content retrieval with gateway failover and CID verification.

import { Router } from 'express';
import {
  InvalidCidError,
  IpfsResolutionError,
  ipfsService,
} from '../services/ipfsService.js';

const router = Router();

/**
 * GET /api/ipfs/:cid
 * Resolves content through the gateway pool, verifies it against the CID and
 * returns the verified bytes. Cached (Redis/S3) copies are re-verified too.
 */
router.get('/:cid', async (req, res) => {
  const { cid } = req.params;

  try {
    const result = await ipfsService.resolve(cid, {
      useCache: req.query.cache !== 'false',
    });

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Length', result.bytes.length);
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.setHeader('X-IPFS-CID', cid);
    res.setHeader('X-IPFS-Verified', 'true');
    res.setHeader('X-IPFS-Gateway', result.cacheSource ?? result.gateway ?? '');
    res.setHeader('X-IPFS-Cache', result.cached ? 'HIT' : 'MISS');

    if (req.query.download === 'true') {
      res.setHeader('Content-Disposition', `attachment; filename="${cid}"`);
    }

    return res.send(result.bytes);
  } catch (error) {
    if (error instanceof InvalidCidError) {
      return res.status(400).json({ success: false, error: error.message });
    }

    if (error instanceof IpfsResolutionError) {
      return res.status(502).json({
        success: false,
        error: error.message,
        attempts: error.attempts,
      });
    }

    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
