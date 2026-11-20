// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Platform detection, key chord normalization, and cross-platform key matching.
 *
 * Dynamically binds Cmd on macOS and Ctrl on Windows/Linux, resolving the
 * issue where hardcoded Cmd shortcuts break on non-Apple systems (#2077).
 */

import type { PlatformType } from "@/types/shortcuts";

export const MODIFIER_KEYS = new Set([
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

/**
 * Checks if the current operating environment is an Apple platform (macOS/iOS).
 * Supports explicit override for deterministic testing across platforms.
 */
export function isApplePlatform(override?: boolean): boolean {
  if (typeof override === "boolean") return override;
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }
  const platform =
    (navigator as { userAgentData?: { platform?: string } }).userAgentData
      ?.platform ??
    navigator.platform ??
    navigator.userAgent ??
    "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/**
 * Detect the platform type.
 */
export function detectPlatform(isMacOverride?: boolean): PlatformType {
  if (isApplePlatform(isMacOverride)) return "mac";
  if (typeof navigator !== "undefined") {
    const userAgent = navigator.userAgent || "";
    if (/linux/i.test(userAgent)) return "linux";
  }
  return "windows";
}

/**
 * Returns the primary modifier label for the platform ("Cmd" or "Ctrl").
 */
export function getPlatformModifier(isMacOverride?: boolean): "Cmd" | "Ctrl" {
  return isApplePlatform(isMacOverride) ? "Cmd" : "Ctrl";
}

/**
 * Formats a canonical shortcut string (e.g. "Mod+Shift+S") for UI presentation.
 * On macOS: outputs symbols like "⌘⇧S" or "⌘+Shift+S".
 * On Windows/Linux: outputs text like "Ctrl+Shift+S".
 */
export function formatShortcut(
  shortcutKey: string | undefined,
  isMacOverride?: boolean,
): string {
  if (!shortcutKey) return "";

  const isMac = isApplePlatform(isMacOverride);
  const parts = shortcutKey.split("+").map((p) => p.trim());

  if (isMac) {
    const formatted = parts.map((part) => {
      const lower = part.toLowerCase();
      switch (lower) {
        case "mod":
        case "cmd":
        case "command":
        case "meta":
          return "⌘";
        case "shift":
          return "⇧";
        case "alt":
        case "option":
          return "⌥";
        case "ctrl":
        case "control":
          return "⌃";
        case "enter":
        case "return":
          return "↵";
        case "esc":
        case "escape":
          return "Esc";
        case "space":
          return "␣";
        case "backspace":
          return "⌫";
        default:
          return part.toUpperCase();
      }
    });

    // If only symbols and letters, concatenate cleanly (e.g. ⌘S, ⌘⇧B)
    const allSymbolsOrLetter = formatted.every(
      (s) => ["⌘", "⇧", "⌥", "⌃", "↵", "⌫", "␣"].includes(s) || s.length === 1,
    );
    return allSymbolsOrLetter ? formatted.join("") : formatted.join("+");
  }

  // Windows / Linux formatting
  const formatted = parts.map((part) => {
    const lower = part.toLowerCase();
    switch (lower) {
      case "mod":
      case "cmd":
      case "command":
      case "meta":
      case "ctrl":
      case "control":
        return "Ctrl";
      case "shift":
        return "Shift";
      case "alt":
      case "option":
        return "Alt";
      case "enter":
      case "return":
        return "Enter";
      case "esc":
      case "escape":
        return "Esc";
      case "space":
        return "Space";
      case "backspace":
        return "Backspace";
      default:
        return part.length === 1 ? part.toUpperCase() : part;
    }
  });

  return formatted.join("+");
}

/**
 * Checks whether a KeyboardEvent matches a canonical shortcut string.
 * Dynamically resolves "Mod" (and bridges hardcoded "Cmd" on Windows/Linux).
 */
export function matchesShortcut(
  event: KeyboardEvent,
  shortcutKey: string,
  isMacOverride?: boolean,
): boolean {
  if (!shortcutKey) return false;

  const isMac = isApplePlatform(isMacOverride);
  const parts = shortcutKey.split("+").map((p) => p.trim().toLowerCase());

  let requiresMod = false;
  let requiresCtrl = false;
  let requiresCmd = false;
  let requiresShift = false;
  let requiresAlt = false;
  let keyTarget = "";

  for (const part of parts) {
    if (part === "mod") {
      requiresMod = true;
    } else if (part === "cmd" || part === "command" || part === "meta") {
      requiresCmd = true;
    } else if (part === "ctrl" || part === "control") {
      requiresCtrl = true;
    } else if (part === "shift") {
      requiresShift = true;
    } else if (part === "alt" || part === "option") {
      requiresAlt = true;
    } else {
      keyTarget = part;
    }
  }

  // Cross-platform dynamic modifier translation:
  // 1. If "mod" is specified, it binds to Meta on Mac and Control on Win/Linux.
  // 2. If "cmd" is specified, on Mac it requires Meta; on Win/Linux it adapts to Control
  //    to prevent breaking hardcoded Mac shortcuts on Windows/Linux.
  // 3. If "ctrl" is specified, on Win/Linux it requires Control; on Mac it requires Control
  //    unless it was a legacy shortcut intended for primary action, but strict Control is checked.
  const wantsPrimaryMod = requiresMod || (requiresCmd && !isMac);
  const actualPrimary = isMac ? event.metaKey : event.ctrlKey;

  if (wantsPrimaryMod) {
    if (!actualPrimary) return false;
    // On Mac with Mod, ensure ctrlKey is not pressed unless explicitly asked
    if (isMac && !requiresCtrl && event.ctrlKey) return false;
    // On Windows with Mod, ensure metaKey is not pressed
    if (!isMac && event.metaKey) return false;
  } else {
    // Exact Cmd check on Mac
    if (requiresCmd && isMac && !event.metaKey) return false;
    if (!requiresCmd && !requiresMod && isMac && event.metaKey) return false;

    // Exact Ctrl check
    if (requiresCtrl && !event.ctrlKey) return false;
    if (!requiresCtrl && !wantsPrimaryMod && event.ctrlKey) return false;
  }

  // Shift modifier verification
  if (requiresShift !== Boolean(event.shiftKey)) {
    // Allow shift key if keyTarget is naturally shifted (e.g. '?' or ':')
    if (
      !(
        event.shiftKey &&
        (event.key === keyTarget || (keyTarget === "?" && event.key === "?"))
      )
    ) {
      return false;
    }
  }

  // Alt modifier verification
  if (requiresAlt !== Boolean(event.altKey)) {
    return false;
  }

  // Main key verification
  if (!keyTarget) return false;

  const eventKey = (event.key || "").toLowerCase();
  const eventCode = (event.code || "").toLowerCase();

  if (keyTarget === "enter" || keyTarget === "return") {
    return eventKey === "enter";
  }
  if (keyTarget === "escape" || keyTarget === "esc") {
    return eventKey === "escape";
  }
  if (keyTarget === "space") {
    return eventKey === " " || eventKey === "space" || eventCode === "space";
  }
  if (keyTarget === "backspace") {
    return eventKey === "backspace";
  }
  if (keyTarget === "/" || keyTarget === "slash") {
    return eventKey === "/" || eventCode === "slash";
  }
  if (keyTarget === "?" || keyTarget === "questionmark") {
    return eventKey === "?";
  }

  // Letter / Digit / Standard Key match
  if (eventKey === keyTarget) {
    return true;
  }
  if (eventCode === `key${keyTarget}`) {
    return true;
  }
  if (eventCode === `digit${keyTarget}`) {
    return true;
  }

  return false;
}

/**
 * Converts a KeyboardEvent into a canonical shortcut string during key recording.
 * Returns null if only modifier keys were pressed.
 */
export function eventToShortcutString(
  event: KeyboardEvent,
  isMacOverride?: boolean,
): string | null {
  if (MODIFIER_KEYS.has(event.key)) {
    return null;
  }

  const isMac = isApplePlatform(isMacOverride);
  const parts: string[] = [];

  const primaryPressed = isMac ? event.metaKey : event.ctrlKey;
  if (primaryPressed) {
    parts.push("Mod");
  }

  // Secondary modifier on Mac (Ctrl) or Windows (Win)
  if (isMac && event.ctrlKey) {
    parts.push("Ctrl");
  }

  if (event.altKey) {
    parts.push("Alt");
  }

  if (event.shiftKey) {
    parts.push("Shift");
  }

  let mainKey = event.key;
  if (event.code && event.code.startsWith("Key") && event.code.length === 4) {
    mainKey = event.code.slice(3).toUpperCase();
  } else if (
    event.code &&
    event.code.startsWith("Digit") &&
    event.code.length === 6
  ) {
    mainKey = event.code.slice(5);
  } else if (event.key === " ") {
    mainKey = "Space";
  } else if (event.key.length === 1) {
    mainKey = event.key.toUpperCase();
  }

  parts.push(mainKey);
  return parts.join("+");
}
