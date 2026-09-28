// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Soroban Playground service worker (issue #1525).
 *
 * Responsibilities:
 *
 *  - precache the app shell so a cold start works with no network;
 *  - stale-while-revalidate GETs for contract templates and docs, so a template
 *    the user opened before going offline is still editable;
 *  - a navigation fallback to the cached shell (then `/offline`) when the
 *    network is unreachable;
 *  - relay Background Sync completions back to the page, which owns the
 *    durable outbox in `localStorage` and replays it.
 *
 * No build step: this file is served verbatim from `public/`, so it is written
 * in plain ES2018 and avoids any import.
 */

/* eslint-env serviceworker */

const VERSION = "v1";
const SHELL_CACHE = `sp-shell-${VERSION}`;
const RUNTIME_CACHE = `sp-runtime-${VERSION}`;
const TEMPLATE_CACHE = `sp-templates-${VERSION}`;

/** Routes precached on install. Kept small — Next.js chunks are cached lazily. */
const SHELL_ASSETS = [
  "/",
  "/playground",
  "/template-library",
  "/docs",
  "/offline",
  "/manifest.webmanifest",
];

/** GET prefixes worth caching for offline editing. */
const CACHEABLE_PREFIXES = [
  "/api/templates",
  "/api/docs",
  "/api/workspace",
  "/api/favorites",
];

/** Tag Background Sync uses; the page drains the outbox on this event. */
const SYNC_TAG = "sp-outbox-drain";

/** Message types understood by the page. */
const MSG_CLIENTS_FLUSH = "SP_FLUSH_OUTBOX";
const MSG_SW_READY = "SP_SW_READY";
const MSG_SW_CACHE_UPDATED = "SP_SW_CACHE_UPDATED";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) =>
        // `reload` bypasses the HTTP cache so a new deployment never precaches
        // a stale build artefact.
        cache.addAll(
          SHELL_ASSETS.map((url) => new Request(url, { cache: "reload" })),
        ),
      )
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  const keep = new Set([SHELL_CACHE, RUNTIME_CACHE, TEMPLATE_CACHE]);
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("sp-") && !keep.has(key))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim())
      .then(async () => {
        const clients = await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });
        for (const client of clients) client.postMessage({ type: MSG_SW_READY });
      }),
  );
});

function isCacheableGet(url) {
  if (url.method !== "GET") return false;
  return CACHEABLE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

function isTemplateRequest(url) {
  return url.pathname.startsWith("/api/templates");
}

/** Stale-while-revalidate: instant cached body, refresh in the background. */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || (await network) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only GETs are intercepted; POSTs fall through so the page's outbox owns them.
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch (error) {
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (isTemplateRequest(url)) {
    event.respondWith(staleWhileRevalidate(request, TEMPLATE_CACHE));
    return;
  }

  if (isCacheableGet(url)) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  // Same-origin scripts/styles: cache-first so a flaky connection does not
  // break a hydration pass, and refresh in the background.
  if (
    url.pathname.startsWith("/_next/static/") ||
    /\.(css|js|woff2?|svg|png|jpg|jpeg|webp|ico)$/.test(url.pathname)
  ) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((response) => {
            if (response && response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => null);
        return cached || (await network) || Response.error();
      }),
    );
  }
});

async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, response.clone());
      return response;
    }
    throw new Error(`Navigation responded ${response ? response.status : "?"}`);
  } catch (error) {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const shell = await cache.match("/");
    if (shell) return shell;
    const offline = await cache.match("/offline");
    if (offline) return offline;
    return new Response(
      "<!doctype html><title>Offline</title><h1>You are offline</h1>",
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
}

self.addEventListener("sync", (event) => {
  if (event.tag !== SYNC_TAG) return;
  event.waitUntil(notifyClientsToFlush());
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data.type !== "string") return;
  if (data.type === "SP_CACHE_URLS" && Array.isArray(data.urls)) {
    event.waitUntil(precache(data.urls));
  }
  if (data.type === "SP_CLEAR_CACHE") {
    event.waitUntil(clearCaches());
  }
});

/**
 * Background Sync cannot read the page's `localStorage` outbox, so the worker
 * pings every open window and lets the app replay its own queue. Windows that
 * ask for a sync while online re-register the tag so the browser retries for us
 * after a cold start.
 */
async function notifyClientsToFlush() {
  const windows = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  for (const client of windows) {
    client.postMessage({ type: MSG_CLIENTS_FLUSH });
  }
  return windows.length;
}

async function precache(urls) {
  const cache = await caches.open(TEMPLATE_CACHE);
  await Promise.all(
    urls
      .filter((url) => typeof url === "string" && url.length > 0)
      .map((url) => cache.add(new Request(url, { cache: "reload" })).catch(() => undefined)),
  );
  const windows = await self.clients.matchAll({ type: "window" });
  for (const client of windows) {
    client.postMessage({ type: MSG_SW_CACHE_UPDATED, count: urls.length });
  }
}

async function clearCaches() {
  const keys = await caches.keys();
  await Promise.all(
    keys.filter((key) => key.startsWith("sp-")).map((key) => caches.delete(key)),
  );
}
