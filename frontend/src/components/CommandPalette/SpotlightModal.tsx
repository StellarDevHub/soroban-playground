// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Spotlight command palette (issue #1725) — the Cmd/Ctrl+K surface at
 * `components/CommandPalette/SpotlightModal.tsx`.
 *
 * A keyboard-first, Spotlight-style dialog over five categorized groups
 * required by the issue — Navigation, Build, Deploy, Wallets and Settings —
 * backed by the scored-subsequence fuzzy engine in `lib/fuzzySearch`. Matched
 * query characters are highlighted in place, and every row shows its
 * keybinding hint; hints are user-configurable ("Alt+Enter" on a row records a
 * new chord) and the overrides persist across sessions in `localStorage`
 * (`sp:spotlight-keybindings`).
 *
 * Global input, owned by this component:
 *  - Cmd/Ctrl+K toggles the palette (the provider's classic #1527 palette keeps
 *    bare "/" and stays reachable through the "Open command search" action);
 *  - Escape closes it (the input handler and `useModalAccessibility` both
 *    honour it, so it works wherever focus is);
 *  - any configured action chord runs its action app-wide, except while the
 *    user is typing in a text field with a bare/Shift chord.
 *
 * Accessibility follows the ARIA combobox pattern, exactly like the #1527
 * palette: `role="combobox"` input with `aria-activedescendant`, an
 * `aria-activedescendant`-driven `role="listbox"`, focus trapped in the
 * dialog, wrapped arrow-key navigation over the painted order, Home/End, and
 * Enter to execute — 100% operable without a mouse.
 *
 * Opening is a boolean flip on an already-mounted component — no network work,
 * no template fetch, no animation dependency — so it paints in well under the
 * 16 ms budget the issue sets.
 */

"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useModalAccessibility } from "@/accessibility/useModalAccessibility";
import { announceToScreenReader } from "@/lib/accessibility";
import { ALL_ROUTES, type NavigationItem } from "@/lib/navigation";
import {
  buildNavigationActions,
  flattenSpotlightGroups,
  groupSpotlightResults,
  GROUP_ICON,
  rankSpotlightActions,
  SPOTLIGHT_GROUPS,
  type SpotlightAction,
  type SpotlightResult,
} from "@/lib/spotlightRegistry";
import {
  chordFromEvent,
  chordsMatch,
  effectiveChord,
  formatChord,
  loadKeybindingOverrides,
  saveKeybindingOverrides,
  type KeyChord,
} from "@/lib/spotlightKeybindings";
import { useRecentFiles } from "@/hooks/useRecentFiles";
import {
  shortenContractId,
  useDeployedContracts,
} from "@/hooks/useDeployedContracts";
import { useTheme } from "@/components/providers/ThemeProvider";
import {
  useWallet,
  type WalletType,
} from "@/components/providers/WalletProvider";
import {
  requestPlaygroundCompile,
  requestPlaygroundDeploy,
} from "@/state/compileStore";

export interface SpotlightModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Extra actions contributed by the shell; merged into their groups. */
  actions?: SpotlightAction[];
  /** Route index to search; defaults to the canonical `@/lib/navigation`. */
  routes?: readonly NavigationItem[];
  /** Called after an action is executed — recording, telemetry, tests. */
  onRun?: (action: SpotlightAction) => void;
  /**
   * Opens the classic #1527 command palette (the one with the full template
   * index). Supplied by the provider; omitting it hides the action.
   */
  onOpenClassicPalette?: () => void;
}

/** Cap on rendered rows so a huge index can never tank the interaction. */
const MAX_RESULTS = 60;

/** The chords the palette itself claims; rebinding onto them is rejected. */
function isReservedChord(chord: KeyChord): boolean {
  const hasModifier =
    chord.includes("Meta") || chord.includes("Control");
  return hasModifier && chord[chord.length - 1] === "KeyK";
}

function mapKey(chord: KeyChord): string {
  return [...chord].sort().join("+");
}

/** Elements that own the keyboard while the user is typing in them. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** Wallets offered in the Wallets group, in kit order. */
const WALLET_CHOICES: Array<{ type: WalletType; label: string }> = [
  { type: "freighter", label: "Freighter" },
  { type: "albedo", label: "Albedo" },
  { type: "xbull", label: "xBull" },
  { type: "hana", label: "Hana" },
  { type: "walletconnect", label: "WalletConnect" },
];

function SpotlightRow({
  result,
  chord,
  isActive,
  onHover,
  onChoose,
  onRebind,
}: {
  result: SpotlightResult;
  chord: KeyChord | undefined;
  isActive: boolean;
  onHover: () => void;
  onChoose: (altKey: boolean) => void;
  onRebind: () => void;
}) {
  const hint = formatChord(chord);
  return (
    <li
      id={`spotlight-option-${result.action.id}`}
      role="option"
      aria-selected={isActive}
      onMouseEnter={onHover}
      onClick={(event) => onChoose(event.altKey)}
      onMouseDown={(event) => event.preventDefault()}
      className={[
        "group flex cursor-pointer items-start gap-3 px-3 py-2 transition-colors duration-150",
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
        {GROUP_ICON[result.action.group]}
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
        {result.action.subtitle ? (
          <span className="mt-0.5 block truncate text-xs text-slate-500">
            {result.action.subtitle}
          </span>
        ) : null}
      </span>

      <span className="flex shrink-0 items-center gap-1.5">
        {hint ? (
          <kbd className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
            {hint}
          </kbd>
        ) : null}
        {/*
          Mouse affordance for rebinding (the keyboard gesture is Alt+Enter on
          the row). Deliberately NOT a <button>: the listbox/option contract —
          and axe's nested-interactive rule — forbids focusable descendants
          inside an option, so this is decorative and `aria-hidden`.
        */}
        <span
          aria-hidden="true"
          title="Change shortcut (Alt+Enter)"
          onClick={(event) => {
            event.stopPropagation();
            onRebind();
          }}
          className="hidden cursor-pointer rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[10px] font-medium text-slate-400 group-hover:inline-block"
        >
          ⌨
        </span>
      </span>
    </li>
  );
}

export function SpotlightModal({
  open,
  onOpenChange,
  actions: shellActions = [],
  routes,
  onRun,
  onOpenClassicPalette,
}: SpotlightModalProps) {
  const router = useRouter();
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalAccessibility(dialogRef, open, () => onOpenChange(false));

  const { entries: recents, record } = useRecentFiles();
  const { contracts } = useDeployedContracts();
  const { toggle: toggleTheme } = useTheme();
  const wallet = useWallet();

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [shortcuts, setShortcuts] = useState<Record<string, KeyChord>>({});
  const [rebindingId, setRebindingId] = useState<string | null>(null);
  const [rebindError, setRebindError] = useState<string | null>(null);

  // Hydrate the persisted shortcut overrides after mount (SSR-safe).
  useEffect(() => {
    setShortcuts(loadKeybindingOverrides());
  }, []);

  const routeIndex = routes ?? ALL_ROUTES;

  const navigationActions = useMemo(
    () =>
      buildNavigationActions(routeIndex, { currentPath: pathname ?? undefined }),
    [pathname, routeIndex],
  );

  const recentActions = useMemo<SpotlightAction[]>(
    () =>
      recents
        .filter((entry) => entry.kind === "route" || entry.kind === "template")
        .map((entry) => ({
          id: `recent:${entry.id}`,
          title: entry.title,
          subtitle: entry.detail
            ? `Recent · ${entry.detail}`
            : "Recent item",
          group: "Navigation" as const,
          href:
            entry.kind === "route"
              ? entry.id
              : `/template-library?template=${encodeURIComponent(entry.id)}`,
          keywords: ["recent", entry.id, entry.kind],
        })),
    [recents],
  );

  const contractActions = useMemo<SpotlightAction[]>(
    () =>
      contracts.map((contract) => ({
        id: `contract:${contract.contractId}`,
        title: contract.label || shortenContractId(contract.contractId),
        subtitle: `${contract.network}${
          contract.templateId ? ` · ${contract.templateId}` : ""
        } · ${shortenContractId(contract.contractId)}`,
        group: "Deploy" as const,
        href: `/storage-browser?contract=${encodeURIComponent(contract.contractId)}`,
        keywords: [
          "contract",
          "deployed",
          contract.contractId,
          shortenContractId(contract.contractId),
          contract.templateId ?? "",
          contract.network,
        ],
      })),
    [contracts],
  );

  const builtInActions = useMemo<SpotlightAction[]>(() => {
    const list: SpotlightAction[] = [
      {
        id: "build.compile",
        title: "Compile contract",
        subtitle: "Build the current Soroban source to WASM",
        group: "Build",
        defaultChord: ["Meta", "Shift", "KeyB"],
        keywords: ["compile", "build", "cargo", "wasm", "rust", "artifact"],
        action: () => requestPlaygroundCompile(),
      },
      {
        id: "deploy.artifact",
        title: "Deploy compiled contract",
        subtitle: "Deploy the last pre-flight artifact to the network",
        group: "Deploy",
        defaultChord: ["Meta", "Shift", "KeyD"],
        keywords: ["deploy", "publish", "install", "testnet", "artifact"],
        action: () => requestPlaygroundDeploy(),
      },
      {
        id: "settings.theme",
        title: "Toggle light / dark theme",
        subtitle: "Switch the colour scheme",
        group: "Settings",
        keywords: ["theme", "dark", "light", "appearance", "contrast"],
        action: () => toggleTheme(),
      },
      {
        id: "settings.shortcuts.reset",
        title: "Reset all spotlight shortcuts",
        subtitle: "Restore the default keybindings",
        group: "Settings",
        keywords: ["shortcut", "keybinding", "reset", "defaults", "keyboard"],
        action: () => {
          setShortcuts({});
          saveKeybindingOverrides({});
          announceToScreenReader("Spotlight shortcuts reset to defaults.");
        },
      },
    ];

    for (const { type, label } of WALLET_CHOICES) {
      list.push({
        id: `wallet.connect.${type}`,
        title: `Connect ${label} wallet`,
        subtitle: "Connect a Stellar wallet account",
        group: "Wallets",
        keywords: ["wallet", "connect", "account", type],
        action: () => {
          void wallet.connect(type).catch(() => undefined);
        },
      });
    }
    list.push({
      id: "wallet.disconnect",
      title: "Disconnect wallet",
      subtitle: "End the active wallet session",
      group: "Wallets",
      keywords: ["wallet", "disconnect", "signout", "session", "account"],
      action: () => wallet.disconnect(),
    });

    if (onOpenClassicPalette) {
      list.push({
        id: "palette.classic",
        title: "Open command search",
        subtitle: "Full index, including contract templates",
        group: "Navigation",
        keywords: ["palette", "search", "command", "templates", "index"],
        action: () => onOpenClassicPalette(),
      });
    }

    return list;
  }, [onOpenClassicPalette, toggleTheme, wallet]);

  const index = useMemo(
    () => [
      ...builtInActions,
      ...shellActions,
      ...navigationActions,
      ...recentActions,
      ...contractActions,
    ],
    [
      builtInActions,
      contractActions,
      navigationActions,
      recentActions,
      shellActions,
    ],
  );

  const results = useMemo(() => {
    const trimmed = query.trim();
    // Empty query: grouped, registry order — no wall of unscored noise.
    const raw = trimmed
      ? rankSpotlightActions(index, trimmed, { limit: MAX_RESULTS })
      : index
          .slice(0, MAX_RESULTS)
          .map((action) => rankSpotlightActions([action], "")[0]);
    return raw;
  }, [index, query]);

  const groups = useMemo(() => groupSpotlightResults(results), [results]);
  const visibleResults = useMemo(
    () => flattenSpotlightGroups(groups),
    [groups],
  );

  // Reset the query and the cursor every time the palette opens.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    setRebindingId(null);
    setRebindError(null);
    const focusTimer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(focusTimer);
  }, [open]);

  useEffect(() => {
    if (activeIndex >= visibleResults.length) {
      setActiveIndex(Math.max(0, visibleResults.length - 1));
    }
  }, [activeIndex, visibleResults.length]);

  // Keep the highlighted row inside the scroll viewport.
  useEffect(() => {
    if (!open) return;
    const activeId = visibleResults[activeIndex]?.action.id;
    if (!activeId) return;
    // `getElementById` rather than a CSS selector: ids contain `:` and `/`.
    const node = document.getElementById(`spotlight-option-${activeId}`);
    node?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, open, visibleResults]);

  const runAction = useCallback(
    (result: SpotlightResult | undefined) => {
      const action = result?.action;
      if (!action) return;
      onOpenChange(false);
      if (action.href) {
        record({
          id: action.href,
          title: action.title,
          kind: "route",
          detail: action.subtitle,
        });
        router.push(action.href);
      } else {
        action.action?.();
      }
      onRun?.(action);
      announceToScreenReader(`Ran ${action.title}.`);
    },
    [onOpenChange, onRun, record, router],
  );

  const startRebind = useCallback((result: SpotlightResult | undefined) => {
    const action = result?.action;
    if (!action) return;
    setRebindingId(action.id);
    setRebindError(null);
  }, []);

  const cancelRebind = useCallback(() => {
    setRebindingId(null);
    setRebindError(null);
  }, []);

  const rebindingAction = useMemo(
    () => index.find((action) => action.id === rebindingId),
    [index, rebindingId],
  );

  const chordMap = useMemo(() => {
    const map = new Map<string, SpotlightAction>();
    for (const action of index) {
      const chord = effectiveChord(shortcuts, action.id, action.defaultChord);
      if (chord) map.set(mapKey(chord), action);
    }
    return map;
  }, [index, shortcuts]);

  const applyChord = useCallback((actionId: string, chord: KeyChord) => {
    setShortcuts((previous) => {
      const next = { ...previous, [actionId]: chord };
      saveKeybindingOverrides(next);
      return next;
    });
    setRebindingId(null);
    setRebindError(null);
    const hint = formatChord(chord);
    announceToScreenReader(`Shortcut set to ${hint ?? "custom"}.`);
  }, []);

  // Global key handling: palette toggle, Escape, rebinding capture and every
  // user-configured action chord. Document-level on purpose — the palette must
  // answer "Cmd+K anywhere", exactly as the issue requires.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // 1. Shortcut capture mode wins over everything, including Cmd+K.
      if (rebindingId) {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          cancelRebind();
          return;
        }
        const chord = chordFromEvent(event);
        if (!chord) return; // bare modifier — keep waiting
        event.preventDefault();
        event.stopPropagation();
        if (isReservedChord(chord)) {
          setRebindError("Ctrl/⌘+K is reserved for the palette itself.");
          return;
        }
        applyChord(rebindingId, chord);
        return;
      }

      const isPaletteKey =
        (event.key === "k" || event.key === "K") &&
        (event.metaKey || event.ctrlKey);
      if (isPaletteKey) {
        event.preventDefault();
        onOpenChange(!open);
        return;
      }

      if (event.key === "Escape" && open) {
        if (event.defaultPrevented) return;
        event.preventDefault();
        onOpenChange(false);
        return;
      }

      // 2. User-configured action chords, app-wide. While the user is typing
      //    in a text field, only chords with Ctrl/Alt/Meta fire, so a rebound
      //    bare key can never hijack normal typing.
      const chord = chordFromEvent(event);
      if (!chord || event.defaultPrevented) return;
      const action = chordMap.get(mapKey(chord));
      if (!action) return;
      const hasModifier =
        chord.includes("Control") || chord.includes("Alt") || chord.includes("Meta");
      if (isTypingTarget(event.target) && !hasModifier) return;
      event.preventDefault();
      runAction({ action, score: 1, indices: [], segments: [] });
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [applyChord, cancelRebind, chordMap, onOpenChange, rebindingId, runAction, open]);

  // Escape during capture must cancel the rebind — not fall through to
  // `useModalAccessibility`'s Escape-to-close. That hook attaches a *native*
  // bubble-phase Escape listener on the dialog, which stops the event before
  // React's synthetic input handler ever sees it, so this guard is attached
  // natively on the input itself (target phase wins over any ancestor).
  useEffect(() => {
    const input = inputRef.current;
    if (!open || !rebindingId || !input) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancelRebind();
    };
    input.addEventListener("keydown", onEscape);
    return () => input.removeEventListener("keydown", onEscape);
  }, [cancelRebind, open, rebindingId]);

  const onInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      // Capture mode: chords are owned by the document listener, and Escape
      // by the native input listener above; swallow everything else so the
      // listbox keyboard model cannot fire mid-capture.
      if (rebindingId) {
        return;
      }

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
          // Alt+Enter records a new shortcut for the highlighted row.
          if (event.altKey) {
            event.preventDefault();
            startRebind(visibleResults[activeIndex]);
            break;
          }
          event.preventDefault();
          runAction(visibleResults[activeIndex]);
          break;
        case "Escape":
          event.preventDefault();
          event.stopPropagation();
          onOpenChange(false);
          break;
        default:
          break;
      }
    },
    [
      activeIndex,
      onOpenChange,
      rebindingId,
      runAction,
      startRebind,
      visibleResults,
    ],
  );

  if (!open) return null;

  const activeId = visibleResults[activeIndex]
    ? `spotlight-option-${visibleResults[activeIndex].action.id}`
    : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh] sm:pt-[16vh]"
      role="presentation"
    >
      <button
        type="button"
        aria-label="Close spotlight"
        tabIndex={-1}
        onClick={() => onOpenChange(false)}
        className="layout-fade absolute inset-0 cursor-default bg-slate-950/70 backdrop-blur-sm"
      />

      <div
        ref={dialogRef}
        data-spotlight
        role="dialog"
        aria-modal="true"
        aria-label="Spotlight command palette"
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
            aria-controls="spotlight-listbox"
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-label="Search spotlight actions"
            autoComplete="off"
            spellCheck={false}
            placeholder="Search navigation, build, deploy, wallets, settings…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onInputKeyDown}
            className="w-full bg-transparent py-4 text-sm text-foreground outline-none placeholder:text-slate-500"
          />
        </div>

        {rebindingAction ? (
          <div
            role="status"
            className="border-b border-slate-800 bg-accent/10 px-4 py-3 text-sm text-foreground"
          >
            <p>
              Press a shortcut for “{rebindingAction.title}” — Esc to cancel.
            </p>
            {rebindError ? (
              <p className="mt-1 text-xs text-red-400">{rebindError}</p>
            ) : null}
          </div>
        ) : null}

        {visibleResults.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">
            No matches for “{query.trim()}”
          </p>
        ) : (
          <ul
            id="spotlight-listbox"
            role="listbox"
            aria-label="Spotlight results"
            className="max-h-[52vh] overflow-y-auto py-2"
          >
            {groups.map((group) => (
              <li key={group.group} role="presentation">
                <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {SPOTLIGHT_GROUPS.includes(group.group)
                    ? `${GROUP_ICON[group.group]} ${group.group}`
                    : group.group}
                </p>
                <ul role="presentation">
                  {group.results.map((result) => {
                    const flatIndex = visibleResults.indexOf(result);
                    return (
                      <SpotlightRow
                        key={result.action.id}
                        result={result}
                        chord={effectiveChord(
                          shortcuts,
                          result.action.id,
                          result.action.defaultChord,
                        )}
                        isActive={flatIndex === activeIndex}
                        onHover={() => setActiveIndex(flatIndex)}
                        onChoose={(altKey) =>
                          altKey
                            ? startRebind(result)
                            : runAction(result)
                        }
                        onRebind={() => startRebind(result)}
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
            <span>↵ run</span>
            <span>⌥↵ change shortcut</span>
            <span>esc close</span>
          </span>
          <span>{visibleResults.length} results</span>
        </div>
      </div>
    </div>
  );
}

export default SpotlightModal;
