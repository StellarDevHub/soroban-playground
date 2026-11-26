// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Domain definitions for the keyboard shortcut management and customizer engine.
 */

export type KeymapPreset = "vscode" | "vim" | "sublime";

export type ShortcutCategory = "editor" | "navigation" | "build" | "general";

export type ShortcutScope = "global" | "editor";

export type PlatformType = "mac" | "windows" | "linux";

export interface ShortcutItem {
  id: string;
  label: string;
  description: string;
  category: ShortcutCategory;
  defaultKey: string; // Canonical format e.g. "Mod+S", "Mod+Shift+B"
  customKey?: string; // Optional user override keybinding
  scope?: ShortcutScope;
  actionId?: string;
}

export interface ShortcutConflict {
  existingShortcut: ShortcutItem;
  conflictingKey: string;
}

export interface ShortcutPreferences {
  preset: KeymapPreset;
  vimModeEnabled: boolean;
  overrides: Record<string, string>; // shortcutId -> customKey
}
