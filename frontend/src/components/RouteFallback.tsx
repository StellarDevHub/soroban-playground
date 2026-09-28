// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

"use client";

/**
 * Shared Suspense / loading fallback used by route-level `loading.tsx` files.
 *
 * Since issue #1529 the fallback is *content-aware*: it infers the shape of the
 * route it is standing in for (see `components/skeletons/shape`) so the
 * skeleton already occupies the layout the real panel will use. The previous
 * generic spinner + three bars is kept as the `tone="spinner"` variant for
 * callers that explicitly want it.
 *
 * This is a client component: it reads the pathname with `usePathname` so one
 * `loading.tsx` can serve every segment. It still renders on the server — a
 * `loading.tsx` is prerendered — which is why the pathname is read through a
 * hook rather than a request-time lookup.
 */

import React from "react";
import { usePathname } from "next/navigation";
import { SkeletonForShape } from "@/components/ContentSkeleton";
import {
  inferSkeletonReason,
  inferSkeletonShape,
  skeletonLabel,
} from "@/components/skeletons/shape";

export interface RouteFallbackProps {
  label?: string;
  /** Override the inferred route (useful in a segment's own `loading.tsx`). */
  pathname?: string | null;
  /** `content` (default) renders the shape-matched skeleton. */
  tone?: "content" | "spinner";
  className?: string;
}

export default function RouteFallback({
  label,
  pathname,
  tone = "content",
  className = "",
}: RouteFallbackProps) {
  const routePath = usePathname();
  const resolved = pathname ?? routePath;
  const shape = inferSkeletonShape(resolved);
  const reason = inferSkeletonReason(resolved);
  const text = label ?? skeletonLabel(shape);

  if (tone === "spinner") {
    return (
      <div
        className={[
          "flex min-h-[60vh] w-full flex-col items-center justify-center gap-4 px-6",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <div className="flex items-center gap-3">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-teal-400 border-t-transparent" />
          <span className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
            {text}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={className}
      data-skeleton-shape={shape}
      data-skeleton-reason={reason}
    >
      <p className="sr-only" role="status" aria-live="polite" aria-busy="true">
        {text}
      </p>
      <SkeletonForShape shape={shape} />
    </div>
  );
}
