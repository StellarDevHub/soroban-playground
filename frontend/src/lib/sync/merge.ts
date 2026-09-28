// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Snapshot merge for the workspace cloud sync (issue #1526).
 *
 * `mergeSnapshots` is the single place where a local device state and the
 * server copy are reconciled. It is a pure function: given the same two
 * snapshots it always returns the same merged snapshot, on every device. That
 * property is what lets a client push optimistically while offline and still
 * converge once the server replies.
 */

import { mergeRecords } from "@/lib/offline/conflict";
import type { Conflict } from "@/lib/offline/types";
import {
  WORKSPACE_MERGE_POLICY,
  dedupeFavorites,
  sanitiseSnapshot,
  trimHistory,
  type WorkspaceSnapshot,
} from "./types";

export interface SnapshotMergeResult {
  snapshot: WorkspaceSnapshot;
  conflicts: Conflict[];
  /** Conflicts a human still has to resolve (none for the current policy). */
  manual: Conflict[];
  /** True when the merged snapshot must be pushed back to the server. */
  dirty: boolean;
}

const EMPTY_SNAPSHOT: WorkspaceSnapshot = {
  favorites: [],
  history: [],
  workspace: {
    openFiles: [],
    activeFile: null,
    network: "testnet",
    pinnedPresetIds: [],
    pinnedSnippetIds: [],
    sidebarCollapsed: false,
    fontSize: 14,
    splitRatio: 0.5,
  },
  updatedAt: 0,
  revision: 0,
};

export function emptySnapshot(): WorkspaceSnapshot {
  return {
    ...EMPTY_SNAPSHOT,
    workspace: { ...EMPTY_SNAPSHOT.workspace },
    favorites: [],
    history: [],
  };
}

/**
 * Merge the device copy with the server copy.
 *
 * Precedence:
 *  - `favorites`  → order-preserving union (bookmarks are additive)
 *  - `history`    → append-only merge, deduplicated by entry id, oldest first
 *  - `workspace`  → last-write-wins on the document's `updatedAt`
 *  - `revision`   → `max(local, remote)`; monotonic, never rewound
 *
 * `updatedAt` on the result is the max of both sides so a subsequent merge from
 * a third device still resolves deterministically.
 */
export function mergeSnapshots(
  local: WorkspaceSnapshot | null | undefined,
  remote: WorkspaceSnapshot | null | undefined,
): SnapshotMergeResult {
  const localSnapshot = local ? sanitiseSnapshot(local) : emptySnapshot();
  const remoteSnapshot = remote ? sanitiseSnapshot(remote) : emptySnapshot();

  const { value, conflicts, dirty, manual } = mergeRecords<
    Record<string, unknown>,
    Record<string, unknown>
  >(
    localSnapshot as unknown as Record<string, unknown>,
    remoteSnapshot as unknown as Record<string, unknown>,
    {
      localVersion: {
        updatedAt: localSnapshot.updatedAt,
        deviceId: localSnapshot.deviceId,
      },
      remoteVersion: {
        updatedAt: remoteSnapshot.updatedAt,
        deviceId: remoteSnapshot.deviceId,
      },
      overrides: WORKSPACE_MERGE_POLICY,
    },
  );

  const merged = sanitiseSnapshot({
    ...value,
    revision: Math.max(localSnapshot.revision, remoteSnapshot.revision),
  });

  return {
    snapshot: {
      ...merged,
      favorites: dedupeFavorites(merged.favorites),
      history: trimHistory(merged.history),
      updatedAt: Math.max(localSnapshot.updatedAt, remoteSnapshot.updatedAt),
    },
    conflicts,
    manual,
    dirty,
  };
}

/**
 * True when the two snapshots describe the same content, ignoring the metadata
 * that always differs. Used to skip a redundant `POST` after a `GET`.
 *
 * `favorites` is compared as a **set**, not as a list. A union is
 * order-preserving, so merging the same two snapshots from opposite sides
 * yields the same ids in a different order. Comparing order-sensitively there
 * would make two devices that hold an identical set of favorites disagree
 * forever, each pushing the same list back to the other on every reconcile.
 * Display order is a per-device detail; the set is the content.
 */
export function snapshotsEqual(
  a: WorkspaceSnapshot | null | undefined,
  b: WorkspaceSnapshot | null | undefined,
): boolean {
  if (!a || !b) return false;

  const sameFavorites = (left: readonly string[], right: readonly string[]) => {
    const l = new Set(dedupeFavorites(left));
    const r = new Set(dedupeFavorites(right));
    if (l.size !== r.size) return false;
    for (const id of l) {
      if (!r.has(id)) return false;
    }
    return true;
  };

  return (
    sameFavorites(a.favorites, b.favorites) &&
    trimHistory(a.history).map((entry) => entry.id).join(",") ===
      trimHistory(b.history).map((entry) => entry.id).join(",") &&
    JSON.stringify(a.workspace) === JSON.stringify(b.workspace)
  );
}

/** Human-readable one-liner for a conflict, used by the resolution UI. */
export function describeConflict(conflict: Conflict): string {
  const render = (value: unknown): string => {
    if (value === null || value === undefined) return "—";
    if (typeof value === "string") return value;
    try {
      const json = JSON.stringify(value);
      return json.length > 80 ? `${json.slice(0, 77)}…` : json;
    } catch {
      return "[unserialisable]";
    }
  };
  return `${conflict.path}: local ${render(conflict.local)} vs remote ${render(
    conflict.remote,
  )} (${conflict.resolution})`;
}
