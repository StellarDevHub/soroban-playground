// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Owns the global command palette (issue #1527).
 *
 * Mounted once in the root layout. Responsibilities:
 *
 *  - bind **Cmd/Ctrl+K** (and `/` when the user is not already typing) to
 *    toggle the palette, without swallowing the shortcut inside a text field
 *    that legitimately needs the key;
 *  - contribute the shell's local actions — theme toggle, offline sync now,
 *    workspace reset — so they are reachable from anywhere;
 *  - record every navigation the user performs through the palette into the
 *    recent-files log that the index reads back (#1525).
 */

"use client";

import React, { useCallback, useMemo, useState } from "react";
import CommandPalette from "@/components/CommandPalette";
import { useTheme } from "@/components/providers/ThemeProvider";
import { useOffline } from "@/components/providers/OfflineProvider";
import type { PaletteAction } from "@/lib/commandRegistry";

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
  const [open, setOpen] = useState(false);
  const { state: theme, toggle: toggleTheme } = useTheme();
  const { flush, queuedCount, isOnline, status } = useOffline();

  const close = useCallback(() => setOpen(false), []);

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

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isPaletteKey =
        (event.key === "k" || event.key === "K") &&
        (event.metaKey || event.ctrlKey);

      if (isPaletteKey) {
        event.preventDefault();
        setOpen((previous) => !previous);
        return;
      }

      // Bare "/" is a familiar "search" affordance, but only outside a field.
      if (event.key === "/" && !isTypingTarget(event.target)) {
        event.preventDefault();
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
    </>
  );
}

export default CommandPaletteProvider;
