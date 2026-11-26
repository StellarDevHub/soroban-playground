// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * ACID Transactional Storage Layer for Offline Outbox Mutations using IndexedDB.
 *
 * Implements durable persistence with atomic readwrite transactions.
 * If IndexedDB is blocked, unavailable, or in SSR, gracefully falls back to memory.
 */

import type { OutboxOperation } from "./types";

export const IDB_DATABASE_NAME = "sp_offline_store_v1";
export const IDB_STORE_NAME = "outbox_mutations";
export const IDB_VERSION = 1;

let dbInstance: IDBDatabase | null = null;
let dbOpenPromise: Promise<IDBDatabase | null> | null = null;

export function isIndexedDbSupported(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

export function openOfflineDatabase(): Promise<IDBDatabase | null> {
  if (!isIndexedDbSupported()) return Promise.resolve(null);
  if (dbInstance) return Promise.resolve(dbInstance);
  if (dbOpenPromise) return dbOpenPromise;

  dbOpenPromise = new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(IDB_DATABASE_NAME, IDB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
          const store = db.createObjectStore(IDB_STORE_NAME, { keyPath: "id" });
          store.createIndex("queuedAt", "queuedAt", { unique: false });
          store.createIndex("kind", "kind", { unique: false });
        }
      };

      request.onsuccess = () => {
        dbInstance = request.result;
        dbInstance.onversionchange = () => {
          dbInstance?.close();
          dbInstance = null;
        };
        resolve(dbInstance);
      };

      request.onerror = () => {
        // Private mode or storage quota restriction
        resolve(null);
      };

      request.onblocked = () => {
        resolve(null);
      };
    } catch {
      resolve(null);
    }
  });

  return dbOpenPromise;
}

export async function idbPutOperation<T>(operation: OutboxOperation<T>): Promise<boolean> {
  const db = await openOfflineDatabase();
  if (!db) return false;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_NAME, "readwrite");
      const store = tx.objectStore(IDB_STORE_NAME);
      const req = store.put(operation);

      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function idbDeleteOperation(id: string): Promise<boolean> {
  const db = await openOfflineDatabase();
  if (!db) return false;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_NAME, "readwrite");
      const store = tx.objectStore(IDB_STORE_NAME);
      const req = store.delete(id);

      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function idbGetPendingOperations(): Promise<OutboxOperation[]> {
  const db = await openOfflineDatabase();
  if (!db) return [];

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_NAME, "readonly");
      const store = tx.objectStore(IDB_STORE_NAME);
      const index = store.index("queuedAt");
      const req = index.getAll();

      req.onsuccess = () => {
        const results = req.result as OutboxOperation[];
        resolve(Array.isArray(results) ? results : []);
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export async function idbClearOperations(): Promise<boolean> {
  const db = await openOfflineDatabase();
  if (!db) return false;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_NAME, "readwrite");
      const store = tx.objectStore(IDB_STORE_NAME);
      const req = store.clear();

      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/** Test helper to reset connection */
export function resetIndexedDbConnection(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // ignore
    }
    dbInstance = null;
  }
  dbOpenPromise = null;
}
