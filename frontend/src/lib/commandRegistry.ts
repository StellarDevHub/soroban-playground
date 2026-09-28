// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Index behind the global command palette (issue #1527).
 *
 * The palette answers four kinds of question in one box:
 *
 *  - *"where do I go?"*      → every route in `@/lib/navigation`
 *  - *"what can I run?"*     → local actions (theme, sync, export, …)
 *  - *"what did I open?"*    → recent routes/templates from `useRecentFiles`
 *  - *"where is my contract?"*→ contracts deployed from this browser
 *
 * Scoring is delegated to `lib/fuzzySearch`. Titles are weighted highest,
 * keywords lower, and recency acts as a tie-breaker so the thing you used two
 * minutes ago outranks an equally-good match from last week.
 *
 * The index is rebuilt whenever its inputs change and memoised by the caller, so
 * typing stays O(index) rather than re-fetching templates per keystroke.
 */

import {
  highlightSegments,
  rankItems,
  type HighlightSegment,
  type RankedItem,
  type SearchField,
} from "./fuzzySearch";
import { ALL_ROUTES, type NavigationItem } from "./navigation";
import type { DeployedContract } from "@/hooks/useDeployedContracts";
import { shortenContractId } from "@/hooks/useDeployedContracts";
import type { RecentFile } from "@/hooks/useRecentFiles";
import type { TemplateMetadata } from "@/types/template";

/** Which bucket a result came from — drives the group heading and icon. */
export type CommandSource =
  | "action"
  | "route"
  | "template"
  | "recent"
  | "contract";

export interface PaletteAction {
  id: string;
  label: string;
  description?: string;
  keywords?: string[];
  /** Rendered as the trailing hint, e.g. `"⇧T"`. */
  shortcut?: string;
  run: () => void;
}

export interface CommandItem {
  id: string;
  title: string;
  subtitle?: string;
  source: CommandSource;
  /** Route to navigate to, when the item is navigational. */
  href?: string;
  /** Extra search terms. */
  keywords: string[];
  /** Epoch ms; used as a ranking tie-breaker. */
  at?: number;
  /** Invoked when the item is chosen and has no `href`. */
  run?: () => void;
  shortcut?: string;
}

export interface CommandPaletteInputs {
  templates?: TemplateMetadata[];
  recents?: RecentFile[];
  contracts?: DeployedContract[];
  actions?: PaletteAction[];
  /** Current pathname, excluded from results so you cannot "go" to where you are. */
  currentPath?: string;
}

export interface CommandResult {
  item: CommandItem;
  score: number;
  /** Highlight ranges for `item.title`. */
  indices: number[];
  /** Highlight runs ready to render. */
  segments: HighlightSegment[];
  source: CommandSource;
}

const SOURCE_LABEL: Record<CommandSource, string> = {
  action: "Actions",
  recent: "Recent",
  contract: "Contracts",
  template: "Templates",
  route: "Navigate",
};

export function sourceLabel(source: CommandSource): string {
  return SOURCE_LABEL[source];
}

/** Sources in the order they should appear when scores tie. */
const SOURCE_ORDER: CommandSource[] = [
  "action",
  "recent",
  "template",
  "contract",
  "route",
];

function sourceRank(source: CommandSource): number {
  const index = SOURCE_ORDER.indexOf(source);
  return index === -1 ? SOURCE_ORDER.length : index;
}

function routeToItem(route: NavigationItem): CommandItem {
  return {
    id: `route:${route.href}`,
    title: route.name,
    subtitle: route.description,
    source: "route",
    href: route.href,
    keywords: [route.href, ...route.keywords],
  };
}

function templateToItem(template: TemplateMetadata): CommandItem {
  return {
    id: `template:${template.id}`,
    title: template.name,
    subtitle: `${template.category} · ${template.complexity}`,
    source: "template",
    href: `/template-library?template=${encodeURIComponent(template.id)}`,
    keywords: [
      template.id,
      template.dirName,
      template.description,
      template.category,
      ...template.tags,
      ...template.functionalities,
    ],
  };
}

function recentToItem(entry: RecentFile): CommandItem {
  const href = entry.kind === "route" ? entry.id : `/template-library?template=${encodeURIComponent(entry.id)}`;
  return {
    id: `recent:${entry.id}`,
    title: entry.title,
    subtitle: entry.detail,
    source: "recent",
    href,
    keywords: [entry.id, entry.kind],
    at: entry.at,
  };
}

function contractToItem(contract: DeployedContract): CommandItem {
  return {
    id: `contract:${contract.contractId}`,
    title: contract.label || shortenContractId(contract.contractId),
    subtitle: `${contract.network}${contract.templateId ? ` · ${contract.templateId}` : ""}`,
    source: "contract",
    href: `/storage-browser?contract=${encodeURIComponent(contract.contractId)}`,
    keywords: [
      contract.contractId,
      shortenContractId(contract.contractId),
      contract.templateId ?? "",
      contract.network,
    ],
    at: contract.deployedAt,
  };
}

function actionToItem(action: PaletteAction): CommandItem {
  return {
    id: `action:${action.id}`,
    title: action.label,
    subtitle: action.description,
    source: "action",
    keywords: action.keywords ?? [],
    run: action.run,
    shortcut: action.shortcut,
  };
}

/** Build the full candidate list. Pure and cheap — safe to call per render. */
export function buildCommandIndex(
  inputs: CommandPaletteInputs = {},
): CommandItem[] {
  const {
    templates = [],
    recents = [],
    contracts = [],
    actions = [],
    currentPath,
  } = inputs;

  const items: CommandItem[] = [];

  for (const action of actions) items.push(actionToItem(action));
  for (const entry of recents) items.push(recentToItem(entry));
  for (const contract of contracts) items.push(contractToItem(contract));
  for (const template of templates) items.push(templateToItem(template));
  for (const route of ALL_ROUTES) {
    // Never offer "navigate to the page you are already on".
    if (currentPath && route.href === currentPath) continue;
    items.push(routeToItem(route));
  }

  return items;
}

const FIELDS: SearchField<CommandItem>[] = [
  { key: "title", weight: 1, get: (item) => [item.title] },
  { key: "keywords", weight: 0.55, get: (item) => item.keywords },
  { key: "subtitle", weight: 0.4, get: (item) => [item.subtitle ?? ""] },
];

/** Recency bonus: up to +240, decaying over ~7 days. */
function recencyBonus(at: number | undefined, now: number): number {
  if (!at || !Number.isFinite(at) || at <= 0) return 0;
  const ageDays = Math.max(0, (now - at) / 86_400_000);
  return Math.round(240 * Math.exp(-ageDays / 7));
}

export interface RankOptions {
  limit?: number;
  now?: number;
  /** Cap on how many results the palette renders. */
  maxResults?: number;
}

export const DEFAULT_MAX_RESULTS = 40;

/**
 * Rank the index against a query.
 *
 * An empty query is not "everything" — that would be an unusable wall of text —
 * so the caller is expected to show a curated default set instead. This function
 * still handles it (returning everything, unscored) because that is the honest
 * behaviour for a library call.
 */
export function rankCommands(
  items: readonly CommandItem[],
  query: string,
  options: RankOptions = {},
): CommandResult[] {
  const { limit, now = Date.now(), maxResults = DEFAULT_MAX_RESULTS } = options;
  const ranked: Array<RankedItem<CommandItem>> = rankItems(items, query, FIELDS);

  const results = ranked.map((entry) => ({
    item: entry.item,
    // `sourceRank` is a small tie-breaker penalty, but for a weak keyword-only
    // match it can outweigh the match score itself. A result that matched must
    // never carry a non-positive score: consumers read `score > 0` as "this
    // matched", and a clamped score keeps the ordering intact because the
    // penalty is applied uniformly across sources.
    score: Math.max(
      1,
      entry.score + recencyBonus(entry.item.at, now) - sourceRank(entry.item.source),
    ),
    indices: entry.indices,
    segments: highlightSegments(entry.item.title, entry.indices),
    source: entry.item.source,
  }));

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.item.title.localeCompare(b.item.title);
  });

  const sliced =
    typeof limit === "number" ? results.slice(0, limit) : results;
  return sliced.slice(0, maxResults);
}

/** Group results by source while preserving the ranked order inside a group. */
export function groupResults(
  results: readonly CommandResult[],
): Array<{ source: CommandSource; label: string; results: CommandResult[] }> {
  const buckets = new Map<CommandSource, CommandResult[]>();
  for (const result of results) {
    const bucket = buckets.get(result.source);
    if (bucket) bucket.push(result);
    else buckets.set(result.source, [result]);
  }
  return SOURCE_ORDER.filter((source) => buckets.has(source)).map((source) => ({
    source,
    label: SOURCE_LABEL[source],
    results: buckets.get(source) as CommandResult[],
  }));
}
