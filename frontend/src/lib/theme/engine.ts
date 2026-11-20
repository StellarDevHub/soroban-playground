/**
 * Runtime theme engine.
 *
 * Responsibilities:
 *  - decide which theme should be active (stored preference → OS preference → default);
 *  - apply it to the document without a flash of the wrong theme;
 *  - persist explicit user choices and keep every open tab in sync;
 *  - let the rest of the app observe theme changes (Monaco, charts, …).
 *
 * Every helper is SSR-safe: when `window`/`document` are unavailable the engine
 * falls back to static answers instead of throwing during pre-render.
 */

import { evaluateContrast, type ContrastReport } from "./contrast";
import {
  CONTRAST_REQUIREMENTS,
  DEFAULT_THEME_MODE,
  getSemanticVariables,
  tokensForMode,
  tokensToCssVariables,
} from "./tokens";
import type {
  ThemeMode,
  ThemePreference,
  ThemeSource,
  ThemeTokens,
} from "./types";

/** `localStorage` key holding the user's explicit preference. */
export const THEME_STORAGE_KEY = "sp:theme";

/** `localStorage` key added by browsers when a theme was never chosen. */
const LEGACY_STORAGE_KEY = "sp-theme";

/** Media query used to detect the operating system theme. */
export const SYSTEM_THEME_QUERY = "(prefers-color-scheme: dark)";

/** Attribute written on `<html>`; `globals.css` keys off it. */
export const THEME_ATTRIBUTE = "data-theme";

/** Event dispatched on `document` after the theme changes. */
export const THEME_CHANGE_EVENT = "sp:themechange";

export interface ThemeState {
  /** What the user asked for. */
  preference: ThemePreference;
  /** The concrete theme that is rendering. */
  mode: ThemeMode;
  /** Where `preference` came from. */
  source: ThemeSource;
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "high-contrast";
}

function isThemePreference(value: unknown): value is ThemePreference {
  return isThemeMode(value) || value === "system";
}

function getWindow(): (Window & typeof globalThis) | null {
  return typeof window === "undefined" ? null : window;
}

function getDocument(): Document | null {
  return typeof document === "undefined" ? null : document;
}

/** Resolve a storage implementation, tolerating privacy-mode failures. */
function getStorage(storage?: Storage | null): Storage | null {
  if (storage) return storage;
  try {
    return getWindow()?.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Read the persisted preference, accepting the legacy key as a fallback. */
export function readStoredPreference(storage?: Storage | null): ThemePreference | null {
  const store = getStorage(storage);
  if (!store) return null;
  try {
    const raw = store.getItem(THEME_STORAGE_KEY) ?? store.getItem(LEGACY_STORAGE_KEY);
    return isThemePreference(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Persist an explicit preference. No-ops when storage is unavailable. */
export function writeStoredPreference(
  preference: ThemePreference,
  storage?: Storage | null,
): void {
  const store = getStorage(storage);
  if (!store) return;
  try {
    store.setItem(THEME_STORAGE_KEY, preference);
    store.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* storage full or blocked — the in-memory state still applies */
  }
}

/** What the operating system currently asks for. */
export function systemTheme(
  matchMediaImplementation?: ((query: string) => MediaQueryList) | null,
): ThemeMode {
  const matchMedia =
    matchMediaImplementation ?? getWindow()?.matchMedia?.bind(getWindow());
  if (!matchMedia) return DEFAULT_THEME_MODE;
  try {
    if (matchMedia("(forced-colors: active)").matches) {
      return "high-contrast";
    }
    if (matchMedia("(prefers-contrast: more)").matches) {
      return "high-contrast";
    }
    return matchMedia(SYSTEM_THEME_QUERY).matches ? "dark" : "light";
  } catch {
    return DEFAULT_THEME_MODE;
  }
}

/** Turn a preference plus the OS theme into the concrete theme to render. */
export function resolveThemeMode(
  preference: ThemePreference,
  osTheme: ThemeMode,
): ThemeMode {
  return preference === "system" ? osTheme : preference;
}

/** Work out the full initial state from storage + the OS. */
export function resolveThemeState(
  storage?: Storage | null,
  matchMediaImplementation?: ((query: string) => MediaQueryList) | null,
): ThemeState {
  const stored = readStoredPreference(storage);
  const osTheme = systemTheme(matchMediaImplementation);

  // An explicit light/dark choice is honoured and attributed to storage; a
  // persisted "system" preference keeps following the OS and stays attributed
  // to the system.
  if (stored && stored !== "system") {
    return { preference: stored, mode: resolveThemeMode(stored, osTheme), source: "stored" };
  }

  return { preference: stored ?? "system", mode: osTheme, source: "system" };
}

/**
 * Write a theme onto the document.
 *
 * Tokens are mirrored as inline custom properties on `<html>` so a theme can be
 * applied before the stylesheet is parsed (avoiding a flash of the wrong
 * palette) and so a future custom-theme feature can swap values at runtime.
 */
export function applyTheme(
  mode: ThemeMode,
  target: HTMLElement | Document | null = getDocument(),
): ThemeMode {
  if (!target) return mode;
  const root = target instanceof Document ? target.documentElement : target;
  if (!root) return mode;

  root.setAttribute(THEME_ATTRIBUTE, mode);
  root.classList.remove("dark", "light", "high-contrast");
  root.classList.add(mode);
  root.style.setProperty("color-scheme", mode === "light" ? "light" : "dark");

  const variables = tokensToCssVariables(tokensForMode(mode));
  for (const [name, value] of Object.entries(variables)) {
    root.style.setProperty(name, value);
  }

  const semanticVars = getSemanticVariables(mode);
  for (const [name, value] of Object.entries(semanticVars)) {
    root.style.setProperty(name, value);
  }

  return mode;
}

/** The theme currently written on the document, or `null` if none. */
export function getAppliedTheme(
  target: HTMLElement | Document | null = getDocument(),
): ThemeMode | null {
  if (!target) return null;
  const root = target instanceof Document ? target.documentElement : target;
  const value = root?.getAttribute(THEME_ATTRIBUTE);
  return isThemeMode(value) ? value : null;
}

/** The token set currently applied to the document. */
export function getAppliedTokens(
  target: HTMLElement | Document | null = getDocument(),
): ThemeTokens {
  return tokensForMode(getAppliedTheme(target) ?? DEFAULT_THEME_MODE);
}

/** WCAG report for a theme — used by the contrast validator UI and by tests. */
export function validateTheme(mode: ThemeMode): ContrastReport {
  return evaluateContrast(tokensForMode(mode), CONTRAST_REQUIREMENTS);
}

/**
 * Inline bootstrap script.
 *
 * Injected into `<head>` by the root layout so the correct `data-theme` is set
 * before first paint. Kept dependency-free and defensive: any failure falls
 * back to the default dark theme rather than leaving the page unstyled.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var k=${JSON.stringify(
  THEME_STORAGE_KEY,
)},l=${JSON.stringify(LEGACY_STORAGE_KEY)},alt="theme",d=${JSON.stringify(
  DEFAULT_THEME_MODE,
)},a=${JSON.stringify(THEME_ATTRIBUTE)};var s=null;try{s=window.localStorage}catch(e){}var p=null;if(s){p=s.getItem(k)||s.getItem(l)||s.getItem(alt)}if(p!=="light"&&p!=="dark"&&p!=="high-contrast"&&p!=="system"){p=null}var m=p;if(m==="system"||m===null){if(window.matchMedia&&window.matchMedia("(forced-colors: active)").matches){m="high-contrast"}else if(window.matchMedia&&window.matchMedia("(prefers-contrast: more)").matches){m="high-contrast"}else{m=window.matchMedia&&window.matchMedia(${JSON.stringify(
  SYSTEM_THEME_QUERY,
)}).matches?"dark":"light"}}var r=document.documentElement;r.setAttribute(a,m);r.classList.remove("dark","light","high-contrast");r.classList.add(m);r.style.colorScheme=m==="light"?"light":"dark"}catch(e){document.documentElement.setAttribute(${JSON.stringify(
  THEME_ATTRIBUTE,
)},${JSON.stringify(DEFAULT_THEME_MODE)});document.documentElement.classList.add(${JSON.stringify(DEFAULT_THEME_MODE)})}})();`;

export interface ThemeController {
  /** Current preference, resolved mode and provenance. */
  getState(): ThemeState;
  /** Change the user's preference, applying and persisting it immediately. */
  setPreference(preference: ThemePreference): ThemeState;
  /** Flip between light and dark, pinning an explicit preference. */
  toggle(): ThemeState;
  /** Subscribe to changes. Returns an unsubscribe function. */
  subscribe(listener: (state: ThemeState) => void): () => void;
  /** Detach every listener and observer. */
  destroy(): void;
}

/**
 * Create a controller that owns the theme for the lifetime of a React tree.
 *
 * `setPreference("system")` keeps following the OS; an explicit light/dark
 * choice pins the theme until the user changes it again.
 */
export function createThemeController(): ThemeController {
  const win = getWindow();
  const doc = getDocument();

  const state = resolveThemeState();
  const listeners = new Set<(state: ThemeState) => void>();

  applyTheme(state.mode, doc);

  const notify = (next: ThemeState) => {
    state.preference = next.preference;
    state.mode = next.mode;
    state.source = next.source;
    listeners.forEach((listener) => listener({ ...state }));
  };

  const setPreference = (preference: ThemePreference): ThemeState => {
    writeStoredPreference(preference);
    const next: ThemeState = {
      preference,
      mode: resolveThemeMode(preference, systemTheme()),
      source: "stored",
    };
    applyTheme(next.mode, doc);
    notify(next);
    doc?.dispatchEvent?.(new CustomEvent(THEME_CHANGE_EVENT, { detail: next }));
    return { ...state };
  };

  const handleSystemChange = () => {
    if (state.preference !== "system") return;
    const next: ThemeState = {
      preference: "system",
      mode: systemTheme(),
      source: "system",
    };
    applyTheme(next.mode, doc);
    notify(next);
  };

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY && event.key !== LEGACY_STORAGE_KEY) {
      return;
    }
    const stored = readStoredPreference();
    const next: ThemeState =
      stored && stored !== "system"
        ? { preference: stored, mode: resolveThemeMode(stored, systemTheme()), source: "stored" }
        : { preference: stored ?? "system", mode: systemTheme(), source: "system" };
    applyTheme(next.mode, doc);
    notify(next);
  };

  const media = win?.matchMedia?.(SYSTEM_THEME_QUERY) ?? null;
  media?.addEventListener?.("change", handleSystemChange);
  win?.addEventListener?.("storage", handleStorage);

  return {
    getState: () => ({ ...state }),
    setPreference,
    toggle: () => setPreference(state.mode === "dark" ? "light" : "dark"),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy: () => {
      listeners.clear();
      media?.removeEventListener?.("change", handleSystemChange);
      win?.removeEventListener?.("storage", handleStorage);
    },
  };
}
