// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Local storage persistence helper for keyboard shortcuts and presets.
 */

import { readJson, writeJson } from "@/lib/offline/storage";
import type { KeymapPreset } from "@/types/shortcuts";

export const KEYBOARD_SHORTCUTS_STORAGE_KEY = "sp:keyboard-shortcuts";
export const KEYMAP_PRESET_STORAGE_KEY = "sp:keymap-preset";
export const VIM_MODE_STORAGE_KEY = "sp:vim-mode-enabled";

/**
 * Load user customized shortcut overrides.
 */
export function loadShortcutOverrides(): Record<string, string> {
  const data = readJson<unknown>(KEYBOARD_SHORTCUTS_STORAGE_KEY, {});
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return {};
  }
  const overrides: Record<string, string> = {};
  for (const [id, key] of Object.entries(data as Record<string, unknown>)) {
    if (typeof key === "string" && key.trim().length > 0) {
      overrides[id] = key.trim();
    }
  }
  return overrides;
}

/**
 * Save user customized shortcut overrides.
 */
export function saveShortcutOverrides(overrides: Record<string, string>): void {
  writeJson(KEYBOARD_SHORTCUTS_STORAGE_KEY, overrides);
}

/**
 * Load active keymap preset.
 */
export function loadKeymapPreset(): KeymapPreset {
  const preset = readJson<string>(KEYMAP_PRESET_STORAGE_KEY, "vscode");
  if (preset === "vim" || preset === "sublime" || preset === "vscode") {
    return preset;
  }
  return "vscode";
}

/**
 * Save active keymap preset.
 */
export function saveKeymapPreset(preset: KeymapPreset): void {
  writeJson(KEYMAP_PRESET_STORAGE_KEY, preset);
}

/**
 * Load Monaco Vim mode status.
 */
export function loadVimModeEnabled(): boolean {
  return Boolean(readJson<boolean>(VIM_MODE_STORAGE_KEY, false));
}

/**
 * Save Monaco Vim mode status.
 */
export function saveVimModeEnabled(enabled: boolean): void {
  writeJson(VIM_MODE_STORAGE_KEY, enabled);
}
