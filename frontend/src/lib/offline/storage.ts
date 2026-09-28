// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Small SSR-safe storage helper shared by the offline engine (#1525) and the
 * workspace sync layer (#1526).
 *
 * `localStorage` throws in Safari private mode, when a quota is exceeded, and is
 * simply absent while server-rendering. Every access therefore goes through
 * {@link safeStorage}, which degrades to an in-memory map instead of taking the
 * page down.
 */

interface MemoryStorage {
  readonly length: number;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  key: (index: number) => string | null;
  clear: () => void;
}

function createMemoryStorage(): MemoryStorage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    getItem: (key) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    key: (index) => Array.from(store.keys())[index] ?? null,
    clear: () => {
      store.clear();
    },
  };
}

const memoryFallback = createMemoryStorage();

function resolveStorage(): Storage | MemoryStorage {
  if (typeof window === "undefined") return memoryFallback;
  try {
    const probe = window.localStorage;
    if (!probe) return memoryFallback;
    const canary = "__sp_storage_probe__";
    probe.setItem(canary, "1");
    probe.removeItem(canary);
    return probe;
  } catch {
    return memoryFallback;
  }
}

let cached: Storage | MemoryStorage | null = null;

/** Memoised handle on whichever storage is usable right now. */
function store(): Storage | MemoryStorage {
  cached ??= resolveStorage();
  return cached;
}

/** `localStorage` when usable, otherwise a process-local stand-in. */
export const safeStorage: Storage = {
  get length(): number {
    return store().length;
  },
  key(index: number): string | null {
    return store().key(index);
  },
  getItem(key: string): string | null {
    try {
      return store().getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      store().setItem(key, value);
    } catch {
      // Quota exceeded / private mode — the in-memory map already took the
      // write when we fell back, and a hard failure here is not actionable.
    }
  },
  removeItem(key: string): void {
    try {
      store().removeItem(key);
    } catch {
      // ignore
    }
  },
  clear(): void {
    try {
      store().clear();
    } catch {
      // ignore
    }
  },
};

/** Read and JSON-parse a key, returning `fallback` on miss or corruption. */
export function readJson<T>(key: string, fallback: T): T {
  const raw = safeStorage.getItem(key);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as T;
    return parsed ?? fallback;
  } catch {
    // Corrupt payload — drop it so the next write starts from a clean slate.
    safeStorage.removeItem(key);
    return fallback;
  }
}

/** JSON-serialise and store a value. Never throws. */
export function writeJson(key: string, value: unknown): void {
  try {
    safeStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

/** Test seam: forget the memoised storage handle. */
export function resetStorageCache(): void {
  cached = null;
}
