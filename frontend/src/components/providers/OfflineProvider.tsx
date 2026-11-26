// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * App-wide owner of the offline sync engine (issue #1525).
 *
 * One engine instance is created per browser session and exposed through React
 * context, so any component can read connectivity, queue a mutation or force a
 * sync without prop drilling or module-level singletons that would leak between
 * tests.
 */

"use client";

import React from "react";
import { createOfflineEngine, type OfflineEngine } from "@/lib/offline/engine";
import { INITIAL_OFFLINE_ENGINE_STATE } from "@/lib/offline/types";
import {
  connectivityProbeUrl,
  fetchWorkspace,
  pushWorkspace,
} from "@/lib/sync/workspaceClient";
import { sanitiseSnapshot, type WorkspaceSnapshot } from "@/lib/sync/types";
import { mergeSnapshots, snapshotsEqual } from "@/lib/sync/merge";
import { workspaceBucket, writeWorkspace } from "@/lib/sync/workspaceStore";
import type {
  Conflict,
  ConnectivityStatus,
  OfflineEngineState,
} from "@/lib/offline/types";

/** Outbox operation kind for a workspace push. */
export const WORKSPACE_PUSH_KIND = "workspace.push";

export interface OfflineContextValue {
  state: OfflineEngineState;
  /** Convenience mirror of `state.connectivity.status`. */
  status: ConnectivityStatus;
  isOnline: boolean;
  /** Number of operations waiting for the network. */
  queuedCount: number;
  isDraining: boolean;
  /** Conflicts awaiting a human decision. */
  conflicts: Conflict[];
  /** Queue a mutation for delivery; returns nothing and never throws. */
  enqueue: <T>(id: string, kind: string, payload: T) => void;
  /** Run a drain pass now. */
  flush: () => Promise<OfflineEngineState>;
  /** Force a connectivity status (the "Retry" affordance). */
  setStatus: (status: ConnectivityStatus) => void;
  /** Drop a queued operation, e.g. after a conflict is resolved. */
  discard: (id: string) => boolean;
  recordConflicts: (conflicts: Conflict[]) => void;
  clearConflicts: () => void;
  /**
   * Queue (or re-queue) a workspace snapshot for delivery.
   *
   * The id is fixed per wallet so repeatedly editing the workspace coalesces
   * into a single pending push rather than growing the outbox.
   */
  queueWorkspacePush: (
    walletAddress: string,
    snapshot: WorkspaceSnapshot,
  ) => void;
}

const OfflineContext = React.createContext<OfflineContextValue | null>(null);

/** Outbox id for a wallet's pending workspace push. */
export function workspacePushId(walletAddress: string): string {
  return `${WORKSPACE_PUSH_KIND}:${walletAddress.trim().toLowerCase()}`;
}

/**
 * Persist a server-confirmed snapshot so the local copy converges on the merged
 * result even if the React tree never re-renders (e.g. the tab was backgrounded
 * while the outbox drained).
 */
function writeLocalSnapshot(
  walletAddress: string,
  snapshot: WorkspaceSnapshot,
): void {
  writeWorkspace(workspaceBucket(walletAddress), snapshot);
}

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  // #1369 — the engine must not be built during render. `createOfflineEngine`
  // reads its persisted outbox from localStorage as part of construction, so
  // constructing it in the render body makes the first client render depend on
  // browser storage the server never saw (a queued count the server could not
  // produce) and trips a hydration mismatch. It is therefore created in the
  // effect below, once we know we are past the hydration pass, and the tree
  // renders the canonical initial state until then.
  const [engine, setEngine] = React.useState<OfflineEngine | null>(null);
  const [state, setState] = React.useState<OfflineEngineState>(
    INITIAL_OFFLINE_ENGINE_STATE,
  );

  React.useEffect(() => {
    const created = createOfflineEngine({
      probeUrl: connectivityProbeUrl(),
      probeIntervalMs: 30_000,
      batchUpdates: (fn) => React.startTransition(fn),
    });
    // Adopt the persisted outbox and begin probing only after mount, so the
    // server-rendered markup stays authoritative for the hydration pass.
    setState(created.getState());
    created.start();
    const unsubscribe = created.subscribe(setState);
    setEngine(created);

    return () => {
      unsubscribe();
      created.destroy();
    };
  }, []);

  // Transport for the one outbox kind the app owns. Registered for the lifetime
  // of the provider; transport failures leave the operation queued and back off.
  React.useEffect(() => {
    if (!engine) return;
    return engine.registerHandler(WORKSPACE_PUSH_KIND, async (operation) => {
      const payload = operation.payload as
        | ({ walletAddress?: string } & WorkspaceSnapshot)
        | null;
      const walletAddress = payload?.walletAddress;
      if (!walletAddress) return;

      const local = sanitiseSnapshot((payload as unknown as WorkspaceSnapshot) ?? null);
      const result = await pushWorkspace(walletAddress, local);

      if (result.ok) {
        // Converge on the server's merged answer rather than assuming the local
        // write won — the server may have merged in another device's favorites.
        if (result.data && !snapshotsEqual(result.data, local)) {
          writeLocalSnapshot(walletAddress, result.data);
        }
        return;
      }

      if (result.status === 409) {
        // Optimistic-concurrency failure: another device wrote first. Re-read,
        // merge, and retry exactly once. A second 409 is a genuine conflict, so
        // it is surfaced to the user instead of retrying forever.
        const remote = await fetchWorkspace(walletAddress);
        if (!remote.ok || !remote.data) {
          throw new Error(remote.error ?? "Could not re-read the workspace");
        }
        const merged = mergeSnapshots(local, remote.data);
        if (merged.manual) engine.recordConflicts(merged.conflicts);
        const retry = await pushWorkspace(walletAddress, merged.snapshot);
        if (!retry.ok) {
          throw new Error(retry.error ?? "Workspace push failed");
        }
        writeLocalSnapshot(walletAddress, retry.data ?? merged.snapshot);
        return;
      }

      if (result.error) throw new Error(result.error);
    });
  }, [engine]);

  const value = React.useMemo<OfflineContextValue>(() => {
    const isOnline = state.connectivity.status !== "offline";
    return {
      state,
      status: state.connectivity.status,
      isOnline,
      queuedCount: state.outbox.operations.length,
      isDraining: state.draining,
      conflicts: state.conflicts,
      // Before the engine exists (server render, and the first client render
      // before the mount effect) there is nothing to talk to. These no-ops keep
      // the context shape stable so consumers never have to null-check.
      enqueue: (id, kind, payload) => engine?.enqueue(id, kind, payload),
      flush: async () => (engine ? engine.flush() : state),
      setStatus: (status) => engine?.setStatus(status),
      discard: (id) => engine?.discard(id) ?? false,
      recordConflicts: (conflicts) => engine?.recordConflicts(conflicts),
      clearConflicts: () => engine?.clearConflicts(),
      queueWorkspacePush: (walletAddress, snapshot) => {
        engine?.enqueue(workspacePushId(walletAddress), WORKSPACE_PUSH_KIND, {
          walletAddress,
          ...snapshot,
        });
      },
    };
  }, [engine, state]);

  return (
    <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>
  );
}

/** Read the offline engine. Must be used inside {@link OfflineProvider}. */
export function useOffline(): OfflineContextValue {
  const context = React.useContext(OfflineContext);
  if (!context) {
    throw new Error("useOffline must be used inside an <OfflineProvider>");
  }
  return context;
}

export default OfflineProvider;
