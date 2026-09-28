// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Deterministic conflict resolution for the offline engine (issue #1525).
 *
 * Two devices edit the same record while one of them is offline. On reconnect
 * the client has a `local` and a `remote` copy and must converge without losing
 * data or silently clobbering the newer edit. The rules implemented here are
 * deliberately boring and total — same inputs always produce the same output —
 * because a merge that depends on wall-clock ordering at replay time is how
 * "phantom" reverts happen.
 *
 * Strategy selection:
 *
 * | shape                       | strategy       |
 * | --------------------------- | -------------- |
 * | set of ids (favorites, tags) | `union`       |
 * | append-only log (history)   | `append`       |
 * | whole document (workspace)  | `newest-wins`  |
 * | scalar field                | `newest-wins`  |
 * | divergent, non-mergeable    | `manual`       |
 */

import type { Conflict, ConflictStrategy, MergeOutcome, Versioned } from "./types";

/**
 * Tie-break for equal timestamps: the lexicographically smaller `deviceId`
 * wins, so every device computes the same answer from the same pair.
 */
function prefersLocal(local: Versioned, remote: Versioned): boolean {
  if (local.updatedAt !== remote.updatedAt) {
    return local.updatedAt > remote.updatedAt;
  }
  const localDevice = local.deviceId ?? "";
  const remoteDevice = remote.deviceId ?? "";
  if (localDevice === remoteDevice) return true;
  return localDevice < remoteDevice;
}

function asVersioned(value: unknown): Versioned {
  if (typeof value !== "object" || value === null) {
    return { updatedAt: 0 };
  }
  const candidate = value as Partial<Versioned>;
  return {
    updatedAt:
      typeof candidate.updatedAt === "number" && Number.isFinite(candidate.updatedAt)
        ? candidate.updatedAt
        : 0,
    deviceId: typeof candidate.deviceId === "string" ? candidate.deviceId : undefined,
  };
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== "object") return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Order-preserving union of two id lists. Ids keep their first-seen position,
 * so a favorite that predates everything else stays at the top of the list.
 */
export function unionIds(
  local: readonly string[],
  remote: readonly string[],
): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const id of [...local, ...remote]) {
    if (typeof id !== "string" || id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    merged.push(id);
  }
  return merged;
}

export interface LogEntry {
  id: string;
  [key: string]: unknown;
}

/**
 * Append-only merge for history/deployment logs. Entries are keyed by `id`,
 * sorted by `at` ascending, and a re-ordered entry is resolved in favour of the
 * newer copy so a late-arriving log replay cannot rewind the timeline.
 */
export function appendLog<T extends LogEntry>(
  local: readonly T[],
  remote: readonly T[],
): T[] {
  const byId = new Map<string, T>();
  const order: string[] = [];

  const ingest = (entries: readonly T[], replaceExisting: boolean): void => {
    for (const entry of entries) {
      if (!entry || typeof entry.id !== "string" || entry.id.length === 0) continue;
      const existing = byId.get(entry.id);
      if (existing && !replaceExisting) continue;
      if (!existing) order.push(entry.id);
      byId.set(entry.id, entry);
    }
  };

  ingest(local, false);
  ingest(remote, true);

  return order
    .map((id) => byId.get(id) as T)
    .sort((a, b) => {
      const left = typeof a.at === "number" ? a.at : 0;
      const right = typeof b.at === "number" ? b.at : 0;
      if (left !== right) return left - right;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

function isIdList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "string" && entry.length > 0)
  );
}

function isLog(value: unknown): value is LogEntry[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as LogEntry).id === "string",
    )
  );
}

/**
 * Pick the strategy that fits the shape of `local` / `remote`. Callers can
 * override it when they know better (e.g. a field the user explicitly pinned).
 */
export function inferStrategy(local: unknown, remote: unknown): ConflictStrategy {
  if (isIdList(local) && isIdList(remote)) return "union";
  if (isLog(local) && isLog(remote)) return "append";
  return "newest-wins";
}

/**
 * Merge one field.
 *
 * `path` is only used to label the returned conflict, and `strategy` defaults to
 * {@link inferStrategy}.
 */
export function resolveField<T>(
  path: string,
  local: T,
  remote: T,
  localVersion: Versioned,
  remoteVersion: Versioned,
  strategy: ConflictStrategy = inferStrategy(local, remote),
): MergeOutcome<T> {
  if (sameValue(local, remote)) {
    return { value: local, conflicts: [], dirty: false };
  }

  switch (strategy) {
    case "union": {
      if (!isIdList(local) || !isIdList(remote)) break;
      const value = unionIds(local, remote) as unknown as T;
      return {
        value,
        conflicts: [
          { path, local, remote, strategy, resolution: "merged" },
        ],
        dirty: !sameValue(value, local),
      };
    }
    case "append": {
      if (!isLog(local) || !isLog(remote)) break;
      const value = appendLog(local, remote) as unknown as T;
      return {
        value,
        conflicts: [
          { path, local, remote, strategy, resolution: "merged" },
        ],
        dirty: !sameValue(value, local),
      };
    }
    case "local-wins":
      return {
        value: local,
        conflicts: [{ path, local, remote, strategy, resolution: "local" }],
        dirty: false,
      };
    case "remote-wins":
      return {
        value: remote,
        conflicts: [{ path, local, remote, strategy, resolution: "remote" }],
        dirty: false,
      };
    case "newest-wins":
    default: {
      if (strategy === "newest-wins" || strategy === undefined) {
        const localWins = prefersLocal(localVersion, remoteVersion);
        return {
          value: (localWins ? local : remote) as T,
          conflicts: [
            {
              path,
              local,
              remote,
              strategy: "newest-wins",
              resolution: localWins ? "local" : "remote",
            },
          ],
          dirty: !localWins,
        };
      }
      break;
    }
  }

  // Unreconcilable without a human decision.
  return {
    value: local,
    conflicts: [{ path, local, remote, strategy: "manual", resolution: "manual" }],
    dirty: false,
  };
}

/** Result of merging two flat records keyed by field name. */
export interface RecordMerge<TLocal extends object, TRemote extends object> {
  value: TLocal;
  conflicts: Conflict[];
  /** True when the merged record must be pushed to the server. */
  dirty: boolean;
  /** Conflicts that a human still has to resolve. */
  manual: Conflict[];
}

/**
 * Merge two versioned records field by field.
 *
 * Fields only present on one side are taken as-is. `overrides` lets a caller pin
 * a strategy per field — the workspace document uses it to keep a pinned
 * sidebar width local-only.
 */
export function mergeRecords<
  TLocal extends Record<string, unknown>,
  TRemote extends Record<string, unknown>,
>(
  local: TLocal,
  remote: TRemote,
  options: {
    localVersion?: Versioned;
    remoteVersion?: Versioned;
    overrides?: Record<string, ConflictStrategy>;
  } = {},
): RecordMerge<TLocal, TRemote> {
  const localVersion = options.localVersion ?? asVersioned(local);
  const remoteVersion = options.remoteVersion ?? asVersioned(remote);
  const overrides = options.overrides ?? {};

  const merged: Record<string, unknown> = { ...remote };
  const conflicts: Conflict[] = [];
  let dirty = false;

  for (const key of Object.keys(local)) {
    if (!(key in remote)) {
      merged[key] = local[key];
      continue;
    }
    const outcome = resolveField(
      key,
      local[key],
      remote[key],
      localVersion,
      remoteVersion,
      overrides[key] ?? inferStrategy(local[key], remote[key]),
    );
    merged[key] = outcome.value;
    conflicts.push(...outcome.conflicts);
    if (outcome.dirty) dirty = true;
  }

  return {
    value: merged as TLocal,
    conflicts,
    dirty,
    manual: conflicts.filter((conflict) => conflict.resolution === "manual"),
  };
}
