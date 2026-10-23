// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Owns the global command palettes (issues #1527, #1725).
 *
 * Mounted once in the root layout. Responsibilities:
 *
 *  - render the **Spotlight palette** (#1725), which binds Cmd/Ctrl+K itself
 *    and owns the five categorized groups (Navigation, Build, Deploy, Wallets,
 *    Settings);
 *  - keep bare `/` (when the user is not already typing) opening the classic
 *    #1527 "command search" palette, and guarantee the two are never open at
 *    once so their focus traps cannot fight;
 *  - contribute the shell's local actions — offline sync now, connection
 *    status, workspace reset — to both palettes;
 *  - record every navigation the user performs into the recent-files log that
 *    both indexes read back (#1525).
 */

"use client";

import React, { useCallback, useMemo, useState } from "react";
import CommandPalette from "@/components/CommandPalette";
import SpotlightModal from "@/components/CommandPalette/SpotlightModal";
import { useTheme } from "@/components/providers/ThemeProvider";
import { useOffline } from "@/components/providers/OfflineProvider";
import type { PaletteAction } from "@/lib/commandRegistry";
import type { SpotlightAction } from "@/lib/spotlightRegistry";

/** Elements that own the keyboard while the user is typing in them. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    tag === "OPTION"
  );
}

export interface CommandPaletteProviderProps {
  children: React.ReactNode;
  /** Locales the "toggle theme" action. */
  onResetWorkspace?: () => void;
}

export function CommandPaletteProvider({
  children,
  onResetWorkspace,
}: CommandPaletteProviderProps) {
  /** Classic #1527 "command search" palette (full template index). */
  const [open, setOpen] = useState(false);
  /** Spotlight-style palette (#1725) — the Cmd/Ctrl+K surface. */
  const [spotlightOpen, setSpotlightOpen] = useState(false);
  const { state: theme, toggle: toggleTheme } = useTheme();
  const { flush, queuedCount, isOnline, status } = useOffline();

  const close = useCallback(() => setOpen(false), []);

  // The two palettes are mutually exclusive: whichever opens first wins, so
  // their focus traps never overlap.
  const onSpotlightOpenChange = useCallback((next: boolean) => {
    setSpotlightOpen(next);
    if (next) setOpen(false);
  }, []);

  const actions = useMemo<PaletteAction[]>(() => {
    const list: PaletteAction[] = [
      {
        id: "theme.toggle",
        label: theme.mode === "dark" ? "Switch to light theme" : "Switch to dark theme",
        description: "Toggle the colour scheme",
        keywords: ["theme", "dark", "light", "appearance", "contrast"],
        run: toggleTheme,
      },
      {
        id: "sync.now",
        label:
          queuedCount > 0
            ? `Sync now (${queuedCount} queued)`
            : "Sync workspace now",
        description: "Push queued offline changes to the cloud",
        keywords: ["sync", "push", "upload", "offline", "queue"],
        shortcut: "⇧S",
        run: () => {
          void flush();
        },
      },
      {
        id: "offline.status",
        label: `Connection: ${status}`,
        description: isOnline
          ? "The API is reachable"
          : "Offline — changes are queued locally",
        keywords: ["offline", "online", "connection", "network", "status"],
        run: () => setOpen(false),
      },
    ];

    if (onResetWorkspace) {
      list.push({
        id: "workspace.reset",
        label: "Reset local workspace",
        description: "Discard local bookmarks, history and layout",
        keywords: ["reset", "clear", "wipe", "workspace"],
        run: onResetWorkspace,
      });
    }

    return list;
  }, [flush, isOnline, onResetWorkspace, queuedCount, status, theme.mode, toggleTheme]);

  // The shell actions, retyped for the Spotlight's Settings group. The theme
  // toggle is filtered out because SpotlightModal ships its own Settings-group
  // version, and two "toggle theme" rows would be noise.
  const spotlightShellActions = useMemo<SpotlightAction[]>(
    () =>
      actions
        .filter((action) => action.id !== "theme.toggle")
        .map((action) => ({
          id: action.id,
          title: action.label,
          subtitle: action.description,
          group: "Settings" as const,
          keywords: action.keywords,
          action: action.run,
        })),
    [actions],
  );

  // Cmd/Ctrl+K is bound by SpotlightModal itself (#1725). The provider keeps
  // only bare "/" — a familiar "search" affordance, but only outside a field.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "/" && !isTypingTarget(event.target)) {
        event.preventDefault();
        setSpotlightOpen(false);
        setOpen(true);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      {children}
      {/*
        Rendered only while open: a closed palette must not mount at all, so it
        costs nothing and calls none of its hooks (router, template fetch,
        recent-files subscription) on every page of the app.
      */}
      {open ? (
        <CommandPalette
          open={open}
          onOpenChange={setOpen}
          actions={actions}
        />
      ) : null}
      {/*
        #1725 — Spotlight. Always mounted (it binds the global Cmd/Ctrl+K
        listener) but renders nothing while closed, so it costs a few effects
        and no DOM. The theme toggle is skipped because the Spotlight ships its
        own Settings-group version of it.
      */}
      <SpotlightModal
        open={spotlightOpen}
        onOpenChange={onSpotlightOpenChange}
        actions={spotlightShellActions}
        onOpenClassicPalette={() => setOpen(true)}
      />
    </>
  );
}

export default CommandPaletteProvider;
