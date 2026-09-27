import React from "react";

export interface RouteFallbackProps {
  label?: string;
}

/**
 * Shared Suspense/loading fallback used by route-level `loading.tsx` files so
 * every deferred chunk resolves behind the same skeleton.
 */
export default function RouteFallback({ label = "Loading workspace…" }: RouteFallbackProps) {
  return (
    <div
      className="flex min-h-[60vh] w-full flex-col items-center justify-center gap-4 px-6"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex items-center gap-3">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-teal-400 border-t-transparent" />
        <span className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
          {label}
        </span>
      </div>

      <div className="w-full max-w-3xl space-y-3">
        <div className="h-3 w-1/3 animate-pulse rounded-full bg-slate-800" />
        <div className="h-24 animate-pulse rounded-2xl bg-slate-900/80" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="h-16 animate-pulse rounded-xl bg-slate-900/70" />
          <div className="h-16 animate-pulse rounded-xl bg-slate-900/70" />
          <div className="h-16 animate-pulse rounded-xl bg-slate-900/70" />
        </div>
      </div>
    </div>
  );
}
