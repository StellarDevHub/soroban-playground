// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Recent files / recent routes store (issues #1525, #1527).
 *
 * The offline engine writes every route transition and every template the user
 * opens into this log, and the service worker precaches the matching template
 * payloads. Together that means a template opened while online is still
 * *editable* while offline — the source is in the cache, the actions are queued.
 *
 * Storage follows the conventions used by `hooks/useFavorites.ts` and
 * `components/RecentTemplates.tsx`: a module-level key, an SSR guard, a
 * `try/catch` that never throws, hydration in an effect and cross-tab sync via
 * the `storage` event.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { readJson, writeJson } from "@/lib/offline/storage";

export const RECENT_FILES_STORAGE_KEY = "sp:recent-files";
export const RECENT_FILES_CAPACITY = 30;

export type RecentFileKind = "route" | "template" | "contract" | "file";

export interface RecentFile {
  /** Stable id — the href for routes, the template slug otherwise. */
  id: string;
  /** Display title. */
  title: string;
  kind: RecentFileKind;
  /** Epoch ms the entry was last opened. */
  at: number;
  /** Optional extra context shown as a subtitle. */
  detail?: string;
}

function isRecentFile(value: unknown): value is RecentFile {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<RecentFile>;
  return (
    typeof entry.id === "string" &&
    entry.id.length > 0 &&
    typeof entry.title === "string" &&
    typeof entry.at === "number"
  );
}

export function loadRecentFiles(): RecentFile[] {
  const raw = readJson<unknown>(RECENT_FILES_STORAGE_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecentFile).slice(0, RECENT_FILES_CAPACITY);
}

export function saveRecentFiles(entries: RecentFile[]): RecentFile[] {
  const trimmed = entries.slice(0, RECENT_FILES_CAPACITY);
  writeJson(RECENT_FILES_STORAGE_KEY, trimmed);
  return trimmed;
}

/**
 * Prepend an entry, moving an existing id to the front instead of duplicating
 * it. Called on every route change, so it must be cheap and allocation-light.
 */
export function recordRecentFile(
  entries: RecentFile[],
  entry: Omit<RecentFile, "at"> & { at?: number },
): RecentFile[] {
  const at = entry.at ?? Date.now();
  const withoutDuplicate = entries.filter((item) => item.id !== entry.id);
  return [{ ...entry, at }, ...withoutDuplicate].slice(
    0,
    RECENT_FILES_CAPACITY,
  );
}

export interface UseRecentFiles {
  entries: RecentFile[];
  /** Record a visit. */
  record: (entry: Omit<RecentFile, "at"> & { at?: number }) => void;
  /** Remove one entry. */
  remove: (id: string) => void;
  /** Remove every entry. */
  clear: () => void;
}

export function useRecentFiles(): UseRecentFiles {
  const [entries, setEntries] = useState<RecentFile[]>([]);

  useEffect(() => {
    setEntries(loadRecentFiles());

    // Another tab navigated; mirror its log so the palette is consistent.
    const onStorage = (event: StorageEvent) => {
      if (event.key !== RECENT_FILES_STORAGE_KEY) return;
      setEntries(loadRecentFiles());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const record = useCallback(
    (entry: Omit<RecentFile, "at"> & { at?: number }) => {
      setEntries((previous) => saveRecentFiles(recordRecentFile(previous, entry)));
    },
    [],
  );

  const remove = useCallback((id: string) => {
    setEntries((previous) =>
      saveRecentFiles(previous.filter((item) => item.id !== id)),
    );
  }, []);

  const clear = useCallback(() => {
    setEntries(saveRecentFiles([]));
  }, []);

  return { entries, record, remove, clear };
}

export default useRecentFiles;
