// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Durable outbox for operations that could not be delivered while offline
 * (issue #1525).
 *
 * Every mutation the app wants to persist is first written here, then attempted
 * immediately. While the network is down the operation simply stays queued; the
 * drain pass replays it — oldest first — as soon as connectivity returns.
 *
 * The queue is persisted to `localStorage` so a tab reload, a crash or a device
 * restart does not silently drop a user's work, and it is capped
 * ({@link OUTBOX_CAPACITY}) so a long offline stretch cannot exhaust the origin
 * storage quota.
 */

import {
  EMPTY_OUTBOX_STATE,
  OUTBOX_CAPACITY,
  type OutboxOperation,
  type OutboxState,
} from "./types";
import { readJson, writeJson } from "./storage";

export const OUTBOX_STORAGE_KEY = "sp:offline:outbox";

/** Invoked with the current state on every change. */
export type OutboxListener = (state: OutboxState) => void;

export interface OutboxOptions {
  storageKey?: string;
  capacity?: number;
  now?: () => number;
}

export interface Outbox {
  getState: () => OutboxState;
  subscribe: (listener: OutboxListener) => () => void;
  /** Queue an operation, replacing any pending one with the same id. */
  enqueue: <T>(
    id: string,
    kind: string,
    payload: T,
  ) => OutboxOperation<T>;
  /** Remove an operation after a successful delivery. */
  resolve: (id: string) => boolean;
  /** Record a failed delivery attempt. */
  reject: (id: string, error: unknown) => boolean;
  /** Operations ready for delivery, oldest first. */
  pending: () => OutboxOperation[];
  /** Drop every queued operation. */
  clear: () => void;
  /** Drop all but the newest `keep` operations. */
  compact: (keep: number) => OutboxState;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error.trim()) return error.trim();
  return "Unknown error";
}

function isOperation(value: unknown): value is OutboxOperation {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<OutboxOperation>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.kind === "string" &&
    typeof candidate.queuedAt === "number"
  );
}

/** Drop malformed entries so one bad write cannot brick the queue. */
function sanitise(raw: unknown): OutboxOperation[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isOperation).map((operation) => ({
    id: operation.id,
    kind: operation.kind,
    payload: operation.payload,
    queuedAt: operation.queuedAt,
    attempts: typeof operation.attempts === "number" ? operation.attempts : 0,
    lastAttemptAt:
      typeof operation.lastAttemptAt === "number" ? operation.lastAttemptAt : null,
    lastError: typeof operation.lastError === "string" ? operation.lastError : null,
  }));
}

export function createOutbox(options: OutboxOptions = {}): Outbox {
  const {
    storageKey = OUTBOX_STORAGE_KEY,
    capacity = OUTBOX_CAPACITY,
    now = () => Date.now(),
  } = options;

  const listeners = new Set<OutboxListener>();
  let state: OutboxState = readJson<OutboxState>(storageKey, EMPTY_OUTBOX_STATE);
  if (!state || !Array.isArray(state.operations)) {
    state = { ...EMPTY_OUTBOX_STATE };
  } else {
    state = { ...state, operations: sanitise(state.operations) };
  }

  const persist = (next: OutboxState): OutboxState => {
    state = next;
    writeJson(storageKey, state);
    for (const listener of listeners) listener(state);
    return state;
  };

  const replace = (
    operations: OutboxOperation[],
    patch: Partial<OutboxState> = {},
  ): OutboxState => {
    // Oldest-first, capped: the newest operations are the ones the user most
    // recently cared about, so they survive an overflow.
    const ordered = [...operations].sort((a, b) => a.queuedAt - b.queuedAt);
    const trimmed =
      ordered.length > capacity ? ordered.slice(ordered.length - capacity) : ordered;
    return persist({ ...state, ...patch, operations: trimmed });
  };

  const enqueue = <T,>(id: string, kind: string, payload: T): OutboxOperation<T> => {
    if (!id) throw new Error("Outbox operations require a non-empty id");
    const operation: OutboxOperation<T> = {
      id,
      kind,
      payload,
      queuedAt: now(),
      attempts: 0,
      lastAttemptAt: null,
      lastError: null,
    };
    // Last write wins: replacing by id makes enqueueing idempotent, which is
    // what lets callers queue eagerly on every keystroke without piling up.
    const withoutDuplicate = state.operations.filter((entry) => entry.id !== id);
    replace([...withoutDuplicate, operation as OutboxOperation]);
    return operation;
  };

  const resolve = (id: string): boolean => {
    if (!state.operations.some((entry) => entry.id === id)) return false;
    replace(
      state.operations.filter((entry) => entry.id !== id),
      { lastError: null },
    );
    return true;
  };

  const reject = (id: string, error: unknown): boolean => {
    const previous = state;
    let changed = false;
    const next = state.operations.map((entry) => {
      if (entry.id !== id) return entry;
      changed = true;
      return {
        ...entry,
        attempts: entry.attempts + 1,
        lastAttemptAt: now(),
        lastError: describeError(error),
      };
    });
    if (!changed) return false;
    replace(next);
    return state !== previous;
  };

  const pending = (): OutboxOperation[] =>
    [...state.operations].sort((a, b) => a.queuedAt - b.queuedAt);

  const clear = (): void => {
    persist({ ...EMPTY_OUTBOX_STATE, lastDrainedAt: state.lastDrainedAt });
  };

  const compact = (keep: number): OutboxState => {
    const ordered = pending();
    const start = Math.max(0, ordered.length - keep);
    return replace(ordered.slice(start));
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    enqueue,
    resolve,
    reject,
    pending,
    clear,
    compact,
  };
}
