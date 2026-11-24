"use client";

import React from "react";
import {
  applyTheme,
  createThemeController,
  resolveThemeMode,
  systemTheme,
  writeStoredPreference,
  type ThemeController,
  type ThemeState,
} from "@/lib/theme/engine";
import { DEFAULT_THEME_MODE } from "@/lib/theme/tokens";
import type { ThemePreference } from "@/lib/theme/types";

/**
 * First-render state shared by the server and the hydration pass (#1369).
 *
 * The persisted preference lives in `localStorage` and the OS theme in
 * `matchMedia` — neither exists on the server. Seeding React state from the
 * controller during render would therefore make the client's first render
 * depend on browser storage the server never saw (e.g. a stored `"light"`
 * preference rendering light while the server rendered dark) and trip a
 * hydration mismatch. The provider renders this canonical default until the
 * mount effect adopts the real stored/OS theme.
 *
 * The pre-paint bootstrap script in the root `<head>` has already applied the
 * correct `data-theme` / color-scheme attributes before first paint, so the
 * visible theme is correct from the first frame (no FOUC); React state simply
 * catches up after mount.
 */
export const SSR_THEME_STATE: ThemeState = {
  preference: "system",
  mode: DEFAULT_THEME_MODE,
  source: "system",
};

export interface ThemeContextValue {
  /** Current preference, resolved mode and provenance. */
  state: ThemeState;
  /** Change the preference (applies + persists immediately). */
  setPreference: (preference: ThemePreference) => void;
  /** Flip between light and dark, pinning an explicit preference. */
  toggle: () => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

/**
 * Owns the theme for the whole app.
 *
 * The controller is created lazily (once per browser session) and the rendered
 * tree is wrapped in context so any component can read or change the theme.
 * The pre-paint theme itself is set by {@link THEME_BOOTSTRAP_SCRIPT} in the
 * root layout — this provider keeps React state in step with it.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // #1369 — never create the controller during render. `createThemeController`
  // reads `localStorage` + `matchMedia` as part of construction, so building
  // it in the render body makes the first client render depend on browser
  // storage the server never saw. The controller is created in the mount
  // effect below; until then the tree renders the canonical SSR default.
  const [controller, setController] =
    React.useState<ThemeController | null>(null);

  // SSR default — never read storage/matchMedia during render (#1369).
  const [state, setState] = React.useState<ThemeState>(SSR_THEME_STATE);

  React.useEffect(() => {
    // Adopt the persisted/OS theme only after mount so the server HTML stays
    // authoritative for the hydration pass. The pre-paint bootstrap script in
    // `<head>` already set the correct `data-theme` attribute, so this only
    // brings React state in step without touching the DOM twice.
    const created = createThemeController();
    setState(created.getState());
    const unsubscribe = created.subscribe(setState);
    setController(created);
    return () => {
      unsubscribe();
      created.destroy();
    };
  }, []);

  const value = React.useMemo<ThemeContextValue>(
    () => ({
      state,
      setPreference: (preference) => {
        if (controller) {
          setState(controller.setPreference(preference));
          return;
        }
        // Pre-mount fallback (e.g. a toggle fired before the effect ran):
        // persist + update local state optimistically. The controller will
        // re-read the same stored value when it is created, so this converges.
        writeStoredPreference(preference);
        const next: ThemeState = {
          preference,
          mode: resolveThemeMode(preference, systemTheme()),
          source: "stored",
        };
        applyTheme(next.mode);
        setState(next);
      },
      toggle: () => {
        if (controller) {
          setState(controller.toggle());
          return;
        }
        const preference = state.mode === "dark" ? "light" : "dark";
        writeStoredPreference(preference);
        const next: ThemeState = {
          preference,
          mode: resolveThemeMode(preference, systemTheme()),
          source: "stored",
        };
        applyTheme(next.mode);
        setState(next);
      },
    }),
    [controller, state],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Read the active theme and the mutators. Must be used inside {@link ThemeProvider}. */
export function useTheme(): ThemeContextValue {
  const context = React.useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used inside a <ThemeProvider>");
  }
  return context;
}

export default ThemeProvider;
