// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Content-aware route fallback (issue #1529).
 *
 * Replaces the single generic "loading…" screen used by every `loading.tsx`
 * with a skeleton that matches the shape of the route being entered. The shape
 * comes from `lib/skeletons/shape`, so `/storage-browser` gets a table,
 * `/playground` gets an editor and `/docs` gets an article.
 *
 * Usage from a route segment:
 *
 * ```tsx
 * import ContentSkeleton from "@/components/ContentSkeleton";
 * export default function Loading() {
 *   return <ContentSkeleton label="Loading Template Library…" />;
 * }
 * ```
 *
 * With no `pathname` prop the component infers the shape from
 * `usePathname()`, which is what the app-level fallback wants.
 */

"use client";

import React, { useMemo } from "react";
import { usePathname } from "next/navigation";
import {
  ArticleSkeleton,
  CardGridSkeleton,
  ChartSkeleton,
  CodeBlockSkeleton,
  ConsoleSkeleton,
  DetailSkeleton,
  EditorSkeleton,
  FormSkeleton,
  ListSkeleton,
  SearchResultSkeleton,
  StatSkeleton,
  TableSkeleton,
  type SkeletonAnimation,
} from "@/components/skeletons";
import {
  inferSkeletonReason,
  inferSkeletonShape,
  skeletonLabel,
  type SkeletonShape,
} from "@/components/skeletons/shape";

export interface ContentSkeletonProps {
  /** Overrides the inferred route. */
  pathname?: string | null;
  /** Overrides the shape label while keeping the inferred shape. */
  label?: string;
  animation?: SkeletonAnimation;
  className?: string;
}

/** Render the skeleton body for a shape. */
export function SkeletonForShape({
  shape,
}: {
  shape: SkeletonShape;
}): React.ReactElement {
  switch (shape) {
    case "article":
      return <ArticleSkeleton />;
    case "card-grid":
      return <CardGridSkeleton />;
    case "chart":
      return <ChartSkeleton />;
    case "code":
      return <CodeBlockSkeleton />;
    case "console":
      return <ConsoleSkeleton />;
    case "detail":
      return <DetailSkeleton />;
    case "editor":
      return <EditorSkeleton />;
    case "form":
      return <FormSkeleton />;
    case "search":
      return <SearchResultSkeleton />;
    case "stat":
      return <StatSkeleton />;
    case "table":
      return <TableSkeleton />;
    case "list":
    default:
      return <ListSkeleton />;
  }
}

export function ContentSkeleton({
  pathname,
  label,
  animation = "shimmer",
  className = "",
}: ContentSkeletonProps) {
  const routePath = usePathname();
  const resolved = pathname ?? routePath;
  const shape = useMemo(() => inferSkeletonShape(resolved), [resolved]);
  const reason = useMemo(() => inferSkeletonReason(resolved), [resolved]);

  return (
    <div
      className={["w-full px-4 py-6 sm:px-6", className].filter(Boolean).join(" ")}
      data-skeleton-shape={shape}
      data-skeleton-reason={reason}
      data-skeleton-animation={animation}
    >
      <p className="sr-only" role="status" aria-live="polite" aria-busy="true">
        {label ?? skeletonLabel(shape)}
      </p>
      <div
        className={
          animation === "none"
            ? ""
            : `skeleton-skeleton skeleton-anim-${animation}`
        }
      >
        <SkeletonForShape shape={shape} />
      </div>
    </div>
  );
}

export default ContentSkeleton;
