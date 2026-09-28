// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Local-first workspace cloud sync (issue #1526).
 *
 * Contract with the caller:
 *
 *  - reads and writes hit `localStorage` **synchronously**, so a bookmark or a
 *    history entry is visible immediately and survives a reload with no network;
 *  - every mutation also queues a push on the offline engine (#1525), which
 *    retries with backoff and reports failures honestly;
 *  - on mount (and whenever the connected wallet changes) the hook pulls the
 *    server snapshot, merges it with the local one via `mergeSnapshots`, and
 *    pushes back only when the merge says the local side still holds data the
 *    server lacks;
 *  - conflicts are surfaced, never silently resolved, when a merge needs a
 *    human decision.
 *
 * The wallet address is a *parameter* rather than something read from a context
 * so this hook is testable and reusable outside the wallet provider.
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOffline } from "@/components/providers/OfflineProvider";
import { describeConflict, mergeSnapshots } from "@/lib/sync/merge";
import { fetchWorkspace } from "@/lib/sync/workspaceClient";
import {
  applyLocalMutation,
  isPushRequired,
  readWorkspace,
  rememberActiveBucket,
  workspaceBucket,
  writeWorkspace,
} from "@/lib/sync/workspaceStore";
import {
  sanitiseSnapshot,
  type HistoryEntry,
  type HistoryKind,
  type WorkspaceSnapshot,
  type WorkspaceState,
} from "@/lib/sync/types";
import type { Conflict } from "@/lib/offline/types";

/** Device id, used to break last-write-wins ties deterministically. */
export function resolveDeviceId(): string {
  if (typeof window === "undefined") return "server";
  const KEY = "sp:device-id";
  try {
    const existing = window.localStorage.getItem(KEY);
    if (existing && existing.length > 0) return existing;
    const generated = `web-${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(KEY, generated);
    return generated;
  } catch {
    return "web-anonymous";
  }
}

export type WorkspaceSyncStatus =
  | "idle"
  | "loading"
  | "synced"
  | "queued"
  | "offline"
  | "error";

export interface WorkspaceSyncOptions {
  /** Connected Stellar account. `null` keeps everything in the local bucket. */
  walletAddress: string | null;
  /** Disable the network entirely (tests, storybook, explicit opt-out). */
  enabled?: boolean;
  /** Milliseconds to wait after the last edit before pushing. */
  debounceMs?: number;
}

export interface WorkspaceSyncValue {
  snapshot: WorkspaceSnapshot;
  status: WorkspaceSyncStatus;
  /** True while a pull/push is in flight. */
  isSyncing: boolean;
  /** Last transport error, cleared on the next success. */
  error: string | null;
  /** Conflicts that need a human decision. */
  conflicts: Conflict[];
  /** Human-readable conflict summaries, ready to render. */
  conflictSummaries: string[];
  deviceId: string;
  toggleFavorite: (templateId: string) => void;
  isFavorite: (templateId: string) => boolean;
  recordHistory: (entry: {
    kind: HistoryKind;
    label: string;
    templateId?: string;
    contractId?: string;
    txHash?: string;
    status?: string;
    network?: string;
  }) => void;
  updateWorkspace: (patch: Partial<WorkspaceState>) => void;
  /** Pull the server snapshot and merge it in. */
  refresh: () => Promise<void>;
  /** Force a push now (bypasses the debounce). */
  syncNow: () => Promise<void>;
  /** Drop every local change and adopt the server copy. */
  resetWorkspace: () => Promise<void>;
  history: HistoryEntry[];
}

const DEFAULT_DEBOUNCE_MS = 1200;

export function useWorkspaceSync({
  walletAddress,
  enabled = true,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: WorkspaceSyncOptions): WorkspaceSyncValue {
  const offline = useOffline();
  const deviceId = useMemo(resolveDeviceId, []);

  const bucket = useMemo(
    () => workspaceBucket(walletAddress),
    [walletAddress],
  );

  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(() =>
    readWorkspace(bucket),
  );
  const [status, setStatus] = useState<WorkspaceSyncStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const clearDebounce = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = null;
  }, []);

  /** Persist locally and schedule a coalesced push. */
  const commit = useCallback(
    (next: WorkspaceSnapshot, push: boolean) => {
      const stored = writeWorkspace(bucket, next);
      snapshotRef.current = stored;
      setSnapshot(stored);
      if (!push || !walletAddress || !enabled) return;
      offline.queueWorkspacePush(walletAddress, stored);
      clearDebounce();
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        void offline.flush();
      }, debounceMs);
    },
    [bucket, clearDebounce, debounceMs, enabled, offline, walletAddress],
  );

  const mutate = useCallback(
    (
      patch: {
        favorites?: string[];
        history?: HistoryEntry[];
        workspace?: Partial<WorkspaceState>;
      },
    ) => {
      const { snapshot: next } = applyLocalMutation(snapshotRef.current, patch, {
        deviceId,
      });
      commit(next, true);
    },
    [commit, deviceId],
  );

  /**
   * Pull the server copy, merge, and push back when we are ahead.
   *
   * `base` exists because a wallet switch has to reconcile against the *new*
   * bucket's local copy. Without it the merge would run against the previous
   * wallet's snapshot (the ref only catches up on the next render) and leak one
   * account's favorites and history into the other.
   */
  const reconcile = useCallback(
    async (base?: WorkspaceSnapshot) => {
      if (!enabled || !walletAddress) return;
      setIsSyncing(true);
      setStatus("loading");
      const result = await fetchWorkspace(walletAddress);
      setIsSyncing(false);

      if (!result.ok) {
        setError(result.error);
        setStatus(
          result.offline || offline.status === "offline" ? "offline" : "error",
        );
        return;
      }

      setError(null);
      const merged = mergeSnapshots(base ?? snapshotRef.current, result.data);
      const stored = writeWorkspace(bucket, merged.snapshot);
      snapshotRef.current = stored;
      setSnapshot(stored);
      setConflicts(merged.conflicts);
      offline.recordConflicts(merged.manual);

      if (merged.dirty || isPushRequired(stored, result.data)) {
        offline.queueWorkspacePush(walletAddress, stored);
        await offline.flush();
        setStatus("synced");
        return;
      }

      setStatus("synced");
    },
    [bucket, enabled, offline, walletAddress],
  );

  const refresh = useCallback(() => reconcile(), [reconcile]);

  const syncNow = useCallback(async () => {
    if (!enabled || !walletAddress) return;
    clearDebounce();
    await refresh();
  }, [clearDebounce, enabled, refresh, walletAddress]);

  const resetWorkspace = useCallback(async () => {
    const fresh = sanitiseSnapshot(null);
    commit(fresh, true);
    await refresh();
  }, [commit, refresh]);

  // Adopt the local bucket for the connected account, then reconcile.
  useEffect(() => {
    if (!walletAddress) return;
    rememberActiveBucket(walletAddress);
    const local = readWorkspace(bucket);
    // Seed the ref *synchronously* so the reconcile below merges the new
    // account's copy rather than the previous wallet's still-rendered state.
    snapshotRef.current = local;
    setSnapshot(local);
    setConflicts([]);
    setError(null);
    setStatus("idle");
    if (enabled) void reconcile(local);
    // `reconcile` is intentionally excluded: it changes on every engine emission
    // and re-running it on each one would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucket, enabled, walletAddress]);

  // Mirror the engine's connectivity into the reported status so the UI can say
  // "queued" instead of pretending a sync is in flight.
  useEffect(() => {
    if (offline.status === "offline") {
      setStatus("offline");
      return;
    }
    if (offline.queuedCount > 0) setStatus("queued");
  }, [offline.queuedCount, offline.status]);

  useEffect(() => clearDebounce, [clearDebounce]);

  const history = useMemo(
    () => [...snapshot.history].sort((a, b) => b.at - a.at),
    [snapshot.history],
  );

  const toggleFavorite = useCallback(
    (templateId: string) => {
      const current = snapshotRef.current.favorites;
      const next = current.includes(templateId)
        ? current.filter((id) => id !== templateId)
        : [...current, templateId];
      mutate({ favorites: next });
    },
    [mutate],
  );

  const isFavorite = useCallback(
    (templateId: string) =>
      snapshotRef.current.favorites.includes(templateId),
    [],
  );

  const recordHistory = useCallback(
    (entry: {
      kind: HistoryKind;
      label: string;
      templateId?: string;
      contractId?: string;
      txHash?: string;
      status?: string;
      network?: string;
    }) => {
      const at = Date.now();
      mutate({
        history: [
          ...snapshotRef.current.history,
          {
            // Client-generated id: the merge engine dedupes on it, so replaying
            // the same event from a retry cannot duplicate the row.
            id: `${entry.kind}-${at}-${entry.label}`,
            at,
            kind: entry.kind,
            label: entry.label,
            templateId: entry.templateId,
            contractId: entry.contractId,
            txHash: entry.txHash,
            status: entry.status,
            network: entry.network,
          },
        ],
      });
    },
    [mutate],
  );

  const updateWorkspace = useCallback(
    (patch: Partial<WorkspaceState>) => mutate({ workspace: patch }),
    [mutate],
  );

  return {
    snapshot,
    status,
    isSyncing,
    error,
    conflicts,
    conflictSummaries: conflicts.map(describeConflict),
    deviceId,
    toggleFavorite,
    isFavorite,
    recordHistory,
    updateWorkspace,
    refresh,
    syncNow,
    resetWorkspace,
    history,
  };
}

export default useWorkspaceSync;
