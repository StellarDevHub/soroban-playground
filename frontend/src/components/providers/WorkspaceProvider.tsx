// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Single owner of the workspace snapshot (issue #1526).
 *
 * `useWorkspaceSync` is a *stateful* hook: it owns a `localStorage` read, a
 * debounced push and a reconcile on wallet change. Mounting it in several
 * components would mean several independent snapshots fighting over the same
 * bucket and several concurrent reconciles, so exactly one instance lives here
 * and every consumer reads it through {@link useWorkspace}.
 *
 * Wired into the root layout above `SidebarShell` so the template library, the
 * command palette and any future surface all see the same favorites and history.
 */

"use client";

import React, { createContext, useContext } from "react";
import { useWallet } from "@/components/providers/WalletProvider";
import RouteActivityRecorder from "@/components/RouteActivityRecorder";
import { useWorkspaceSync } from "@/hooks/useWorkspaceSync";
import type { WorkspaceSyncValue } from "@/hooks/useWorkspaceSync";

const WorkspaceContext = createContext<WorkspaceSyncValue | null>(null);

export interface WorkspaceProviderProps {
  children: React.ReactNode;
  /** Set false to keep everything local (tests, kiosk mode). */
  enabled?: boolean;
}

export function WorkspaceProvider({
  children,
  enabled = true,
}: WorkspaceProviderProps) {
  const { address } = useWallet();
  const workspace = useWorkspaceSync({ walletAddress: address, enabled });
  return (
    <WorkspaceContext.Provider value={workspace}>
      {children}
      {/* #1525/#1527 — the palette's "recent" list and the workspace history
          both need every route transition, so it is recorded here rather than
          per-page. */}
      <RouteActivityRecorder />
    </WorkspaceContext.Provider>
  );
}

/**
 * Read the shared workspace. Must be used inside {@link WorkspaceProvider}.
 *
 * Deliberately strict rather than silently falling back to a local-only
 * instance: two live snapshots over one bucket would reconcile against each
 * other, so a missing provider is a wiring bug worth surfacing loudly.
 */
export function useWorkspace(): WorkspaceSyncValue {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error("useWorkspace must be used inside a <WorkspaceProvider>");
  }
  return context;
}

export default WorkspaceProvider;
