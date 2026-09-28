// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Route → skeleton-shape inference (issue #1529).
 *
 * The 30+ panels in this app do not all load the same thing: some are tables,
 * some are editors, some are single documents. `loading.tsx` files are static,
 * so they can only ever show one generic shape. This module maps a pathname to
 * the shape that actually fits, which lets the root `loading.tsx` and
 * `components/RouteFallback` render a skeleton that matches the destination
 * instead of a row of grey bars.
 *
 * The rules are intentionally declarative — a list of `{ test, shape }` entries
 * evaluated in order — so adding a route is a one-line change and the whole
 * table can be asserted in a unit test.
 */

export type SkeletonShape =
  | "article"
  | "card-grid"
  | "chart"
  | "code"
  | "console"
  | "detail"
  | "editor"
  | "form"
  | "list"
  | "search"
  | "stat"
  | "table";

interface ShapeRule {
  /** Human-readable reason, surfaced in the data attribute for debugging. */
  reason: string;
  test: RegExp;
  shape: SkeletonShape;
}

const RULES: ShapeRule[] = [
  // Exact single-page tools first — they are the most specific.
  { reason: "playground", test: /^\/playground\/?$/, shape: "editor" },
  { reason: "wasm-inspector", test: /^\/wasm-inspector\/?$/, shape: "code" },
  { reason: "xdr-decoder", test: /^\/xdr-decoder\/?$/, shape: "form" },
  { reason: "storage-browser", test: /^\/storage-browser\/?$/, shape: "table" },
  { reason: "audit", test: /^\/audit\/?$/, shape: "table" },
  { reason: "compile-dashboard", test: /^\/compile-dashboard\/?$/, shape: "console" },
  { reason: "template-library", test: /^\/template-library\/?$/, shape: "card-grid" },
  { reason: "search", test: /^\/search\/?$/, shape: "search" },
  { reason: "docs", test: /^\/docs(\/|$)/, shape: "article" },
  { reason: "bug-bounty-submit", test: /^\/bug-bounty\/submit\/?$/, shape: "form" },
  { reason: "music-upload", test: /^\/music-licensing\/upload\/?$/, shape: "form" },
  { reason: "wallet-management", test: /^\/wallet-management\/?$/, shape: "form" },
  { reason: "admin", test: /^\/admin(\/|$)/, shape: "table" },
  { reason: "rate-limits", test: /^\/rate-limits\/?$/, shape: "chart" },
  { reason: "oracle", test: /^\/oracle(\/|$)/, shape: "chart" },
  { reason: "price-aggregator", test: /^\/price-aggregator\/?$/, shape: "chart" },
  { reason: "sports", test: /^\/sports(\/|$)/, shape: "card-grid" },
  { reason: "governance-history", test: /^\/governance\/history\/?$/, shape: "table" },
  { reason: "treasury", test: /^\/treasury\/?$/, shape: "table" },
  { reason: "patents", test: /^\/patents\/?$/, shape: "table" },
  { reason: "patent-registry", test: /^\/patent-registry\/?$/, shape: "detail" },
  { reason: "reit", test: /^\/reit\/?$/, shape: "stat" },
  { reason: "yield-optimizer", test: /^\/yield-optimizer\/?$/, shape: "chart" },
  { reason: "offline", test: /^\/offline\/?$/, shape: "list" },
];

/** Fallback for the many "list of things with a header" routes. */
const DEFAULT_SHAPE: SkeletonShape = "list";

/**
 * Infer the skeleton shape for a route.
 *
 * Query strings and hashes are stripped first so `/search?q=wasm` is judged on
 * `/search`.
 */
export function inferSkeletonShape(pathname: string | null | undefined): SkeletonShape {
  if (!pathname || pathname.length === 0) return "stat";
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  for (const rule of RULES) {
    if (rule.test.test(path)) return rule.shape;
  }
  return DEFAULT_SHAPE;
}

/** The matching rule's reason, for `data-skeleton-reason` debugging. */
export function inferSkeletonReason(
  pathname: string | null | undefined,
): string {
  if (!pathname) return "no-pathname";
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  for (const rule of RULES) {
    if (rule.test.test(path)) return rule.reason;
  }
  return "default";
}

/** Human label for the loading region. */
export function skeletonLabel(shape: SkeletonShape): string {
  switch (shape) {
    case "article":
      return "Loading documentation…";
    case "card-grid":
      return "Loading cards…";
    case "chart":
      return "Loading chart data…";
    case "code":
      return "Loading inspector…";
    case "console":
      return "Loading compile output…";
    case "detail":
      return "Loading record…";
    case "editor":
      return "Loading editor…";
    case "form":
      return "Loading form…";
    case "list":
      return "Loading list…";
    case "search":
      return "Loading results…";
    case "stat":
      return "Loading metrics…";
    case "table":
      return "Loading table…";
    default:
      return "Loading workspace…";
  }
}
