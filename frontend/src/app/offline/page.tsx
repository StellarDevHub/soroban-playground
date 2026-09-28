// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Offline fallback route (issue #1525).
 *
 * This page is precached by `public/sw.js`, so it is the one page guaranteed to
 * render with no network at all. It therefore has to be useful: it tells the
 * user what is still available locally, how much work is queued, and gives them
 * a way to retry the moment connectivity returns.
 */

"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useOffline } from "@/components/providers/OfflineProvider";
import { useTheme } from "@/components/providers/ThemeProvider";
import { useWallet } from "@/components/providers/WalletProvider";
import { useRecentFiles } from "@/hooks/useRecentFiles";
import { SkeletonShell, SkeletonBlock } from "@/components/skeletons";

/** Shell-routes that are precached and therefore usable with no network. */
const OFFLINE_ROUTES: { href: string; label: string }[] = [
  { href: "/", label: "Dashboard" },
  { href: "/playground", label: "Playground" },
  { href: "/template-library", label: "Template library" },
  { href: "/docs", label: "Documentation" },
  { href: "/offline", label: "This page" },
];

export default function OfflinePage() {
  const { status, isOnline, queuedCount, conflicts, state, flush } = useOffline();
  const { state: theme } = useTheme();
  const { address } = useWallet();
  const { entries } = useRecentFiles();
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  // Re-check as soon as the browser reports it is back, so the page flips to
  // "reconnected" without the user reloading.
  useEffect(() => {
    if (isOnline) setLastChecked(new Date().toLocaleTimeString());
  }, [isOnline]);

  const onRetry = useCallback(() => {
    setLastChecked(new Date().toLocaleTimeString());
    void flush();
  }, [flush]);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
      <div className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-500/10 text-2xl"
        >
          ⚠
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            You&rsquo;re offline
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            The Playground could not reach the API. Your editor, templates and
            workspace are still here &mdash; edits are saved locally and will sync
            automatically once the connection is back.
          </p>
        </div>
      </div>

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Connection
          </p>
          <p className="mt-2 text-sm font-medium text-foreground">
            {status === "offline"
              ? "Disconnected"
              : status === "degraded"
                ? "API unreachable"
                : "Connected"}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Queued changes
          </p>
          <p className="mt-2 text-sm font-medium text-foreground">
            {queuedCount === 0
              ? "Nothing waiting"
              : `${queuedCount} waiting to sync`}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Conflicts
          </p>
          <p className="mt-2 text-sm font-medium text-foreground">
            {conflicts.length === 0
              ? "None"
              : `${conflicts.length} need${conflicts.length === 1 ? "s" : ""} review`}
          </p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onRetry}
          className="pressable rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-teal-400"
        >
          Retry sync
        </button>
        <Link
          href="/playground"
          className="pressable rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
        >
          Keep working offline
        </Link>
        {lastChecked ? (
          <span className="text-xs text-slate-500">Checked at {lastChecked}</span>
        ) : null}
      </div>

      {conflicts.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
            Needs your decision
          </h2>
          <ul className="mt-3 space-y-2">
            {conflicts.map((conflict) => (
              <li
                key={conflict.path}
                className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-sm"
              >
                <span className="font-medium text-amber-200">
                  {conflict.path}
                </span>{" "}
                <span className="text-slate-400">
                  differed between this device and the server, and was resolved
                  by <code className="text-amber-300">{conflict.strategy}</code>.
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
          Available without a network
        </h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {OFFLINE_ROUTES.map((route) => (
            <li key={route.href}>
              <Link
                href={route.href}
                className="pressable inline-block rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-700 hover:text-foreground"
              >
                {route.label}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {entries.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
            Recent
          </h2>
          <ul className="mt-3 divide-y divide-slate-800/70">
            {entries.slice(0, 5).map((entry) => (
              <li key={entry.id} className="py-2.5">
                <Link
                  href={entry.id}
                  className="flex items-baseline justify-between gap-4 text-sm hover:text-teal-300"
                >
                  <span className="truncate text-slate-200">{entry.title}</span>
                  <span className="shrink-0 text-xs text-slate-500">
                    {entry.kind}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <SkeletonShell
          label="Loading recent activity"
          className="mt-10"
          data-testid="offline-recents-skeleton"
        >
          <div className="space-y-3">
            {Array.from({ length: 3 }, (_, index) => (
              <SkeletonBlock
                key={index}
                className="h-3 w-2/3"
                index={index}
              />
            ))}
          </div>
        </SkeletonShell>
      )}

      <footer className="mt-12 border-t border-slate-800 pt-4 text-xs text-slate-600">
        <p>
          Theme: {theme.mode} · Session:{" "}
          {address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "anonymous"}
          {state.connectivity.lastOnlineAt
            ? ` · Last online ${new Date(state.connectivity.lastOnlineAt).toLocaleTimeString()}`
            : ""}
        </p>
      </footer>
    </main>
  );
}
