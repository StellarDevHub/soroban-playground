// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Connectivity detection for the offline engine (issue #1525).
 *
 * `navigator.onLine` only reports whether the machine is attached to a network
 * — a captive portal, a dead VPN tunnel or a hard-down backend all report
 * `true`. The monitor therefore layers three signals:
 *
 *  1. `navigator.onLine` for instant transitions (and SSR safety)
 *  2. `online` / `offline` window events
 *  3. an optional lightweight probe (`GET /health`) so a reachable browser can
 *     still be flagged `degraded` when the API is unreachable
 *
 * Failures observed by real requests can also be reported back through
 * {@link ConnectivityMonitor.reportRequestFailure} / `reportRequestSuccess`,
 * which keeps the status honest without waiting for the next probe.
 */

import {
  INITIAL_CONNECTIVITY_STATE,
  type ConnectivityReason,
  type ConnectivityState,
  type ConnectivityStatus,
} from "./types";

export type ConnectivityListener = (
  state: ConnectivityState,
  previous: ConnectivityState,
) => void;

export interface ConnectivityMonitorOptions {
  /** URL fetched to verify the app can actually reach the API. */
  probeUrl?: string | null;
  /** Milliseconds before a probe is abandoned. */
  probeTimeoutMs?: number;
  /** Milliseconds between automatic probes. `0` disables the timer. */
  probeIntervalMs?: number;
  /** Consecutive failures before the status degrades from `online`. */
  failureThreshold?: number;
  /** Injectable clock, for deterministic tests. */
  now?: () => number;
  /** Injectable fetch, for deterministic tests. */
  fetchImpl?: typeof fetch;
}

export interface ConnectivityMonitor {
  getState: () => ConnectivityState;
  subscribe: (listener: ConnectivityListener) => () => void;
  /** Kick off a probe immediately. Safe to call when offline. */
  probe: () => Promise<ConnectivityState>;
  /** Report a failed API request so the status can degrade without a probe. */
  reportRequestFailure: (error?: unknown) => ConnectivityState;
  /** Report a successful API request. */
  reportRequestSuccess: (latencyMs?: number) => ConnectivityState;
  /** Force a status, e.g. from a "Retry" button. */
  setManualStatus: (status: ConnectivityStatus) => ConnectivityState;
  start: () => void;
  destroy: () => void;
}

const DEFAULT_PROBE_TIMEOUT_MS = 4000;
const DEFAULT_PROBE_INTERVAL_MS = 30_000;
const DEFAULT_FAILURE_THRESHOLD = 2;

function getWindow(): Window | null {
  return typeof window === "undefined" ? null : window;
}

function navigatorOnline(): boolean | null {
  if (typeof navigator === "undefined") return null;
  return typeof navigator.onLine === "boolean" ? navigator.onLine : null;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: string }).name === "AbortError"
  );
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Request failed";
}

export function createConnectivityMonitor(
  options: ConnectivityMonitorOptions = {},
): ConnectivityMonitor {
  const {
    probeUrl = null,
    probeTimeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
    probeIntervalMs = DEFAULT_PROBE_INTERVAL_MS,
    failureThreshold = DEFAULT_FAILURE_THRESHOLD,
    now = () => Date.now(),
    fetchImpl,
  } = options;

  const listeners = new Set<ConnectivityListener>();
  let state: ConnectivityState = { ...INITIAL_CONNECTIVITY_STATE };
  let timer: ReturnType<typeof setInterval> | null = null;
  let probeInFlight = false;
  let destroyed = false;

  const emit = (next: ConnectivityState): ConnectivityState => {
    const previous = state;
    const changed =
      previous.status !== next.status ||
      previous.reason !== next.reason ||
      previous.latencyMs !== next.latencyMs ||
      previous.failureCount !== next.failureCount ||
      previous.lastOnlineAt !== next.lastOnlineAt ||
      previous.lastOfflineAt !== next.lastOfflineAt;
    state = next;
    if (changed) {
      for (const listener of listeners) listener(state, previous);
    }
    return state;
  };

  const transition = (
    status: ConnectivityStatus,
    reason: ConnectivityReason,
    patch: Partial<ConnectivityState> = {},
  ): ConnectivityState => {
    const timestamp = now();
    const next: ConnectivityState = {
      ...state,
      status,
      reason,
      ...patch,
      lastOnlineAt: status === "online" ? timestamp : state.lastOnlineAt,
      lastOfflineAt:
        status === "offline" ? timestamp : state.lastOfflineAt,
    };
    return emit(next);
  };

  const handleOnline = (): void => {
    if (navigatorOnline() === false) return;
    transition("online", "navigator", { failureCount: 0 });
    if (probeUrl) void probe();
  };

  const handleOffline = (): void => {
    transition("offline", "navigator");
  };

  const probe = async (): Promise<ConnectivityState> => {
    if (destroyed || probeInFlight) return state;
    if (navigatorOnline() === false) return transition("offline", "navigator");

    const doFetch = fetchImpl ?? (typeof fetch === "function" ? fetch : null);
    if (!probeUrl || !doFetch) {
      return transition("online", "navigator", { failureCount: 0 });
    }

    probeInFlight = true;
    const startedAt = now();
    const controller =
      typeof AbortController === "function" ? new AbortController() : null;
    const timerId = controller
      ? setTimeout(() => controller.abort(), probeTimeoutMs)
      : null;

    try {
      const response = await doFetch(probeUrl, {
        method: "GET",
        cache: "no-store",
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (destroyed) return state;
      if (response && response.ok === false) {
        return reportRequestFailure(
          new Error(`Probe responded ${response.status}`),
        );
      }
      return reportRequestSuccess(now() - startedAt);
    } catch (error) {
      if (destroyed) return state;
      return reportRequestFailure(
        isAbortError(error)
          ? new Error(`Probe timed out after ${probeTimeoutMs}ms`)
          : error,
      );
    } finally {
      if (timerId) clearTimeout(timerId);
      probeInFlight = false;
    }
  };

  const reportRequestFailure = (error?: unknown): ConnectivityState => {
    const failureCount = state.failureCount + 1;
    const navigatorSaysOffline = navigatorOnline() === false;
    if (navigatorSaysOffline) {
      return transition("offline", "navigator", { failureCount });
    }
    return transition(
      failureCount >= failureThreshold ? "degraded" : state.status,
      "request-failure",
      { failureCount },
    );
  };

  const reportRequestSuccess = (latencyMs?: number): ConnectivityState => {
    const measured =
      typeof latencyMs === "number" && Number.isFinite(latencyMs)
        ? Math.max(0, Math.round(latencyMs))
        : state.latencyMs;
    return transition("online", "request-success", {
      failureCount: 0,
      latencyMs: measured,
    });
  };

  const setManualStatus = (status: ConnectivityStatus): ConnectivityState =>
    transition(status, "manual", status === "online" ? { failureCount: 0 } : {});

  const start = (): void => {
    if (destroyed) return;
    const view = getWindow();
    if (view) {
      view.addEventListener("online", handleOnline);
      view.addEventListener("offline", handleOffline);
    }
    if (navigatorOnline() === false) {
      transition("offline", "boot");
    } else {
      transition("online", "boot", { failureCount: 0 });
    }
    if (probeUrl) {
      void probe();
      if (probeIntervalMs > 0) {
        timer = setInterval(() => {
          if (state.status !== "offline") void probe();
        }, probeIntervalMs);
        if (typeof timer === "object" && timer && "unref" in timer) {
          (timer as unknown as { unref: () => void }).unref();
        }
      }
    }
  };

  const destroy = (): void => {
    destroyed = true;
    if (timer) clearInterval(timer);
    timer = null;
    const view = getWindow();
    if (view) {
      view.removeEventListener("online", handleOnline);
      view.removeEventListener("offline", handleOffline);
    }
    listeners.clear();
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    probe,
    reportRequestFailure,
    reportRequestSuccess,
    setManualStatus,
    start,
    destroy,
  };
}
