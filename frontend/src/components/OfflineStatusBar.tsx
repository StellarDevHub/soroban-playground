// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Offline / sync status bar (issue #1525).
 *
 * Sits at the bottom of the shell and answers the two questions a user has
 * when the network is unreliable: "am I online?" and "did my work save?".
 *
 *  - **offline** — persistent amber bar: "Working offline · N changes queued".
 *  - **degraded** — persistent amber dot: the API failed to answer, but the
 *    browser still believes it is online, so a warning is more honest than a
 *    silent queue.
 *  - **online** — a dismissible pill that reports the last successful sync and
 *    can be expanded to show the queue depth and a manual "Sync now".
 *  - **syncing** — shows the in-flight operation.
 *
 * `aria-live="polite"` is deliberate: the transitions between these states
 * happen without user action, so they must be announced but must not interrupt.
 */

"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useOffline } from "@/components/providers/OfflineProvider";
import type { ConnectivityStatus } from "@/lib/offline/types";

const PRESENTATION: Record<
  ConnectivityStatus,
  {
    label: string;
    dot: string;
    chip: string;
    icon: string;
  }
> = {
  unknown: {
    label: "Checking connection",
    dot: "bg-slate-400 animate-pulse",
    chip: "border-slate-600/40 bg-slate-700/20 text-slate-300",
    icon: "◌",
  },
  online: {
    label: "Online",
    dot: "bg-emerald-400",
    chip: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    icon: "✓",
  },
  degraded: {
    label: "API unreachable",
    dot: "bg-amber-400",
    chip: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    icon: "!",
  },
  offline: {
    label: "Offline",
    dot: "bg-amber-400",
    chip: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    icon: "⚠",
  },
};

const SYNCING_PRESENTATION = {
  label: "Syncing",
  dot: "bg-teal-400 animate-pulse",
  chip: "border-teal-500/30 bg-teal-500/10 text-teal-300",
  icon: "↻",
};

function formatRelative(timestamp: number | null): string | null {
  if (timestamp === null) return null;
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * Relative timestamps depend on `Date.now()`, which differs between the server
 * render and hydration. The label therefore stays `null` until after mount, and
 * a 30s interval keeps "synced 2m ago" honest without a re-render storm.
 */
function useRelativeTime(timestamp: number | null): string | null {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    setLabel(formatRelative(timestamp));
    if (timestamp === null) return;
    const timer = setInterval(() => setLabel(formatRelative(timestamp)), 30_000);
    return () => clearInterval(timer);
  }, [timestamp]);

  return label;
}

export default function OfflineStatusBar() {
  const {
    status,
    isOnline,
    isDraining,
    queuedCount,
    conflicts,
    state,
    flush,
  } = useOffline();
  const [expanded, setExpanded] = useState(false);
  const [hidden, setHidden] = useState(false);

  const onFlush = useCallback(() => {
    void flush();
  }, [flush]);

  // `syncing` is a transport state rather than a connectivity state, so it is
  // layered on top of whichever status the network is currently reporting.
  const presentation = isDraining
    ? SYNCING_PRESENTATION
    : PRESENTATION[status];
  const lastSynced = useRelativeTime(state.connectivity.lastOnlineAt);
  const pendingConflicts = conflicts.length;

  // Offline and degraded are states the user must be able to see at a glance,
  // so they ignore the dismiss control.
  if (status === "offline" || status === "degraded") {
    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="offline-status-bar"
        data-status={status}
        className="sticky bottom-0 z-40 border-t border-amber-500/30 bg-amber-950/70 backdrop-blur"
      >
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-3 px-4 py-2 text-xs sm:px-6">
          <span className="flex items-center gap-2 text-amber-200">
            <span aria-hidden="true">{presentation.icon}</span>
            <span className="font-medium">
              {status === "offline"
                ? `Working offline${queuedCount > 0 ? ` · ${queuedCount} change${queuedCount === 1 ? "" : "s"} queued` : ""}`
                : "Can’t reach the API · changes will sync automatically"}
            </span>
          </span>
          <span className="flex items-center gap-3">
            {pendingConflicts > 0 ? (
              <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-200">
                {pendingConflicts} conflict{pendingConflicts === 1 ? "" : "s"}
              </span>
            ) : null}
            {isOnline ? (
              <button
                type="button"
                onClick={onFlush}
                className="pressable rounded-full border border-amber-400/40 px-2.5 py-1 text-[11px] font-medium text-amber-100 hover:bg-amber-400/10"
              >
                Retry now
              </button>
            ) : null}
          </span>
        </div>
      </div>
    );
  }

  if (hidden) return null;

  return (
    <div
        data-testid="offline-status-bar"
        data-status={status}
        data-draining={isDraining ? "true" : "false"}
        className="sticky bottom-0 z-40 flex justify-center px-4 pb-2 sm:px-6"
    >
      <div
        role="status"
        aria-live="polite"
        className={[
          "flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] shadow-lg backdrop-blur transition-all duration-200",
          presentation.chip,
        ].join(" ")}
      >
        <button
          type="button"
          onClick={() => setExpanded((previous) => !previous)}
          aria-expanded={expanded}
          className="flex items-center gap-2 font-medium"
        >
          <span
            aria-hidden="true"
            className={`inline-block h-1.5 w-1.5 rounded-full ${presentation.dot}`}
          />
          {presentation.label}
          {queuedCount > 0 ? (
            <span className="rounded-full bg-current/15 px-1.5 text-[10px]">
              {queuedCount} queued
            </span>
          ) : null}
          {lastSynced ? (
            <span className="text-[10px] opacity-70">synced {lastSynced}</span>
          ) : null}
        </button>

        {expanded ? (
          <span className="flex items-center gap-2 border-l border-current/20 pl-2">
            <button
              type="button"
              onClick={onFlush}
              disabled={queuedCount === 0}
              className="pressable rounded-full bg-current/10 px-2 py-0.5 font-medium disabled:cursor-not-allowed disabled:opacity-40"
            >
              Sync now
            </button>
            <button
              type="button"
              onClick={() => setHidden(true)}
              aria-label="Dismiss status"
              className="rounded-full px-1 text-[10px] opacity-60 hover:opacity-100"
            >
              ✕
            </button>
          </span>
        ) : null}
      </div>
    </div>
  );
}
