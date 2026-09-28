// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Workspace cloud sync — issue #1526.
 *
 * `GET  /api/workspace`           read the wallet's snapshot
 * `POST /api/workspace`           write a snapshot (server merges, never clobbers)
 * `GET  /api/workspace/history`   read only the history log
 *
 * The server is intentionally a *merging* replica rather than a last-write-wins
 * blob: a client that has been offline for a week can push a whole snapshot
 * without erasing edits made on another device. `favorites` are unioned, the
 * history log is appended (deduplicated by entry id) and the `workspace`
 * document is resolved with last-write-wins on the client-supplied
 * `updatedAt`/`deviceId`, matching `frontend/src/lib/offline/conflict.ts`.
 *
 * `baseRevision` gives optimistic concurrency: a client that read revision N and
 * writes without having seen N's successors is answered with `409` plus the
 * current snapshot so it can merge and retry instead of silently losing data.
 */

import express from 'express';
import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';
import { getDatabase } from '../database/connection.js';
import { requireTenantContext } from '../middleware/tenantContext.js';

const router = express.Router();

/** Matches `backend/src/lib/…` storage caps on the client. */
const HISTORY_CAPACITY = 200;
const FAVORITES_CAPACITY = 500;
const WORKSPACE_KEYS = [
  'openFiles',
  'activeFile',
  'network',
  'pinnedPresetIds',
  'pinnedSnippetIds',
  'sidebarCollapsed',
  'fontSize',
  'splitRatio',
];
const STELLAR_ADDRESS_RE = /^G[A-Z0-9]{55}$/;

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
  const address = walletAddress.trim();
  if (!STELLAR_ADDRESS_RE.test(address)) {
    return next(createHttpError(400, 'Invalid Stellar public key format'));
  }
  req.walletAddress = address;
  return next();
}

function parseJsonColumn(value, fallback) {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function stringArray(value, capacity) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0) continue;
    if (seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  return out.slice(Math.max(0, out.length - capacity));
}

/** Drop malformed history rows and enforce the client-side cap. */
function historyArray(value) {
  if (!Array.isArray(value)) return [];
  const byId = new Map();
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw;
    if (typeof entry.id !== 'string' || entry.id.length === 0) continue;
    byId.set(entry.id, {
      id: entry.id,
      at: typeof entry.at === 'number' ? entry.at : 0,
      kind: typeof entry.kind === 'string' ? entry.kind : 'note',
      label: typeof entry.label === 'string' ? entry.label : '',
      ...(typeof entry.templateId === 'string'
        ? { templateId: entry.templateId }
        : {}),
      ...(typeof entry.contractId === 'string'
        ? { contractId: entry.contractId }
        : {}),
      ...(typeof entry.txHash === 'string' ? { txHash: entry.txHash } : {}),
      ...(typeof entry.status === 'string' ? { status: entry.status } : {}),
      ...(typeof entry.network === 'string' ? { network: entry.network } : {}),
    });
  }
  const entries = Array.from(byId.values()).sort((a, b) => a.at - b.at);
  return entries.slice(Math.max(0, entries.length - HISTORY_CAPACITY));
}

function workspaceObject(value) {
  const input = value && typeof value === 'object' ? value : {};
  const out = {};
  for (const key of WORKSPACE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      out[key] = input[key];
    }
  }
  if (Array.isArray(out.openFiles)) {
    out.openFiles = stringArray(out.openFiles, 50);
  }
  if (Array.isArray(out.pinnedPresetIds)) {
    out.pinnedPresetIds = stringArray(out.pinnedPresetIds, 100);
  }
  if (Array.isArray(out.pinnedSnippetIds)) {
    out.pinnedSnippetIds = stringArray(out.pinnedSnippetIds, 100);
  }
  return out;
}

function emptySnapshot() {
  return {
    favorites: [],
    history: [],
    workspace: {},
    updatedAt: 0,
    deviceId: undefined,
    revision: 0,
  };
}

async function readSnapshot(tenantId, walletAddress) {
  const db = getDatabase();
  const row = await db.get(
    'SELECT favorites, history, workspace, updated_at, device_id, revision FROM workspace_snapshots WHERE tenant_id = ? AND wallet_address = ?',
    [tenantId, walletAddress]
  );
  if (!row) return emptySnapshot();

  return {
    favorites: stringArray(
      parseJsonColumn(row.favorites, []),
      FAVORITES_CAPACITY
    ),
    history: historyArray(parseJsonColumn(row.history, [])),
    workspace: workspaceObject(parseJsonColumn(row.workspace, {})),
    updatedAt: Date.parse(row.updated_at) || 0,
    deviceId: typeof row.device_id === 'string' ? row.device_id : undefined,
    revision: Number.isInteger(row.revision) ? row.revision : 0,
  };
}

async function writeSnapshot(tenantId, walletAddress, snapshot) {
  const db = getDatabase();
  const updatedAt = new Date().toISOString();
  await db.run(
    `INSERT INTO workspace_snapshots
       (tenant_id, wallet_address, favorites, history, workspace, updated_at, device_id, revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(tenant_id, wallet_address)
     DO UPDATE SET
       favorites = excluded.favorites,
       history = excluded.history,
       workspace = excluded.workspace,
       updated_at = excluded.updated_at,
       device_id = excluded.device_id,
       revision = workspace_snapshots.revision + 1`,
    [
      tenantId,
      walletAddress,
      JSON.stringify(snapshot.favorites),
      JSON.stringify(snapshot.history),
      JSON.stringify(snapshot.workspace),
      updatedAt,
      snapshot.deviceId ?? null,
    ]
  );

  return { ...snapshot, updatedAt: Date.parse(updatedAt) || 0 };
}

/** Union two favorite lists, preserving first-seen order. */
function mergeFavorites(local, remote) {
  return stringArray([...(local ?? []), ...(remote ?? [])], FAVORITES_CAPACITY);
}

/** Append-only merge keyed by entry id; the remote copy wins on id collision. */
function mergeHistory(local, remote) {
  const byId = new Map();
  for (const entry of local ?? []) byId.set(entry.id, entry);
  for (const entry of remote ?? []) byId.set(entry.id, entry);
  return historyArray(Array.from(byId.values()));
}

/** Last-write-wins on `updatedAt` (epoch ms), tie-broken by device id. */
function prefersIncoming(current, incoming) {
  const currentAt = Number.isFinite(current.updatedAt) ? current.updatedAt : 0;
  const incomingAt = Number.isFinite(incoming.updatedAt)
    ? incoming.updatedAt
    : 0;
  if (incomingAt !== currentAt) return incomingAt > currentAt;
  const currentDevice = current.deviceId ?? '';
  const incomingDevice = incoming.deviceId ?? '';
  if (currentDevice === incomingDevice) return true;
  return incomingDevice < currentDevice;
}

router.get(
  '/',
  requireTenantContext(),
  requireAuth,
  asyncHandler(async (req, res) => {
    return res.json({
      success: true,
      data: await readSnapshot(req.tenant.id, req.walletAddress),
    });
  })
);

router.get(
  '/history',
  requireTenantContext(),
  requireAuth,
  asyncHandler(async (req, res) => {
    const requested = Number.parseInt(req.query.limit, 10);
    const limit = Number.isInteger(requested)
      ? Math.min(Math.max(requested, 1), HISTORY_CAPACITY)
      : 50;
    const snapshot = await readSnapshot(req.tenant.id, req.walletAddress);
    return res.json({
      success: true,
      data: { history: snapshot.history.slice(-limit).reverse() },
    });
  })
);

router.post(
  '/',
  requireTenantContext(),
  requireAuth,
  asyncHandler(async (req, res, next) => {
    const body = req.body ?? {};
    const incoming = {
      favorites: stringArray(body.favorites, FAVORITES_CAPACITY),
      history: historyArray(body.history),
      workspace: workspaceObject(body.workspace),
      updatedAt:
        typeof body.updatedAt === 'number' && Number.isFinite(body.updatedAt)
          ? body.updatedAt
          : 0,
      deviceId:
        typeof body.deviceId === 'string' && body.deviceId.length <= 64
          ? body.deviceId
          : undefined,
    };

    const current = await readSnapshot(req.tenant.id, req.walletAddress);

    const baseRevision = Number.isInteger(body.baseRevision)
      ? body.baseRevision
      : null;
    if (baseRevision !== null && current.revision > baseRevision) {
      return next(
        createHttpError(409, 'Workspace snapshot is stale; merge and retry', {
          current,
        })
      );
    }

    const merged = {
      favorites: mergeFavorites(current.favorites, incoming.favorites),
      history: mergeHistory(current.history, incoming.history),
      workspace: prefersIncoming(current, incoming)
        ? incoming.workspace
        : current.workspace,
      updatedAt: Math.max(current.updatedAt, incoming.updatedAt),
      deviceId:
        prefersIncoming(current, incoming) && incoming.deviceId !== undefined
          ? incoming.deviceId
          : current.deviceId,
    };

    const stored = await writeSnapshot(
      req.tenant.id,
      req.walletAddress,
      merged
    );
    return res.json({
      success: true,
      data: { ...stored, revision: current.revision + 1 },
    });
  })
);

export default router;
