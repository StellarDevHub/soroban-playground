// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Categorized item registry behind the Spotlight palette (issue #1725).
 *
 * While `lib/commandRegistry` (issue #1527) powers the searchable *index*,
 * this module defines the palette's *action surface*: the grouped set of
 * commands a power user reaches for with a keyboard. Five groups are
 * required by the issue — Navigation, Build, Deploy, Wallets and Settings —
 * and every item can carry a default keybinding that the user may rebind.
 *
 * Ranking delegates to `lib/fuzzySearch` (the same scored-subsequence engine
 * the #1527 palette uses), so query characters are scored and the matched
 * indices are kept for highlighting. Results are painted group by group, and
 * the keyboard walks the painted order.
 */

import {
  highlightSegments,
  rankItems,
  type HighlightSegment,
} from "@/lib/fuzzySearch";
import type { NavigationItem } from "@/lib/navigation";
import type { KeyChord } from "@/lib/spotlightKeybindings";

/**
 * The groups required by the issue, painted in this order. Build and Deploy
 * come before Settings because they are the high-frequency "keyboard maestro"
 * gestures the palette exists to accelerate.
 */
export const SPOTLIGHT_GROUPS = [
  "Navigation",
  "Build",
  "Deploy",
  "Wallets",
  "Settings",
] as const;

export type SpotlightGroup = (typeof SPOTLIGHT_GROUPS)[number];

export const GROUP_ICON: Record<SpotlightGroup, string> = {
  Navigation: "→",
  Build: "⚒",
  Deploy: "↑",
  Wallets: "◈",
  Settings: "⚙",
};

export interface SpotlightActionContext {
  /** Close the palette and perform `action`. Wired by the component. */
  run: (action: SpotlightAction) => void;
}

export interface SpotlightAction {
  /** Unique, stable id — also the keybinding override key in storage. */
  id: string;
  title: string;
  subtitle?: string;
  group: SpotlightGroup;
  /** Route to navigate to; when set the action is navigational. */
  href?: string;
  /** Imperative work executed when the item has no `href`. */
  action?: () => void;
  keywords?: string[];
  /** Default physical-key chord, e.g. `["Meta", "KeyK"]`. */
  defaultChord?: KeyChord;
}

function routeGroupLabel(item: NavigationItem): string {
  return `${item.description} (${item.href})`;
}

/** Fold the canonical route index into Navigation actions. */
export function buildNavigationActions(
  routes: readonly NavigationItem[],
  options: { currentPath?: string } = {},
): SpotlightAction[] {
  const actions: SpotlightAction[] = [];
  for (const route of routes) {
    // Never offer "navigate to the page you are already on".
    if (options.currentPath && route.href === options.currentPath) continue;
    actions.push({
      id: `nav:${route.href}`,
      title: route.name,
      subtitle: routeGroupLabel(route),
      group: "Navigation",
      href: route.href,
      keywords: [route.href, ...route.keywords],
    });
  }
  return actions;
}

export interface SpotlightResult {
  action: SpotlightAction;
  score: number;
  /** Highlight ranges for `action.title`. */
  indices: number[];
  /** Highlight runs ready to render. */
  segments: HighlightSegment[];
}

const FIELDS = [
  { key: "title", weight: 1, get: (action: SpotlightAction) => [action.title] },
  {
    key: "keywords",
    weight: 0.55,
    get: (action: SpotlightAction) => action.keywords ?? [],
  },
  {
    key: "subtitle",
    weight: 0.4,
    get: (action: SpotlightAction) => [action.subtitle ?? ""],
  },
  { key: "group", weight: 0.3, get: (action: SpotlightAction) => [action.group] },
];

/**
 * Rank the registry against a whitespace-separated query. An empty query
 * returns every action in registry order (i.e. grouped), and every returned
 * action carries positive score and highlight segments for the UI.
 */
export function rankSpotlightActions(
  actions: readonly SpotlightAction[],
  query: string,
  options: { limit?: number } = {},
): SpotlightResult[] {
  const ranked = rankItems(actions, query.trim(), FIELDS);
  const results = ranked.map((entry) => ({
    action: entry.item,
    score: Math.max(1, entry.score),
    indices: entry.indices,
    segments: highlightSegments(entry.item.title, entry.indices),
  }));
  return typeof options.limit === "number"
    ? results.slice(0, options.limit)
    : results;
}

/**
 * Group results for painting while preserving ranked order inside each group.
 * The keyboard walks the flattened output of this function, so what you see is
 * always what the arrow keys walk.
 */
export function groupSpotlightResults(
  results: readonly SpotlightResult[],
): Array<{ group: SpotlightGroup; results: SpotlightResult[] }> {
  const buckets = new Map<SpotlightGroup, SpotlightResult[]>();
  for (const result of results) {
    const bucket = buckets.get(result.action.group);
    if (bucket) bucket.push(result);
    else buckets.set(result.action.group, [result]);
  }
  return SPOTLIGHT_GROUPS.filter((group) => buckets.has(group)).map(
    (group) => ({ group, results: buckets.get(group) as SpotlightResult[] }),
  );
}

/** The painted order for the arrow-key walk. */
export function flattenSpotlightGroups(
  groups: ReadonlyArray<{ results: SpotlightResult[] }>,
): SpotlightResult[] {
  return groups.flatMap((group) => group.results);
}
