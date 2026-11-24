/**
 * Theme store — thin, SSR-safe facade over the runtime theme engine.
 *
 * The pre-paint theme is applied by an inline blocking script injected into
 * <head> (see `THEME_BOOTSTRAP_SCRIPT` in `@/lib/theme/engine`). This module
 * exposes the same logic in a framework-agnostic form so non-React consumers
 * (Monaco, charts, tests) can read and change the theme without a React
 * effect, which would otherwise be the source of the flash of unstyled content.
 */

import {
  THEME_ATTRIBUTE,
  THEME_BOOTSTRAP_SCRIPT,
  applyTheme,
  getAppliedTheme,
  readStoredPreference,
  resolveThemeMode,
  systemTheme,
  writeStoredPreference,
} from "@/lib/theme/engine";
import { DEFAULT_THEME_MODE } from "@/lib/theme/tokens";
import type { ThemeMode, ThemePreference } from "@/lib/theme/types";

export type ThemeName = ThemeMode | "high-contrast";

export interface ThemeStoreState {
  preference: ThemePreference;
  mode: ThemeName;
}

/** Set on <html> alongside data-theme so CSS can target the AAA palette. */
export const HIGH_CONTRAST_CLASS = "theme-high-contrast";

/** Inline bootstrap script that must be placed in <head> before first paint. */
export const themeBootstrapScript = THEME_BOOTSTRAP_SCRIPT;

function isHighContrastPreference(value: unknown): value is "high-contrast" {
  return value === "high-contrast";
}

/** Read the persisted preference, including the high-contrast option. */
export function getStoredThemeName(storage?: Storage | null): ThemeName | ThemePreference {
  const stored = readStoredPreference(storage);
  if (stored) return stored;
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem("sp:theme");
      if (isHighContrastPreference(raw)) return "high-contrast";
    } catch {
      /* storage blocked */
    }
  }
  return "system";
}

/** Resolve the concrete theme name to render for a given preference. */
export function resolveThemeName(
  preference: ThemeName | ThemePreference,
  osTheme: ThemeMode = systemTheme(),
): ThemeName {
  if (preference === "high-contrast") return "high-contrast";
  return resolveThemeMode(preference, osTheme);
}

/**
 * Apply a theme name to the document. High contrast reuses the dark token set
 * as its base and is distinguished by a class so the stylesheet can override
 * colours to meet WCAG AAA (7:1) for all text and UI boundaries.
 */
export function applyThemeName(name: ThemeName, target: HTMLElement | Document | null = null): ThemeName {
  const doc = typeof document === "undefined" ? null : document;
  const root = target ?? doc;
  const mode: ThemeMode = name === "light" ? "light" : "dark";
  applyTheme(mode, root);
  const el = root instanceof Document ? root.documentElement : root;
  if (el) {
    if (name === "high-contrast") {
      el.classList.add(HIGH_CONTRAST_CLASS);
      el.setAttribute(THEME_ATTRIBUTE, "dark");
    } else {
      el.classList.remove(HIGH_CONTRAST_CLASS);
    }
  }
  return name;
}

/** Persist and apply a preference synchronously. */
export function setThemePreference(preference: ThemeName | ThemePreference): ThemeStoreState {
  if (preference === "high-contrast") {
    try {
      window.localStorage.setItem("sp:theme", "high-contrast");
      window.localStorage.removeItem("sp-theme");
    } catch {
      /* storage blocked */
    }
    applyThemeName("high-contrast");
    return { preference: "dark", mode: "high-contrast" };
  }
  writeStoredPreference(preference);
  const mode = resolveThemeName(preference);
  applyThemeName(mode);
  return { preference, mode };
}

/** Current theme as observed on the document (falls back to the default). */
export function getCurrentTheme(): ThemeName {
  const doc = typeof document === "undefined" ? null : document;
  if (doc?.documentElement.classList.contains(HIGH_CONTRAST_CLASS)) {
    return "high-contrast";
  }
  return getAppliedTheme(doc) ?? DEFAULT_THEME_MODE;
}
