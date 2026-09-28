// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Registers the service worker and relays its Background Sync events to the
 * offline engine (issue #1525).
 *
 * The worker owns the HTTP caches; the page owns the durable outbox (which
 * lives in `localStorage` and is therefore unreachable from a worker). So when
 * the browser fires a `sync` event the worker posts a message and this component
 * asks the engine to drain.
 *
 * Registration is intentionally best-effort: it is skipped in development
 * (where the worker's cached shell would shadow live code), when the browser
 * has no service-worker support, and when the page is not in a secure context.
 */

"use client";

import { useEffect } from "react";
import { useOffline } from "@/components/providers/OfflineProvider";

const SERVICE_WORKER_URL = "/sw.js";

/** Message the worker posts when Background Sync completes. */
const MSG_CLIENTS_FLUSH = "SP_FLUSH_OUTBOX";
/** Message the worker posts once it has activated and claimed clients. */
const MSG_SW_READY = "SP_SW_READY";

/**
 * Development is excluded on purpose: a cached shell would keep serving stale
 * chunks after an edit, which is far more confusing than losing offline support
 * for a few minutes.
 */
function isSupported(): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    window.isSecureContext !== false
  );
}

export function registerServiceWorker(): void {
  if (!isSupported()) return;
  const register = () => {
    navigator.serviceWorker.register(SERVICE_WORKER_URL).catch(() => {
      // Registration failures are non-fatal: the app still works, it just does
      // not get an offline shell.
    });
  };
  // `load` keeps registration off the critical path, but this effect can run
  // after the event has already fired, in which case the listener would never
  // be invoked.
  if (document.readyState === "complete") {
    register();
    return;
  }
  window.addEventListener("load", register, { once: true });
}

export default function ServiceWorkerRegistrar(): null {
  const { flush, setStatus } = useOffline();

  useEffect(() => {
    if (!isSupported()) return;

    const handleMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string } | null;
      if (!data || typeof data.type !== "string") return;
      if (data.type === MSG_CLIENTS_FLUSH) {
        void flush();
        return;
      }
      if (data.type === MSG_SW_READY) {
        // A freshly activated worker means a new deployment is cached; nudge
        // connectivity so a pending push is not stranded.
        setStatus("online");
      }
    };

    navigator.serviceWorker.addEventListener("message", handleMessage);
    registerServiceWorker();

    return () => {
      navigator.serviceWorker.removeEventListener("message", handleMessage);
    };
  }, [flush, setStatus]);

  return null;
}
