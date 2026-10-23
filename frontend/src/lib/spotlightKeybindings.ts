// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Configurable shortcut preferences for the spotlight palette (issue #1725).
 *
 * Every spotlight item ships a default keybinding; the user can rebind any of
 * them from inside the palette ("Change shortcut…") and the overrides persist
 * across sessions in `localStorage` under `sp:spotlight-keybindings`.
 *
 * Storage follows the conventions of `hooks/useRecentFiles` and
 * `hooks/useDeployedContracts`: a module-level key, an SSR guard, a `try/catch`
 * that never throws, and cross-tab sync via the `storage` event (handled by the
 * consumer). Values are validated on read so a stale or hand-edited entry can
 * never crash the palette — anything invalid simply falls back to the default.
 */

import { readJson, writeJson } from "@/lib/offline/storage";

export const SPOTLIGHT_KEYBINDINGS_STORAGE_KEY = "sp:spotlight-keybindings";

/** A shortcut without its platform modifier, e.g. `["Shift", "KeyS"]`. */
export type KeyChord = string[];

const MODIFIER_KEYS = new Set([
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "AltGraph",
  "CapsLock",
  "NumLock",
  "ScrollLock",
  "OS",
]);

/** A bare modifier press can never be a shortcut on its own. */
export function isModifierOnly(chord: KeyChord): boolean {
  return chord.length === 0 || chord.every((key) => MODIFIER_KEYS.has(key));
}

/**
 * Validate a stored chord: a non-empty array of short non-modifier key names
 * (plus at most one modifier per entry in practice, but we do not police the
 * count — `isModifierOnly` is the meaningful safety check).
 */
function isKeyChord(value: unknown): value is KeyChord {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 3 &&
    value.every((key) => typeof key === "string" && key.length <= 12) &&
    !isModifierOnly(value)
  );
}

/**
 * Read the persisted overrides. Corrupt shapes are dropped per entry so one
 * bad binding never takes down the rest.
 */
export function loadKeybindingOverrides(): Record<string, KeyChord> {
  const raw = readJson<unknown>(SPOTLIGHT_KEYBINDINGS_STORAGE_KEY, {});
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {};
  }
  const overrides: Record<string, KeyChord> = {};
  for (const [id, chord] of Object.entries(raw as Record<string, unknown>)) {
    if (isKeyChord(chord)) overrides[id] = chord;
  }
  return overrides;
}

export function saveKeybindingOverrides(
  overrides: Record<string, KeyChord>,
): void {
  writeJson(SPOTLIGHT_KEYBINDINGS_STORAGE_KEY, overrides);
}

/** Resolve the effective chord for an item: override first, default second. */
export function effectiveChord(
  overrides: Record<string, KeyChord>,
  id: string,
  fallback: KeyChord | undefined,
): KeyChord | undefined {
  const override = overrides[id];
  if (isKeyChord(override)) return override;
  return fallback;
}

/**
 * Human-readable hint for a chord. ⌘ is used for the Meta key on Apple
 * platforms, "Ctrl" everywhere else — the same rule the sidebar hint uses.
 */
export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform =
    (navigator as { userAgentData?: { platform?: string } }).userAgentData
      ?.platform ??
    navigator.platform ??
    navigator.userAgent ??
    "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

export function formatChord(chord: KeyChord | undefined): string | undefined {
  if (!chord || isModifierOnly(chord)) return undefined;
  const apple = isApplePlatform();
  const symbols = chord.map((key) => {
    switch (key) {
      case "Meta":
        return apple ? "⌘" : "Win";
      case "Shift":
        return apple ? "⇧" : "Shift+";
      case "Alt":
        return apple ? "⌥" : "Alt+";
      case "Control":
        return apple ? "⌃" : "Ctrl+";
      case "Enter":
      case "NumpadEnter":
        return "↵";
      case "Backspace":
        return "⌫";
      case "ArrowUp":
        return "↑";
      case "ArrowDown":
        return "↓";
      case "ArrowLeft":
        return "←";
      case "ArrowRight":
        return "→";
      case "Escape":
        return "Esc";
      case "Space":
        return "␣";
      case "Minus":
        return "-";
      case "Equal":
        return "=";
      case "Slash":
        return "/";
      case "Backslash":
        return "\\";
      case "Period":
        return ".";
      case "Comma":
        return ",";
      case "Semicolon":
        return ";";
      case "Quote":
        return "'";
      case "Backquote":
        return "`";
      case "BracketLeft":
        return "[";
      case "BracketRight":
        return "]";
      default:
        if (key.startsWith("Key") && key.length === 4) {
          return key.slice(3).toUpperCase();
        }
        if (key.startsWith("Digit") && key.length === 6) {
          return key.slice(5);
        }
        if (key.startsWith("Numpad")) return `Num${key.slice(6)}`;
        if (key.startsWith("F") && key.length <= 3) return key;
        return key;
    }
  });

  // Apple symbols concatenate; the ASCII fallbacks already carry "+".
  const text = apple ? symbols.join("") : symbols.join("+").replace(/\+\+/g, "+");
  return text.length > 0 ? text : undefined;
}

/**
 * Capture the next non-modifier key press as a chord, in physical-key
 * (`event.code`) form so the binding is layout-independent. Returns `null`
 * while only modifiers are held.
 */
export function chordFromEvent(event: KeyboardEvent): KeyChord | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  const code = event.code || event.key;
  if (isModifierOnly([code])) return null;

  const chord: KeyChord = [];
  if (event.ctrlKey) chord.push("Control");
  if (event.altKey) chord.push("Alt");
  if (event.shiftKey && code !== "Shift") chord.push("Shift");
  if (event.metaKey) chord.push("Meta");
  chord.push(code);
  return chord;
}

/** Two chords match when their sorted contents are identical. */
export function chordsMatch(a: KeyChord, b: KeyChord): boolean {
  const sort = (chord: KeyChord) => [...chord].sort().join("+");
  return sort(a) === sort(b);
}
