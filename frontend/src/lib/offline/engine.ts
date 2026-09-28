// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * The offline engine (issue #1525).
 *
 * One object that owns connectivity detection, the durable outbox and the
 * conflict ledger, and exposes a single `enqueue` → `drain` pipeline:
 *
 * 1. the caller enqueues a mutation (it is persisted immediately, so nothing is
 *    lost if the tab dies mid-flight);
 * 2. if the network is up, a drain pass runs right away;
 * 3. otherwise the operation waits, and the pass replays automatically the
 *    moment connectivity returns, on app focus, or on an explicit `flush()`.
 *
 * Transports register a handler for their operation `kind`. If no handler is
 * registered the operation stays queued instead of being discarded, so adding a
 * new synced feature is a one-line change here.
 *
 * Backoff between failed drains is exponential with a ceiling
 * ({@link DRAIN_BACKOFF_CEILING_MS}) and is skipped entirely while the browser
 * reports it is offline — the `online` event is the retry signal.
 */

import {
  createConnectivityMonitor,
  type ConnectivityMonitor,
  type ConnectivityMonitorOptions,
} from "./connectivity";
import { createOutbox, OUTBOX_STORAGE_KEY, type Outbox } from "./outbox";
import {
  DRAIN_BACKOFF_CEILING_MS,
  EMPTY_OUTBOX_STATE,
  INITIAL_CONNECTIVITY_STATE,
  type Conflict,
  type ConnectivityState,
  type ConnectivityStatus,
  type OfflineEngineState,
  type OutboxOperation,
} from "./types";

/**
 * Delivers one queued operation. Resolve on success; throw to leave the
 * operation queued (and record the failure).
 */
export type OutboxHandler = (operation: OutboxOperation) => Promise<void>;

export type OfflineEngineListener = (state: OfflineEngineState) => void;

export interface OfflineEngineOptions
  extends ConnectivityMonitorOptions {
  storageKey?: string;
  now?: () => number;
  /** Base backoff for the first failed drain, in ms. */
  backoffBaseMs?: number;
  /** Drain automatically when the tab regains focus. Defaults to `true`. */
  drainOnFocus?: boolean;
}

export interface OfflineEngine {
  getState: () => OfflineEngineState;
  subscribe: (listener: OfflineEngineListener) => () => void;
  /** Register (or replace) the delivery handler for an operation kind. */
  registerHandler: (kind: string, handler: OutboxHandler) => () => void;
  /** Persist a mutation and try to deliver it now. */
  enqueue: <T>(id: string, kind: string, payload: T) => void;
  /** Run a drain pass. Resolves once the pass settles. */
  flush: () => Promise<OfflineEngineState>;
  /** Force a connectivity status, e.g. from a "Retry" button. */
  setStatus: (status: ConnectivityStatus) => void;
  /** Drop queued operations of a kind (used when a conflict is resolved). */
  discard: (id: string) => boolean;
  /** Conflicts that still need a human decision. */
  conflicts: () => Conflict[];
  /** Re-run the conflict ledger from a caller-supplied merge result. */
  recordConflicts: (conflicts: Conflict[]) => void;
  clearConflicts: () => void;
  start: () => void;
  destroy: () => void;
}

const DEFAULT_BACKOFF_BASE_MS = 1000;

export function createOfflineEngine(
  options: OfflineEngineOptions = {},
): OfflineEngine {
  const {
    storageKey = OUTBOX_STORAGE_KEY,
    now = () => Date.now(),
    backoffBaseMs = DEFAULT_BACKOFF_BASE_MS,
    drainOnFocus = true,
    ...connectivityOptions
  } = options;

  const handlers = new Map<string, OutboxHandler>();
  const listeners = new Set<OfflineEngineListener>();
  const outbox: Outbox = createOutbox({ storageKey, now });
  const connectivity: ConnectivityMonitor = createConnectivityMonitor({
    ...connectivityOptions,
    now,
  });

  let state: OfflineEngineState = {
    connectivity: connectivity.getState(),
    outbox: outbox.getState(),
    draining: false,
    conflicts: [],
  };
  let destroyed = false;
  let consecutiveFailures = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let drainPromise: Promise<OfflineEngineState> | null = null;

  const emit = (patch: Partial<OfflineEngineState>): OfflineEngineState => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
    return state;
  };

  connectivity.subscribe((next) => {
    emit({ connectivity: next });
    if (next.status === "online" || next.status === "degraded") {
      if (outbox.pending().length > 0) void flush();
    }
  });

  outbox.subscribe((next) => {
    emit({ outbox: next });
  });

  const registerHandler = (kind: string, handler: OutboxHandler) => {
    handlers.set(kind, handler);
    return () => {
      if (handlers.get(kind) === handler) handlers.delete(kind);
    };
  };

  const clearRetry = (): void => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  };

  const scheduleRetry = (): void => {
    clearRetry();
    if (destroyed || consecutiveFailures <= 0) return;
    const delay = Math.min(
      DRAIN_BACKOFF_CEILING_MS,
      backoffBaseMs * 2 ** (consecutiveFailures - 1),
    );
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void flush();
    }, delay);
  };

  const drainOnce = async (): Promise<OfflineEngineState> => {
    if (destroyed) return state;
    const queued = outbox.pending();
    if (queued.length === 0) {
      consecutiveFailures = 0;
      clearRetry();
      return emit({
        outbox: { ...outbox.getState(), lastError: null, lastDrainedAt: now() },
      });
    }

    emit({ draining: true });
    let failure: string | null = null;

    for (const operation of queued) {
      const handler = handlers.get(operation.kind);
      if (!handler) {
        // No transport registered yet — leave it for a later pass rather than
        // dropping data on the floor.
        continue;
      }
      try {
        await handler(operation);
        outbox.resolve(operation.id);
      } catch (error) {
        outbox.reject(operation.id, error);
        failure =
          error instanceof Error ? error.message : "Delivery failed";
        // Stop the pass: later operations likely depend on this one, and a
        // burst of failures is worse than a single surfaced error.
        break;
      }
    }

    const remaining = outbox.getState();
    if (failure) {
      consecutiveFailures += 1;
      connectivity.reportRequestFailure(failure);
      emit({ draining: false, outbox: { ...remaining, lastError: failure } });
      scheduleRetry();
      return state;
    }

    consecutiveFailures = 0;
    clearRetry();
    connectivity.reportRequestSuccess();
    emit({
      draining: false,
      outbox: { ...remaining, lastError: null, lastDrainedAt: now() },
    });
    return state;
  };

  function flush(): Promise<OfflineEngineState> {
    if (destroyed) return Promise.resolve(state);
    if (drainPromise) return drainPromise;
    if (state.connectivity.status === "offline") {
      return Promise.resolve(state);
    }
    drainPromise = drainOnce().finally(() => {
      drainPromise = null;
    });
    return drainPromise;
  }

  const enqueue = <T,>(id: string, kind: string, payload: T): void => {
    if (destroyed) return;
    outbox.enqueue(id, kind, payload);
    if (state.connectivity.status !== "offline") void flush();
  };

  const discard = (id: string): boolean => outbox.resolve(id);

  const recordConflicts = (conflicts: Conflict[]): void => {
    emit({ conflicts });
  };

  const clearConflicts = (): void => {
    if (state.conflicts.length > 0) emit({ conflicts: [] });
  };

  const handleVisibility = (): void => {
    if (typeof document === "undefined") return;
    if (document.visibilityState === "visible") void flush();
  };

  const start = (): void => {
    connectivity.start();
    if (drainOnFocus && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibility);
    }
    if (outbox.pending().length > 0 && state.connectivity.status !== "offline") {
      void flush();
    }
  };

  const destroy = (): void => {
    destroyed = true;
    clearRetry();
    if (drainOnFocus && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", handleVisibility);
    }
    connectivity.destroy();
    handlers.clear();
    listeners.clear();
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    registerHandler,
    enqueue,
    flush,
    setStatus: (status) => {
      connectivity.setManualStatus(status);
      if (status === "online") void flush();
    },
    discard,
    conflicts: () => state.conflicts,
    recordConflicts,
    clearConflicts,
    start,
    destroy,
  };
}

/** Reset helper used by tests to guarantee a clean engine between cases. */
export function resetOfflineEngineState(): OfflineEngineState {
  return {
    connectivity: { ...INITIAL_CONNECTIVITY_STATE },
    outbox: { ...EMPTY_OUTBOX_STATE },
    draining: false,
    conflicts: [],
  };
}
