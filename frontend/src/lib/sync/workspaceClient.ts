// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * HTTP transport for the workspace snapshot (issue #1526).
 *
 * Deliberately built on `fetch` rather than `lib/apiClient`:
 *
 *  - the circuit breaker in `apiClient` swallows repeated failures, but the
 *    offline engine (#1525) *needs* to observe every failure so it can queue
 *    the operation and show an honest status;
 *  - the endpoints are wallet-scoped (`x-wallet-address`) rather than
 *    token-scoped, matching `backend/src/routes/favorites.js`.
 *
 * Every helper resolves to `null`/a result object instead of throwing on
 * transport failure, so callers can hand the operation to the outbox.
 */

import { env } from "@/lib/env";
import { sanitiseSnapshot, type WorkspaceSnapshot } from "./types";

/** Endpoint paths, relative to the API origin. */
export const WORKSPACE_ENDPOINT = "/api/workspace";
export const WORKSPACE_HISTORY_ENDPOINT = "/api/workspace/history";

export interface TransportResult<T> {
  ok: boolean;
  /** HTTP status, or 0 when the request never reached the server. */
  status: number;
  data: T | null;
  /** Transport-level failure (DNS, offline, CORS, abort). */
  error: string | null;
  /** True when the request never reached the server — i.e. queue and retry. */
  offline: boolean;
}

function ok<T>(status: number, data: T): TransportResult<T> {
  return { ok: true, status, data, error: null, offline: false };
}

function fail<T>(status: number, error: string, offline: boolean): TransportResult<T> {
  return { ok: false, status, data: null, error, offline };
}

function apiUrl(): string {
  return (env.apiUrl ?? "").replace(/\/+$/, "");
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error.trim()) return error.trim();
  return "Network request failed";
}

function headers(walletAddress: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-wallet-address": walletAddress,
  };
}

/**
 * Unwrap the backend's `{ success, data }` envelope.
 *
 * Every route in `backend/src/routes/api.js` answers with that shape, so the
 * payload always lives under `data`. Accepting a bare payload too keeps the
 * client working against a future route that returns the snapshot directly, and
 * `undefined` is handled by the callers' `sanitiseSnapshot` guards.
 */
function unwrap(body: unknown): unknown {
  if (body !== null && typeof body === "object" && "data" in body) {
    return (body as { data: unknown }).data;
  }
  return body;
}

/**
 * Fetch the server snapshot.
 *
 * A 404/204 means "no snapshot yet" and is reported as `ok` with an empty
 * snapshot so the caller can push without special-casing a first run.
 */
export async function fetchWorkspace(
  walletAddress: string,
  init: { signal?: AbortSignal } = {},
): Promise<TransportResult<WorkspaceSnapshot>> {
  if (!walletAddress) {
    return fail<WorkspaceSnapshot>(0, "Wallet address is required", true);
  }

  let response: Response;
  try {
    response = await fetch(`${apiUrl()}${WORKSPACE_ENDPOINT}`, {
      method: "GET",
      headers: headers(walletAddress),
      cache: "no-store",
      ...(init.signal ? { signal: init.signal } : {}),
    });
  } catch (error) {
    return fail<WorkspaceSnapshot>(0, describe(error), true);
  }

  if (response.status === 404 || response.status === 204) {
    return ok(204, sanitiseSnapshot(null));
  }

  if (!response.ok) {
    return fail<WorkspaceSnapshot>(
      response.status,
      `Workspace request failed with status ${response.status}`,
      false,
    );
  }

  try {
    return ok(response.status, sanitiseSnapshot(unwrap(await response.json())));
  } catch (error) {
    return fail<WorkspaceSnapshot>(response.status, describe(error), false);
  }
}

/**
 * Push a snapshot. The server echoes the merged snapshot it stored so the client
 * can converge on the server's answer instead of assuming its own write won.
 */
export async function pushWorkspace(
  walletAddress: string,
  snapshot: WorkspaceSnapshot,
  init: { signal?: AbortSignal } = {},
): Promise<TransportResult<WorkspaceSnapshot>> {
  if (!walletAddress) {
    return fail<WorkspaceSnapshot>(0, "Wallet address is required", true);
  }

  let response: Response;
  try {
    response = await fetch(`${apiUrl()}${WORKSPACE_ENDPOINT}`, {
      method: "POST",
      headers: headers(walletAddress),
      body: JSON.stringify({
        favorites: snapshot.favorites,
        history: snapshot.history,
        workspace: snapshot.workspace,
        updatedAt: snapshot.updatedAt,
        deviceId: snapshot.deviceId,
        // Server-side last-write-wins guard: a write that is older than what is
        // already stored is rejected so a slow device cannot clobber a newer one.
        baseRevision: snapshot.revision,
      }),
      ...(init.signal ? { signal: init.signal } : {}),
    });
  } catch (error) {
    return fail<WorkspaceSnapshot>(0, describe(error), true);
  }

  if (!response.ok) {
    return fail<WorkspaceSnapshot>(
      response.status,
      `Workspace push failed with status ${response.status}`,
      false,
    );
  }

  try {
    return ok(response.status, sanitiseSnapshot(unwrap(await response.json())));
  } catch (error) {
    return fail<WorkspaceSnapshot>(response.status, describe(error), false);
  }
}

/** Fetch just the history log — used by the "recent activity" surfaces. */
export async function fetchWorkspaceHistory(
  walletAddress: string,
  init: { limit?: number; signal?: AbortSignal } = {},
): Promise<TransportResult<WorkspaceSnapshot["history"]>> {
  if (!walletAddress) return fail(0, "Wallet address is required", true);

  const limit =
    typeof init.limit === "number" && init.limit > 0 ? Math.floor(init.limit) : 50;
  const url = `${apiUrl()}${WORKSPACE_HISTORY_ENDPOINT}?limit=${limit}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: headers(walletAddress),
      cache: "no-store",
      ...(init.signal ? { signal: init.signal } : {}),
    });
  } catch (error) {
    return fail(0, describe(error), true);
  }

  if (!response.ok) {
    return fail(response.status, `History request failed (${response.status})`, false);
  }

  try {
    const payload = unwrap(await response.json());
    const body = (payload ?? {}) as { history?: unknown };
    return ok(response.status, sanitiseSnapshot({ history: body.history }).history);
  } catch (error) {
    return fail(response.status, describe(error), false);
  }
}

/** Health probe URL used by the connectivity monitor. */
export function connectivityProbeUrl(): string {
  return `${apiUrl()}/health`;
}
