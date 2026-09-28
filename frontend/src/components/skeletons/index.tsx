// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Content-shaped skeleton catalogue (issue #1529).
 *
 * A generic "three grey bars" spinner tells the user nothing. These skeletons
 * mirror the *shape* of the content that is coming — a table has columns, a
 * chart has axes, an editor has a gutter and line numbers — so the layout does
 * not jump when real data lands, and the eye lands in the right place
 * immediately.
 *
 * Every skeleton shares one grammar:
 *  - `.skeleton-block` is the base shape (surface + rounded corners);
 *  - `.skeleton-shimmer` sweeps a highlight across it;
 *  - `.skeleton-skeleton[data-stagger]` offsets each child so the animation
 *    travels down the block rather than pulsing in unison.
 *
 * All motion is CSS-driven and disabled under `prefers-reduced-motion`, so
 * there is no animation runtime to ship and nothing to keep in sync.
 */

import React from "react";
import type { HighlightSegment } from "@/lib/fuzzySearch";

export type SkeletonAnimation = "shimmer" | "pulse" | "none";

export interface SkeletonBlockProps {
  className?: string;
  /** Stagger index, used to offset the shimmer. */
  index?: number;
  animation?: SkeletonAnimation;
  /** Render as a circle instead of a rounded rectangle. */
  circle?: boolean;
  style?: React.CSSProperties;
  "data-testid"?: string;
}

/** A single placeholder block. */
export function SkeletonBlock({
  className = "",
  index = 0,
  animation = "shimmer",
  circle = false,
  style,
  "data-testid": testId = "skeleton-block",
}: SkeletonBlockProps) {
  // `--stagger-index` is what `globals.css` multiplies by `--stagger-step` to
  // travel the shimmer down the block instead of pulsing in unison.
  const customProperty = {
    "--stagger-index": String(index),
  } as React.CSSProperties;

  return (
    <span
      aria-hidden="true"
      data-testid={testId}
      data-stagger={index}
      data-animation={animation}
      className={[
        "skeleton-block",
        `skeleton-anim-${animation}`,
        circle ? "rounded-full" : "rounded-md",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={Object.assign(customProperty, style)}
    />
  );
}

export interface SkeletonShellProps {
  /** Accessible label announced to screen readers. */
  label: string;
  className?: string;
  children: React.ReactNode;
  "data-testid"?: string;
}

/**
 * Wraps a skeleton in a `role="status"` region. Screen readers get the label
 * once; the individual blocks stay `aria-hidden`.
 */
export function SkeletonShell({
  label,
  className = "",
  children,
  "data-testid": testId = "content-skeleton",
}: SkeletonShellProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label={label}
      data-testid={testId}
      className={["skeleton-skeleton layout-stagger", className]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export function StatSkeleton({ count = 4 }: { count?: number }) {
  return (
    <SkeletonShell label="Loading metrics" data-testid="stat-skeleton">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: count }, (_, index) => (
          <div
            key={index}
            className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"
          >
            <SkeletonBlock className="h-3 w-1/2" index={index} />
            <SkeletonBlock className="mt-3 h-7 w-2/3" index={index + 1} />
            <SkeletonBlock className="mt-2 h-2 w-1/3" index={index + 2} />
          </div>
        ))}
      </div>
    </SkeletonShell>
  );
}

export interface TableSkeletonProps {
  rows?: number;
  columns?: number;
  /** Show the header band. */
  showHeader?: boolean;
}

export function TableSkeleton({
  rows = 6,
  columns = 4,
  showHeader = true,
}: TableSkeletonProps) {
  return (
    <SkeletonShell label="Loading table" data-testid="table-skeleton">
      <div className="overflow-hidden rounded-xl border border-slate-800">
        {showHeader ? (
          <div className="flex gap-4 border-b border-slate-800 bg-slate-900/70 px-4 py-3">
            {Array.from({ length: columns }, (_, column) => (
              <SkeletonBlock
                key={column}
                className="h-3 flex-1"
                index={column}
              />
            ))}
          </div>
        ) : null}
        <div className="divide-y divide-slate-800/70">
          {Array.from({ length: rows }, (_, row) => (
            <div key={row} className="flex items-center gap-4 px-4 py-3">
              <SkeletonBlock
                circle
                className="h-7 w-7 shrink-0"
                index={row}
              />
              <SkeletonBlock
                className="h-3 flex-1"
                index={row + 1}
                style={{ maxWidth: `${90 - (row % 3) * 18}%` }}
              />
              <SkeletonBlock
                className="h-3 w-16 shrink-0"
                index={row + 2}
              />
            </div>
          ))}
        </div>
      </div>
    </SkeletonShell>
  );
}

export function ListSkeleton({
  count = 5,
  showAvatars = true,
}: {
  count?: number;
  showAvatars?: boolean;
}) {
  return (
    <SkeletonShell label="Loading list" data-testid="list-skeleton">
      <ul className="divide-y divide-slate-800/70">
        {Array.from({ length: count }, (_, index) => (
          <li key={index} className="flex items-center gap-3 py-3">
            {showAvatars ? (
              <SkeletonBlock circle className="h-8 w-8 shrink-0" index={index} />
            ) : null}
            <span className="min-w-0 flex-1">
              <SkeletonBlock
                className="h-3"
                index={index + 1}
                style={{ maxWidth: `${80 - (index % 4) * 12}%` }}
              />
              <SkeletonBlock className="mt-2 h-2 w-1/3" index={index + 2} />
            </span>
          </li>
        ))}
      </ul>
    </SkeletonShell>
  );
}

export function CardGridSkeleton({
  count = 6,
  columns = 3,
}: {
  count?: number;
  columns?: number;
}) {
  const gridClass =
    columns === 4
      ? "sm:grid-cols-2 lg:grid-cols-4"
      : columns === 2
        ? "sm:grid-cols-2"
        : "sm:grid-cols-2 lg:grid-cols-3";

  return (
    <SkeletonShell label="Loading cards" data-testid="card-grid-skeleton">
      <div className={`grid grid-cols-1 gap-4 ${gridClass}`}>
        {Array.from({ length: count }, (_, index) => (
          <div
            key={index}
            className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4"
          >
            <SkeletonBlock className="h-24 w-full rounded-lg" index={index} />
            <SkeletonBlock className="mt-4 h-3 w-2/3" index={index + 1} />
            <SkeletonBlock
              className="mt-2 h-2"
              index={index + 2}
              style={{ maxWidth: `${70 - (index % 3) * 15}%` }}
            />
            <div className="mt-4 flex gap-2">
              <SkeletonBlock className="h-6 w-16 rounded-full" index={index + 3} />
              <SkeletonBlock className="h-6 w-12 rounded-full" index={index + 4} />
            </div>
          </div>
        ))}
      </div>
    </SkeletonShell>
  );
}

export function ChartSkeleton({
  bars = 18,
  showAxis = true,
}: {
  bars?: number;
  showAxis?: boolean;
}) {
  return (
    <SkeletonShell label="Loading chart" data-testid="chart-skeleton">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="mb-4 flex items-center justify-between">
          <SkeletonBlock className="h-3 w-32" />
          <SkeletonBlock className="h-6 w-20 rounded-full" index={1} />
        </div>
        <div className="flex h-40 items-end gap-1.5">
          {Array.from({ length: bars }, (_, index) => (
            <SkeletonBlock
              key={index}
              className="flex-1 rounded-t"
              index={index}
              style={{ height: `${35 + ((index * 37) % 60)}%` }}
            />
          ))}
        </div>
        {showAxis ? (
          <div className="mt-3 flex justify-between">
            {Array.from({ length: 5 }, (_, index) => (
              <SkeletonBlock key={index} className="h-2 w-8" index={index} />
            ))}
          </div>
        ) : null}
      </div>
    </SkeletonShell>
  );
}

export function EditorSkeleton({
  lines = 18,
  showGutter = true,
}: {
  lines?: number;
  showGutter?: boolean;
}) {
  // Deterministic pseudo-indentation: a real editor is never uniformly nested.
  const widths = [100, 72, 88, 60, 96, 84, 52, 90, 68, 80, 94, 58, 86, 76, 92];

  return (
    <SkeletonShell
      label="Loading editor"
      data-testid="editor-skeleton"
      className="code-surface rounded-xl border border-slate-800"
    >
      <div className="flex font-mono text-xs leading-6">
        {showGutter ? (
          <div className="w-12 shrink-0 border-r border-slate-800/70 py-3 text-right">
            {Array.from({ length: lines }, (_, index) => (
              <div key={index} className="pr-3">
                <SkeletonBlock className="ml-auto h-2 w-4" index={index} />
              </div>
            ))}
          </div>
        ) : null}
        <div className="min-w-0 flex-1 py-3">
          {Array.from({ length: lines }, (_, index) => (
            <div key={index} className="px-4">
              <SkeletonBlock
                className="h-2.5"
                index={index}
                style={{ maxWidth: `${widths[index % widths.length]}%` }}
              />
            </div>
          ))}
        </div>
      </div>
    </SkeletonShell>
  );
}

export function FormSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <SkeletonShell label="Loading form" data-testid="form-skeleton">
      <div className="space-y-4">
        {Array.from({ length: fields }, (_, index) => (
          <div key={index} className="space-y-1.5">
            <SkeletonBlock className="h-2.5 w-28" index={index} />
            <SkeletonBlock
              className="h-9 w-full rounded-lg"
              index={index + 1}
            />
          </div>
        ))}
        <div className="flex gap-2 pt-2">
          <SkeletonBlock className="h-9 w-28 rounded-lg" index={fields} />
          <SkeletonBlock
            className="h-9 w-20 rounded-lg"
            index={fields + 1}
          />
        </div>
      </div>
    </SkeletonShell>
  );
}

export function ConsoleSkeleton({ lines = 8 }: { lines?: number }) {
  return (
    <SkeletonShell
      label="Loading console"
      data-testid="console-skeleton"
      className="code-surface rounded-xl border border-slate-800 p-3"
    >
      <div className="space-y-1.5 font-mono text-xs">
        {Array.from({ length: lines }, (_, index) => (
          <div key={index} className="flex gap-2">
            <SkeletonBlock className="h-2.5 w-10 shrink-0" index={index} />
            <SkeletonBlock
              className="h-2.5"
              index={index + 1}
              style={{ maxWidth: `${90 - (index % 5) * 15}%` }}
            />
          </div>
        ))}
      </div>
    </SkeletonShell>
  );
}

export function CodeBlockSkeleton({ lines = 10 }: { lines?: number }) {
  return (
    <SkeletonShell label="Loading code sample" data-testid="code-block-skeleton">
      <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        {Array.from({ length: lines }, (_, index) => (
          <div key={index} className="flex gap-3">
            <SkeletonBlock className="h-2.5 w-6 shrink-0" index={index} />
            <SkeletonBlock
              className="h-2.5"
              index={index + 1}
              style={{ maxWidth: `${95 - (index % 4) * 20}%` }}
            />
          </div>
        ))}
      </div>
    </SkeletonShell>
  );
}

export function DetailSkeleton() {
  return (
    <SkeletonShell label="Loading details" data-testid="detail-skeleton">
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <SkeletonBlock className="h-8 w-1/2" />
          <SkeletonBlock className="h-3 w-full" index={1} />
          <SkeletonBlock className="h-3 w-11/12" index={2} />
          <SkeletonBlock className="h-3 w-4/5" index={3} />
          <CodeBlockSkeleton lines={8} />
        </div>
        <div className="space-y-3">
          {Array.from({ length: 4 }, (_, index) => (
            <div
              key={index}
              className="rounded-xl border border-slate-800 bg-slate-900/60 p-3"
            >
              <SkeletonBlock className="h-2 w-1/2" index={index} />
              <SkeletonBlock className="mt-2 h-3 w-3/4" index={index + 1} />
            </div>
          ))}
        </div>
      </div>
    </SkeletonShell>
  );
}

/** Combines a heading, two paragraphs and a card row — the docs-page shape. */
export function ArticleSkeleton() {
  return (
    <SkeletonShell label="Loading article" data-testid="article-skeleton">
      <div className="max-w-3xl space-y-4">
        <SkeletonBlock className="h-9 w-2/3" />
        <SkeletonBlock className="h-3 w-1/3" index={1} />
        <div className="space-y-2 pt-4">
          {Array.from({ length: 8 }, (_, index) => (
            <SkeletonBlock
              key={index}
              className="h-3"
              index={index + 2}
              style={{ maxWidth: `${100 - (index % 4) * 12}%` }}
            />
          ))}
        </div>
      </div>
    </SkeletonShell>
  );
}

/** Renders a highlight result while its body is still being fetched. */
export function SearchResultSkeleton({ count = 5 }: { count?: number }) {
  return (
    <SkeletonShell label="Loading results" data-testid="search-result-skeleton">
      <ul className="space-y-3">
        {Array.from({ length: count }, (_, index) => (
          <li
            key={index}
            className="rounded-xl border border-slate-800 bg-slate-900/50 p-4"
          >
            <SkeletonBlock className="h-3 w-1/3" index={index} />
            <SkeletonBlock className="mt-2 h-2.5 w-full" index={index + 1} />
            <SkeletonBlock
              className="mt-2 h-2.5 w-2/3"
              index={index + 2}
            />
          </li>
        ))}
      </ul>
    </SkeletonShell>
  );
}

/** Placeholder matching a set of highlighted segments (palette / search rows). */
export function HighlightSkeleton({
  segments,
  className = "",
}: {
  segments: HighlightSegment[];
  className?: string;
}) {
  return (
    <span className={["flex flex-wrap gap-1", className].filter(Boolean).join(" ")}>
      {segments.map((segment, index) => (
        <SkeletonBlock
          key={index}
          className={segment.match ? "h-3 w-10" : "h-3 w-20"}
          index={index}
        />
      ))}
    </span>
  );
}
