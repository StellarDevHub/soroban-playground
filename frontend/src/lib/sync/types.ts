// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Wire model for the workspace cloud sync (issue #1526).
 *
 * One wallet address owns exactly one {@link WorkspaceSnapshot}. The snapshot
 * bundles everything that should follow a user across devices:
 *
 *  - `favorites` — starred contract templates (a *set*: merges are unions)
 *  - `history` — an append-only deployment/compile log (merges are appends)
 *  - `workspace` — the editor workspace: open files, active file, network
 *    preference, filter presets and snippet pins (last-write-wins per field)
 *  - `updatedAt` / `deviceId` — the metadata the conflict engine needs to
 *    converge without a server round-trip
 */

import type { ConflictStrategy, Versioned } from "@/lib/offline/types";

/** A single entry in the deployment/compile history. */
export interface HistoryEntry {
  /** Client-generated stable id; the merge engine dedupes on it. */
  id: string;
  /** Epoch ms the entry was recorded. */
  at: number;
  /** `compile` | `deploy` | `invoke` | `template` | `note`. */
  kind: HistoryKind;
  /** Short human label, e.g. `"counter → Testnet"`. */
  label: string;
  /** Template slug, when the entry originated from the library. */
  templateId?: string;
  /** Deployed contract id, when known. */
  contractId?: string;
  /** Stellar transaction hash, when known. */
  txHash?: string;
  /** Free-form status such as `"success"` or `"failed"`. */
  status?: string;
  /** Network the entry relates to. */
  network?: string;
}

export type HistoryKind =
  | "compile"
  | "deploy"
  | "invoke"
  | "template"
  | "note";

/** Editor/IDE state that should travel with the user. */
export interface WorkspaceState {
  /** Open editor tabs, most recent first. */
  openFiles: string[];
  /** Active editor tab. */
  activeFile: string | null;
  /** Selected Stellar network passphrase. */
  network: string;
  /** Template-library filter preset ids that are pinned. */
  pinnedPresetIds: string[];
  /** Snippet ids the user starred. */
  pinnedSnippetIds: string[];
  /** Sidebar collapsed state. */
  sidebarCollapsed: boolean;
  /** Editor font size in px. */
  fontSize: number;
  /** User-authored split-pane ratio (0–1). */
  splitRatio: number;
}

export interface WorkspaceDocument extends Versioned {
  favorites: string[];
  history: HistoryEntry[];
  workspace: WorkspaceState;
}

export interface WorkspaceSnapshot extends WorkspaceDocument {
  /** Monotonic server revision; lets clients detect a stale read. */
  revision: number;
}

export const DEFAULT_WORKSPACE_STATE: WorkspaceState = {
  openFiles: [],
  activeFile: null,
  network: "testnet",
  pinnedPresetIds: [],
  pinnedSnippetIds: [],
  sidebarCollapsed: false,
  fontSize: 14,
  splitRatio: 0.5,
};

export const DEFAULT_WORKSPACE_DOCUMENT: WorkspaceDocument = {
  favorites: [],
  history: [],
  workspace: DEFAULT_WORKSPACE_STATE,
  updatedAt: 0,
};

/** Cap on retained history entries; oldest are trimmed on write. */
export const HISTORY_CAPACITY = 200;

/** Cap on retained favorite ids. */
export const FAVORITES_CAPACITY = 500;

/**
 * Per-field merge policy. Sets union, logs append, everything else is
 * last-write-wins on `updatedAt` — see `lib/offline/conflict.ts`.
 */
export const WORKSPACE_MERGE_POLICY: Record<string, ConflictStrategy> = {
  favorites: "union",
  history: "append",
  workspace: "newest-wins",
  updatedAt: "newest-wins",
  deviceId: "newest-wins",
};

/** Trim a history log to {@link HISTORY_CAPACITY}, newest last. */
export function trimHistory(entries: readonly HistoryEntry[]): HistoryEntry[] {
  if (entries.length <= HISTORY_CAPACITY) return [...entries];
  return entries
    .slice()
    .sort((a, b) => a.at - b.at)
    .slice(entries.length - HISTORY_CAPACITY);
}

/** De-duplicate a favorite list, preserving first-seen order. */
export function dedupeFavorites(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.slice(Math.max(0, out.length - FAVORITES_CAPACITY));
}

/** Drop malformed entries so a corrupt local payload cannot break a render. */
export function sanitiseHistory(value: unknown): HistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const out: HistoryEntry[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as Partial<HistoryEntry>;
    if (typeof entry.id !== "string" || entry.id.length === 0) continue;
    out.push({
      id: entry.id,
      at: typeof entry.at === "number" ? entry.at : 0,
      kind: (entry.kind ?? "note") as HistoryKind,
      label: typeof entry.label === "string" ? entry.label : "",
      templateId: typeof entry.templateId === "string" ? entry.templateId : undefined,
      contractId:
        typeof entry.contractId === "string" ? entry.contractId : undefined,
      txHash: typeof entry.txHash === "string" ? entry.txHash : undefined,
      status: typeof entry.status === "string" ? entry.status : undefined,
      network: typeof entry.network === "string" ? entry.network : undefined,
    });
  }
  return out;
}

/** Coerce an arbitrary payload into a valid {@link WorkspaceDocument}. */
export function sanitiseDocument(value: unknown): WorkspaceDocument {
  if (typeof value !== "object" || value === null) {
    return { ...DEFAULT_WORKSPACE_DOCUMENT };
  }
  const raw = value as Partial<WorkspaceDocument> & {
    workspace?: Partial<WorkspaceState>;
  };
  const workspace: Partial<WorkspaceState> = raw.workspace ?? {};
  return {
    favorites: dedupeFavorites(
      Array.isArray(raw.favorites)
        ? raw.favorites.filter((id): id is string => typeof id === "string")
        : [],
    ),
    history: sanitiseHistory(raw.history),
    workspace: {
      openFiles: Array.isArray(workspace.openFiles)
        ? workspace.openFiles.filter((f): f is string => typeof f === "string")
        : [],
      activeFile:
        typeof workspace.activeFile === "string" ? workspace.activeFile : null,
      network:
        typeof workspace.network === "string" && workspace.network.length > 0
          ? workspace.network
          : DEFAULT_WORKSPACE_STATE.network,
      pinnedPresetIds: Array.isArray(workspace.pinnedPresetIds)
        ? workspace.pinnedPresetIds.filter(
            (id): id is string => typeof id === "string",
          )
        : [],
      pinnedSnippetIds: Array.isArray(workspace.pinnedSnippetIds)
        ? workspace.pinnedSnippetIds.filter(
            (id): id is string => typeof id === "string",
          )
        : [],
      sidebarCollapsed:
        typeof workspace.sidebarCollapsed === "boolean"
          ? workspace.sidebarCollapsed
          : DEFAULT_WORKSPACE_STATE.sidebarCollapsed,
      fontSize:
        typeof workspace.fontSize === "number" && workspace.fontSize > 0
          ? workspace.fontSize
          : DEFAULT_WORKSPACE_STATE.fontSize,
      splitRatio:
        typeof workspace.splitRatio === "number" &&
        workspace.splitRatio >= 0 &&
        workspace.splitRatio <= 1
          ? workspace.splitRatio
          : DEFAULT_WORKSPACE_STATE.splitRatio,
    },
    updatedAt:
      typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt)
        ? raw.updatedAt
        : 0,
    deviceId: typeof raw.deviceId === "string" ? raw.deviceId : undefined,
  };
}

/** Coerce an API response into a {@link WorkspaceSnapshot}. */
export function sanitiseSnapshot(value: unknown): WorkspaceSnapshot {
  const document = sanitiseDocument(value);
  const raw = (value ?? {}) as { revision?: unknown };
  return {
    ...document,
    revision:
      typeof raw.revision === "number" && Number.isFinite(raw.revision)
        ? raw.revision
        : 0,
  };
}
