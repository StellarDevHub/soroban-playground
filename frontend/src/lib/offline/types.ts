// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Shared types for the offline-first sync engine (issue #1525).
 *
 * The engine is deliberately transport-agnostic: it knows how to detect that
 * the network is gone, how to durably queue the actions that could not be sent
 * and how to reconcile two divergent copies of the same record. It knows
 * nothing about HTTP, React or the concrete endpoints — `lib/sync` supplies
 * those.
 */

/** How the browser currently believes it can reach the network. */
export type ConnectivityStatus =
  /** No probe has completed yet — the app has just booted. */
  | "unknown"
  | "online"
  /** `navigator.onLine === false` or a probe failed. */
  | "offline"
  /**
   * `navigator.onLine === true` but probes are failing/timing out, or a sync
   * request just failed. Distinct from `offline` because the UI should offer
   * "retry" rather than "wait for connection".
   */
  | "degraded";

/** Why a connectivity transition happened — useful for telemetry + tests. */
export type ConnectivityReason =
  | "boot"
  | "navigator"
  | "probe"
  | "request-failure"
  | "request-success"
  | "manual";

export interface ConnectivityState {
  status: ConnectivityStatus;
  reason: ConnectivityReason;
  /** Epoch ms of the last successful probe or request, or `null`. */
  lastOnlineAt: number | null;
  /** Epoch ms of the last confirmed offline transition, or `null`. */
  lastOfflineAt: number | null;
  /** Round-trip time of the last successful probe in ms, or `null`. */
  latencyMs: number | null;
  /** Consecutive failed probes / failed requests. */
  failureCount: number;
}

export const INITIAL_CONNECTIVITY_STATE: ConnectivityState = {
  status: "unknown",
  reason: "boot",
  lastOnlineAt: null,
  lastOfflineAt: null,
  latencyMs: null,
  failureCount: 0,
};

/** A mutation that could not be completed while offline. */
export interface OutboxOperation<TPayload = unknown> {
  /** Stable id; re-enqueueing the same id replaces the pending operation. */
  id: string;
  /** Logical operation name, e.g. `"workspace.push"`. */
  kind: string;
  payload: TPayload;
  /** Epoch ms the operation was enqueued. */
  queuedAt: number;
  /** How many delivery attempts have been made. */
  attempts: number;
  /** Epoch ms of the most recent attempt, or `null`. */
  lastAttemptAt: number | null;
  /** Last failure message, cleared on success. */
  lastError: string | null;
}

/**
 * Deterministic per-operation outcomes.
 *
 * `merge` is only returned for strategies that can combine both sides without
 * human input; `manual` means the conflict must be surfaced in the UI.
 */
export type SyncStatus =
  | "synced"
  | "queued"
  | "conflict"
  | "pending"
  | "failed"
  | "skipped";

/**
 * How two versions of the same record are reconciled.
 *
 * - `newest-wins` — last-write-wins on `updatedAt` (the default for scalars)
 * - `local-wins` / `remote-wins` — explicit, caller-chosen precedence
 * - `union` — additive set merge, order-preserving and deduplicated
 * - `append` — append-only log merge keyed by entry id
 * - `manual` — unreconcilable without a human decision
 */
export type ConflictStrategy =
  | "newest-wins"
  | "local-wins"
  | "remote-wins"
  | "union"
  | "append"
  | "manual";

export interface Versioned {
  /** Epoch ms of the last local write. */
  updatedAt: number;
  /** Opaque device id, so a tie can be broken deterministically. */
  deviceId?: string;
}

export interface Conflict<T = unknown> {
  /** Dotted path of the conflicting field, e.g. `"workspace.openFiles[2]"`. */
  path: string;
  local: T;
  remote: T;
  strategy: ConflictStrategy;
  /** Which side survived the merge. */
  resolution: "local" | "remote" | "merged" | "manual";
}

export interface MergeOutcome<T> {
  /** The reconciled value. */
  value: T;
  /** Non-empty when the two sides actually disagreed. */
  conflicts: Conflict[];
  /** True when `value` differs from the local value and must be pushed. */
  dirty: boolean;
}

export interface OutboxState {
  operations: OutboxOperation[];
  /** Epoch ms the last full drain completed, or `null`. */
  lastDrainedAt: number | null;
  /** Message from the last failed drain, cleared on success. */
  lastError: string | null;
}

export const EMPTY_OUTBOX_STATE: OutboxState = {
  operations: [],
  lastDrainedAt: null,
  lastError: null,
};

export interface OfflineEngineState {
  connectivity: ConnectivityState;
  outbox: OutboxState;
  /** True while a drain pass is in flight. */
  draining: boolean;
  /** Non-empty while a merge needs a human decision. */
  conflicts: Conflict[];
}

export const INITIAL_OFFLINE_ENGINE_STATE: OfflineEngineState = {
  connectivity: INITIAL_CONNECTIVITY_STATE,
  outbox: EMPTY_OUTBOX_STATE,
  draining: false,
  conflicts: [],
};

/** Maximum retained operations. Older entries are dropped oldest-first. */
export const OUTBOX_CAPACITY = 200;

/** Exponential backoff ceiling for repeated drain failures, in ms. */
export const DRAIN_BACKOFF_CEILING_MS = 60_000;
