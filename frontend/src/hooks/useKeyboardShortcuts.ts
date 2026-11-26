// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Production-grade Keyboard Shortcuts Hook.
 * Implements Issue #2077:
 *  - Dynamically binds Cmd on macOS and Ctrl on Windows/Linux
 *  - Integrates Vim/Sublime/VSCode keymap presets with user toggle
 *  - Provides custom key remapping and local storage persistence
 *  - Dispatches action triggers cross-platform
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  KeymapPreset,
  ShortcutConflict,
  ShortcutItem,
} from "@/types/shortcuts";
import {
  formatShortcut,
  getPlatformModifier,
  isApplePlatform,
  matchesShortcut,
} from "@/lib/shortcuts/platform";
import { PRESET_MAP } from "@/lib/shortcuts/presets";
import {
  loadKeymapPreset,
  loadShortcutOverrides,
  loadVimModeEnabled,
  saveKeymapPreset,
  saveShortcutOverrides,
  saveVimModeEnabled,
} from "@/lib/shortcuts/storage";

export const VIM_MODE_CHANGE_EVENT = "soroban:vim-mode-change";

/**
 * Check if the event target is an interactive typing element.
 */
export function isTypingElement(target: EventTarget | null): boolean {
  if (!target || typeof HTMLElement === "undefined") return false;
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

export interface UseKeyboardShortcutsOptions {
  /** Optional deterministic platform override for testing */
  isMacOverride?: boolean;
  /** Optional initial preset override (defaults to storage or vscode) */
  initialPreset?: KeymapPreset;
  /** Optional initial overrides for testing */
  initialOverrides?: Record<string, string>;
  /** Optional initial vim mode override */
  initialVimMode?: boolean;
  /** Whether to attach global window keydown listener */
  attachGlobalListener?: boolean;
}

export interface UseKeyboardShortcutsResult {
  preset: KeymapPreset;
  setPreset: (preset: KeymapPreset) => void;
  vimModeEnabled: boolean;
  setVimModeEnabled: (enabled: boolean) => void;
  toggleVimMode: () => void;
  shortcuts: ShortcutItem[];
  updateShortcut: (id: string, newBinding: string) => void;
  resetShortcut: (id: string) => void;
  resetAllShortcuts: () => void;
  findConflict: (newBinding: string, currentId?: string) => ShortcutConflict | null;
  registerAction: (id: string, handler: (e: KeyboardEvent) => void) => () => void;
  isMac: boolean;
  modKey: string;
  formatKey: (key: string | undefined) => string;
}

export function useKeyboardShortcuts(
  options: UseKeyboardShortcutsOptions = {},
): UseKeyboardShortcutsResult {
  const {
    isMacOverride,
    initialPreset,
    initialOverrides,
    initialVimMode,
    attachGlobalListener = true,
  } = options;

  const isMac = useMemo(() => isApplePlatform(isMacOverride), [isMacOverride]);
  const modKey = useMemo(() => (isMac ? "⌘" : "Ctrl"), [isMac]);

  const [preset, setPresetState] = useState<KeymapPreset>(() => {
    if (initialPreset) return initialPreset;
    return loadKeymapPreset();
  });

  const [overrides, setOverrides] = useState<Record<string, string>>(() => {
    if (initialOverrides) return initialOverrides;
    return loadShortcutOverrides();
  });

  const [vimModeEnabled, setVimModeState] = useState<boolean>(() => {
    if (typeof initialVimMode === "boolean") return initialVimMode;
    return loadVimModeEnabled();
  });

  const actionHandlersRef = useRef<Map<string, (e: KeyboardEvent) => void>>(
    new Map(),
  );

  // Set preset with persistence
  const setPreset = useCallback((nextPreset: KeymapPreset) => {
    setPresetState(nextPreset);
    saveKeymapPreset(nextPreset);
    if (nextPreset === "vim") {
      setVimModeState(true);
      saveVimModeEnabled(true);
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent(VIM_MODE_CHANGE_EVENT, { detail: { enabled: true } }),
        );
      }
    }
  }, []);

  // Set Vim mode with persistence and cross-component broadcast
  const setVimModeEnabled = useCallback((enabled: boolean) => {
    setVimModeState(enabled);
    saveVimModeEnabled(enabled);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(VIM_MODE_CHANGE_EVENT, { detail: { enabled } }),
      );
    }
  }, []);

  const toggleVimMode = useCallback(() => {
    setVimModeEnabled(!vimModeEnabled);
  }, [setVimModeEnabled, vimModeEnabled]);

  // Compute effective shortcuts
  const shortcuts = useMemo<ShortcutItem[]>(() => {
    const baseItems = PRESET_MAP[preset] || PRESET_MAP.vscode;
    return baseItems.map((item) => ({
      ...item,
      customKey: overrides[item.id] || undefined,
    }));
  }, [overrides, preset]);

  // Update a single shortcut binding
  const updateShortcut = useCallback(
    (id: string, newBinding: string) => {
      const cleanBinding = newBinding.trim();
      setOverrides((prev) => {
        const next = { ...prev, [id]: cleanBinding };
        saveShortcutOverrides(next);
        return next;
      });
    },
    [],
  );

  // Reset a single shortcut to default
  const resetShortcut = useCallback((id: string) => {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[id];
      saveShortcutOverrides(next);
      return next;
    });
  }, []);

  // Reset all shortcuts to preset defaults
  const resetAllShortcuts = useCallback(() => {
    setOverrides({});
    saveShortcutOverrides({});
  }, []);

  // Find shortcut conflict
  const findConflict = useCallback(
    (newBinding: string, currentId?: string): ShortcutConflict | null => {
      const targetBinding = newBinding.trim().toLowerCase();
      for (const item of shortcuts) {
        if (currentId && item.id === currentId) continue;
        const effective = (item.customKey || item.defaultKey).trim().toLowerCase();
        if (effective === targetBinding) {
          return {
            existingShortcut: item,
            conflictingKey: item.customKey || item.defaultKey,
          };
        }
      }
      return null;
    },
    [shortcuts],
  );

  // Register an action handler
  const registerAction = useCallback(
    (id: string, handler: (e: KeyboardEvent) => void) => {
      actionHandlersRef.current.set(id, handler);
      return () => {
        actionHandlersRef.current.delete(id);
      };
    },
    [],
  );

  const formatKey = useCallback(
    (key: string | undefined) => formatShortcut(key, isMac),
    [isMac],
  );

  // Global keydown event listener
  useEffect(() => {
    if (!attachGlobalListener || typeof window === "undefined") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't capture standard keys when user is typing in form inputs
      const isTyping = isTypingElement(event.target);

      for (const item of shortcuts) {
        const keyPattern = item.customKey || item.defaultKey;
        if (!keyPattern) continue;

        // In typing elements, only allow Mod combinations (e.g. Mod+S, Mod+K)
        // Prevent single character shortcuts like '/' or '?' from hijacking input typing
        if (isTyping && !keyPattern.toLowerCase().includes("mod") && !event.ctrlKey && !event.metaKey) {
          continue;
        }

        if (matchesShortcut(event, keyPattern, isMac)) {
          const handler =
            actionHandlersRef.current.get(item.id) ||
            (item.actionId ? actionHandlersRef.current.get(item.actionId) : undefined);

          if (handler) {
            event.preventDefault();
            handler(event);
            return;
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [attachGlobalListener, isMac, shortcuts]);

  return {
    preset,
    setPreset,
    vimModeEnabled,
    setVimModeEnabled,
    toggleVimMode,
    shortcuts,
    updateShortcut,
    resetShortcut,
    resetAllShortcuts,
    findConflict,
    registerAction,
    isMac,
    modKey,
    formatKey,
  };
}
