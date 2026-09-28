// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Local (device) persistence for the workspace snapshot (issue #1526).
 *
 * The store is local-first: every mutation is written here before any network
 * call, so a user who is offline — or who simply closes the tab — keeps their
 * bookmarks, history and editor layout. The sync layer (#1525) then replays the
 * queued push once the network returns.
 *
 * Records are namespaced by wallet address so switching accounts in the same
 * browser never leaks one user's workspace into another's, and an anonymous
 * (not-yet-connected) session gets its own "local" bucket that upgrades to the
 * wallet bucket on first sync.
 */

import { readJson, writeJson } from "@/lib/offline/storage";
import {
  emptySnapshot,
  mergeSnapshots,
  snapshotsEqual,
} from "./merge";
import {
  sanitiseSnapshot,
  type HistoryEntry,
  type WorkspaceSnapshot,
  type WorkspaceState,
} from "./types";

export const WORKSPACE_STORAGE_PREFIX = "sp:workspace";
export const ANONYMOUS_BUCKET = "local";

/**
 * Favorite stores that predate the workspace snapshot.
 *
 * The template library grew its own `localStorage` set, and three more
 * implementations of the same idea exist elsewhere in the app. A user's
 * existing stars have to survive the move to the synced workspace, so the first
 * read of a bucket seeds from these keys (union) and then stops looking.
 *
 * Order matters only for reproducibility: the richest implementation —
 * `hooks/useFavorites.ts`, which also stores per-favorite metadata — is listed
 * first so its ids lead the union.
 */
export const LEGACY_FAVORITES_KEYS = [
  "soroban_template_favorites",
  "template_favorites",
  "template-library-favorites",
  "tpl_favorites",
] as const;

/** Marker so the seed runs at most once per bucket. */
const MIGRATION_MARKER = `${WORKSPACE_STORAGE_PREFIX}:migrated`;

/** Bucket key for a wallet address (or the anonymous session). */
export function workspaceBucket(walletAddress: string | null | undefined): string {
  const address = (walletAddress ?? "").trim().toLowerCase();
  return `${WORKSPACE_STORAGE_PREFIX}:${address || ANONYMOUS_BUCKET}`;
}

/** Storage key holding the bucket each address maps to (for account upgrades). */
const ACTIVE_BUCKET_KEY = `${WORKSPACE_STORAGE_PREFIX}:active`;

/**
 * Remember that `walletAddress` should adopt the anonymous bucket's content the
 * first time it syncs, so work done before connecting an account is not lost.
 */
export function rememberActiveBucket(walletAddress: string): void {
  if (typeof walletAddress !== "string" || walletAddress.trim().length === 0) {
    return;
  }
  writeJson(ACTIVE_BUCKET_KEY, {
    wallet: walletAddress.trim().toLowerCase(),
    at: Date.now(),
  });
}

/**
 * Read the local snapshot for a bucket, or an empty one when absent.
 *
 * On the very first read the pre-workspace favorite keys are folded in as a
 * union, so upgrading users keep their stars. The marker key makes that a
 * one-time operation rather than a read that keeps re-reading legacy keys.
 */
export function readWorkspace(bucket: string): WorkspaceSnapshot {
  const raw = readJson<unknown>(bucket, null);
  if (!raw) {
    const seeded = seedLegacyFavorites(bucket);
    return seeded ?? emptySnapshot();
  }
  return sanitiseSnapshot(raw);
}

/** Union the legacy favorite arrays into a bucket, once. */
function seedLegacyFavorites(bucket: string): WorkspaceSnapshot | null {
  const markerKey = `${MIGRATION_MARKER}:${bucket}`;
  if (readJson<unknown>(markerKey, null) !== null) return null;

  const legacy: string[] = [];
  for (const key of LEGACY_FAVORITES_KEYS) {
    const value = readJson<unknown>(key, null);
    if (!Array.isArray(value)) continue;
    for (const id of value) {
      if (typeof id === "string" && id.length > 0 && !legacy.includes(id)) {
        legacy.push(id);
      }
    }
  }

  // Marked even when nothing was found, so a user who favorites their first
  // template later is not re-scanned on every load.
  writeJson(markerKey, { at: Date.now() });
  if (legacy.length === 0) return null;

  const current = sanitiseSnapshot(readJson<unknown>(bucket, null));
  return writeWorkspace(bucket, {
    ...current,
    favorites: [...current.favorites, ...legacy],
  });
}

/** Overwrite the local snapshot for a bucket. */
export function writeWorkspace(
  bucket: string,
  snapshot: WorkspaceSnapshot,
): WorkspaceSnapshot {
  const sanitised = sanitiseSnapshot(snapshot);
  writeJson(bucket, sanitised);
  return sanitised;
}

/** Drop the local snapshot (used by "reset workspace"). */
export function clearWorkspace(bucket: string): void {
  writeJson(bucket, emptySnapshot());
}

export interface ApplyResult {
  snapshot: WorkspaceSnapshot;
  /** True when the snapshot changed and therefore needs a push. */
  dirty: boolean;
}

/**
 * Apply a local mutation to a snapshot. The caller supplies the *next* value of
 * the fields it wants to change; untouched fields are preserved.
 *
 * `bumpUpdatedAt` is what makes last-write-wins work, so it defaults to true for
 * real edits and can be turned off for pure reads.
 */
export function applyLocalMutation(
  snapshot: WorkspaceSnapshot,
  patch: {
    favorites?: string[];
    history?: HistoryEntry[];
    workspace?: Partial<WorkspaceState>;
  },
  meta: { deviceId?: string; at?: number; bumpUpdatedAt?: boolean },
): ApplyResult {
  const at = meta.at ?? Date.now();
  const bumpUpdatedAt = meta.bumpUpdatedAt ?? true;
  const next: WorkspaceSnapshot = {
    ...snapshot,
    favorites: patch.favorites ?? snapshot.favorites,
    history: patch.history ?? snapshot.history,
    workspace: { ...snapshot.workspace, ...(patch.workspace ?? {}) },
    // Never rewind: a device with a skewed clock must not be able to make its
    // own older copy win a last-write-wins merge.
    updatedAt: bumpUpdatedAt
      ? Math.max(snapshot.updatedAt, at)
      : snapshot.updatedAt,
    deviceId: meta.deviceId ?? snapshot.deviceId,
  };
  return { snapshot: sanitiseSnapshot(next), dirty: true };
}

/**
 * Fold a server snapshot into the local one. Returns the merged snapshot plus
 * whether the *local* side still holds changes the server lacks.
 */
export function applyRemoteSnapshot(
  local: WorkspaceSnapshot,
  remote: WorkspaceSnapshot | null,
): ApplyResult {
  if (!remote) return { snapshot: local, dirty: false };
  const { snapshot, dirty } = mergeSnapshots(local, remote);
  return { snapshot, dirty };
}

/** True when a push can be skipped because both sides already agree. */
export function isPushRequired(
  local: WorkspaceSnapshot,
  remote: WorkspaceSnapshot | null,
): boolean {
  if (!remote) return true;
  return !snapshotsEqual(local, remote);
}

/** Merge two history logs and re-trim, exposed for callers outside the hook. */
export function mergeHistory(
  local: readonly HistoryEntry[],
  remote: readonly HistoryEntry[],
): HistoryEntry[] {
  const { snapshot } = mergeSnapshots(
    { ...emptySnapshot(), history: [...local] },
    { ...emptySnapshot(), history: [...remote] },
  );
  return snapshot.history;
}
