import express from 'express';
import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';
import { getDatabase } from '../database/connection.js';
import { requireTenantContext } from '../middleware/tenantContext.js';

const router = express.Router();

function requireAuth(req, _res, next) {
  const walletAddress = req.headers['x-wallet-address'];
  if (
    !walletAddress ||
    typeof walletAddress !== 'string' ||
    !walletAddress.trim()
  ) {
    return next(
      createHttpError(
        401,
        'Authentication required. Provide x-wallet-address header.'
      )
    );
  }
  req.walletAddress = walletAddress.trim();
  next();
}

function validateFavoritesArray(value) {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

router.get(
  '/',
  requireTenantContext(),
  requireAuth,
  asyncHandler(async (req, res) => {
    const db = getDatabase();
    const row = await db.get(
      'SELECT favorites, updated_at FROM favorites WHERE tenant_id = ? AND wallet_address = ?',
      [req.tenant.id, req.walletAddress]
    );

    const favorites = row ? JSON.parse(row.favorites) : [];
    const updatedAt = row ? row.updated_at : new Date().toISOString();

    return res.json({ favorites, updatedAt });
  })
);

router.post(
  '/',
  requireTenantContext(),
  requireAuth,
  asyncHandler(async (req, res, next) => {
    const { favorites } = req.body || {};

    if (!validateFavoritesArray(favorites)) {
      return next(
        createHttpError(400, 'favorites must be an array of strings')
      );
    }

    const db = getDatabase();
    const serialized = JSON.stringify(favorites);
    const updatedAt = new Date().toISOString();

    await db.run(
      `INSERT INTO favorites (tenant_id, wallet_address, favorites, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(tenant_id, wallet_address)
       DO UPDATE SET favorites = excluded.favorites, updated_at = excluded.updated_at`,
      [req.tenant.id, req.walletAddress, serialized, updatedAt]
    );

    return res.json({ favorites, updatedAt });
  })
);

export default router;
