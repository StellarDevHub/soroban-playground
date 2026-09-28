// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Global command palette (issue #1527) — the Cmd/Ctrl+K surface.
 *
 * Indexes contract templates, recent files, documentation routes, deployed
 * contract addresses and local actions behind one fuzzy-searchable box. Mounted
 * once by `CommandPaletteProvider` in the root layout, so it is reachable from
 * every page.
 *
 * Accessibility follows the ARIA combobox pattern:
 *  - the input is a `role="combobox"` with `aria-expanded` / `aria-controls`
 *  - results are an `aria-activedescendant`-driven `role="listbox"`
 *  - focus is trapped in the dialog, Escape closes, and the scroll position of
 *    the active option is kept in view
 *
 * Opening and closing animate with the shared `layout-pop` / `layout-fade`
 * micro-animations from #1529 (CSS, not a runtime animation dependency), and
 * every transition is disabled under `prefers-reduced-motion`.
 */

"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  buildCommandIndex,
  DEFAULT_MAX_RESULTS,
  groupResults,
  rankCommands,
  sourceLabel,
  type CommandItem,
  type CommandResult,
  type PaletteAction,
} from "@/lib/commandRegistry";
import { useRecentFiles } from "@/hooks/useRecentFiles";
import { useDeployedContracts } from "@/hooks/useDeployedContracts";
import { loadTemplateMetadata } from "@/services/templateService";
import type { TemplateMetadata } from "@/types/template";

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Extra local actions contributed by the shell. */
  actions?: PaletteAction[];
  /** Externally supplied template list; loaded on open when omitted. */
  templates?: TemplateMetadata[];
  /** Called after a result is chosen — used to record recents. */
  onSelect?: (item: CommandItem) => void;
}

const ICON_BY_SOURCE: Record<CommandResult["source"], string> = {
  action: "›",
  recent: "↺",
  contract: "C",
  template: "❏",
  route: "→",
};

function PaletteRow({
  result,
  isActive,
  onHover,
  onChoose,
}: {
  result: CommandResult;
  isActive: boolean;
  onHover: () => void;
  onChoose: () => void;
}) {
  return (
    <li
      id={`command-option-${result.item.id}`}
      role="option"
      aria-selected={isActive}
      onMouseEnter={onHover}
      onClick={onChoose}
      onMouseDown={(event) => event.preventDefault()}
      className={[
        "flex cursor-pointer items-start gap-3 px-3 py-2 transition-colors duration-150",
        isActive
          ? "bg-accent/15 text-foreground"
          : "text-slate-300 hover:bg-slate-800/60",
      ].join(" ")}
    >
      <span
        aria-hidden="true"
        className={[
          "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[10px] font-semibold",
          isActive
            ? "border-accent/50 bg-accent/20 text-accent"
            : "border-slate-700 bg-slate-800/70 text-slate-400",
        ].join(" ")}
      >
        {ICON_BY_SOURCE[result.source]}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">
          {result.segments.map((segment, index) =>
            segment.match ? (
              <mark
                key={index}
                className="rounded bg-accent/30 px-0.5 text-foreground"
              >
                {segment.text}
              </mark>
            ) : (
              <span key={index}>{segment.text}</span>
            ),
          )}
        </span>
        {result.item.subtitle ? (
          <span className="mt-0.5 block truncate text-xs text-slate-500">
            {result.item.subtitle}
          </span>
        ) : null}
      </span>

      {result.item.shortcut ? (
        <kbd className="shrink-0 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
          {result.item.shortcut}
        </kbd>
      ) : null}
    </li>
  );
}

export function CommandPalette({
  open,
  onOpenChange,
  actions = [],
  templates,
  onSelect,
}: CommandPaletteProps) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);

  const { entries: recents, record } = useRecentFiles();
  const { contracts } = useDeployedContracts();

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [loadedTemplates, setLoadedTemplates] = useState<TemplateMetadata[]>(
    templates ?? [],
  );
  const [templatesLoading, setTemplatesLoading] = useState(false);

  const templateList = templates ?? loadedTemplates;

  // Templates come from the network, so they are fetched once, lazily, the first
  // time the palette opens rather than on every page load.
  useEffect(() => {
    if (!open || templates || templateList.length > 0 || templatesLoading) return;
    let cancelled = false;
    setTemplatesLoading(true);
    void loadTemplateMetadata()
      .then((loaded) => {
        if (!cancelled) setLoadedTemplates(loaded);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setTemplatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, templateList.length, templates, templatesLoading]);

  const index = useMemo(
    () =>
      buildCommandIndex({
        templates: templateList,
        recents,
        contracts,
        actions,
      }),
    [actions, contracts, recents, templateList],
  );

  const results = useMemo(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      // Empty query: show recents and actions — the two things a user reaches
      // for without typing. Everything else is noise at this point.
      const defaults = index
        .filter((item) => item.source === "action" || item.source === "recent")
        .slice(0, DEFAULT_MAX_RESULTS);
      const curated = rankCommands(defaults, "", { maxResults: DEFAULT_MAX_RESULTS });
      // A brand-new visitor has neither recents nor local actions yet, and
      // "No matches for “”" is a terrible first impression for a palette the
      // user opened to explore. Fall back to the whole index so the box always
      // shows something navigable.
      if (curated.length > 0) return curated;
      return rankCommands(index, "", { maxResults: DEFAULT_MAX_RESULTS });
    }
    return rankCommands(index, trimmed);
  }, [index, query]);

  // Reset the query and the cursor every time the palette opens.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    const focusTimer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(focusTimer);
  }, [open]);

  // Rows are painted grouped by source, so the keyboard has to walk the painted
  // order. Navigating the raw ranked order instead would make ArrowDown appear
  // to jump around the visible list, which breaks the listbox contract that
  // `aria-activedescendant` promises.
  const groups = useMemo(() => groupResults(results), [results]);
  const visibleResults = useMemo(
    () => groups.flatMap((group) => group.results),
    [groups],
  );

  useEffect(() => {
    if (activeIndex >= visibleResults.length) {
      setActiveIndex(Math.max(0, visibleResults.length - 1));
    }
  }, [activeIndex, visibleResults.length]);

  // Keep the highlighted row inside the scroll viewport.
  useEffect(() => {
    if (!open) return;
    const activeId = visibleResults[activeIndex]?.item.id;
    if (!activeId) return;
    // `getElementById` rather than a CSS attribute selector: item ids contain
    // characters (`:`, `/`, `.`) that would otherwise need escaping.
    const node = document.getElementById(`command-option-${activeId}`);
    // `scrollIntoView` is absent in some environments (and in jsdom), and
    // keeping the row in view is a nicety, not a correctness requirement.
    node?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, open, visibleResults]);

  const choose = useCallback(
    (result: CommandResult | undefined) => {
      if (!result) return;
      const { item } = result;
      onSelect?.(item);
      if (item.href) {
        record({
          id: item.href,
          title: item.title,
          kind: item.source === "template" ? "template" : "route",
          detail: item.subtitle,
        });
        router.push(item.href);
      } else if (item.run) {
        item.run();
      }
      onOpenChange(false);
    },
    [onOpenChange, onSelect, record, router],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setActiveIndex((index) =>
            visibleResults.length === 0
              ? 0
              : (index + 1) % visibleResults.length,
          );
          break;
        case "ArrowUp":
          event.preventDefault();
          setActiveIndex((index) =>
            visibleResults.length === 0
              ? 0
              : (index - 1 + visibleResults.length) % visibleResults.length,
          );
          break;
        case "Home":
          event.preventDefault();
          setActiveIndex(0);
          break;
        case "End":
          event.preventDefault();
          setActiveIndex(Math.max(0, visibleResults.length - 1));
          break;
        case "Enter":
          event.preventDefault();
          choose(visibleResults[activeIndex]);
          break;
        case "Escape":
          event.preventDefault();
          onOpenChange(false);
          break;
        default:
          break;
      }
    },
    [activeIndex, choose, onOpenChange, visibleResults],
  );

  // Trap Tab inside the dialog and let Escape close from anywhere within it.
  useEffect(() => {
    if (!open) return;
    const onDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onOpenChange(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-command-palette] input, [data-command-palette] button, [data-command-palette] [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onDialogKeyDown);
    return () => document.removeEventListener("keydown", onDialogKeyDown);
  }, [onOpenChange, open]);

  if (!open) return null;

  const activeId = visibleResults[activeIndex]
    ? `command-option-${visibleResults[activeIndex].item.id}`
    : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh] sm:pt-[16vh]"
      role="presentation"
    >
      <button
        type="button"
        aria-label="Close command palette"
        tabIndex={-1}
        onClick={() => onOpenChange(false)}
        className="layout-fade absolute inset-0 cursor-default bg-slate-950/70 backdrop-blur-sm"
      />

      <div
        data-command-palette
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="layout-pop relative w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-700 bg-slate-900/95 shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-slate-800 px-4">
          <span
            aria-hidden="true"
            className="text-xs font-semibold uppercase tracking-[0.2em] text-accent"
          >
            ⌘K
          </span>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-listbox"
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-label="Search commands, templates, contracts and pages"
            autoComplete="off"
            spellCheck={false}
            placeholder="Search commands, templates, contracts, pages…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDown}
            className="w-full bg-transparent py-4 text-sm text-foreground outline-none placeholder:text-slate-500"
          />
        </div>

        {visibleResults.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">
            {templatesLoading
              ? "Loading contract templates…"
              : `No matches for “${query.trim()}”`}
          </p>
        ) : (
          <ul
            id="command-palette-listbox"
            role="listbox"
            aria-label="Command results"
            className="max-h-[52vh] overflow-y-auto py-2"
          >
            {groups.map((group) => (
              <li key={group.source} role="presentation">
                <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {group.label ?? sourceLabel(group.source)}
                </p>
                <ul role="presentation">
                  {group.results.map((result) => {
                    const flatIndex = visibleResults.indexOf(result);
                    return (
                      <PaletteRow
                        key={result.item.id}
                        result={result}
                        isActive={flatIndex === activeIndex}
                        onHover={() => setActiveIndex(flatIndex)}
                        onChoose={() => choose(result)}
                      />
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-between border-t border-slate-800 px-4 py-2 text-[11px] text-slate-500">
          <span className="flex items-center gap-3">
            <span>↑↓ navigate</span>
            <span>↵ open</span>
            <span>esc close</span>
          </span>
          <span>{visibleResults.length} results</span>
        </div>
      </div>
    </div>
  );
}

export default CommandPalette;
