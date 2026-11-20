/**
 * Theme Store for Soroban Playground.
 *
 * Implements a Clean Architecture Zustand store that interfaces with the
 * runtime Zero-FOUC theme engine.
 *
 * Guarantees:
 *  - Synchronous coordination with document <head> bootstrap script.
 *  - Zero visual flash of unstyled content (Zero-FOUC).
 *  - Full support for WCAG AAA High Contrast mode for low-vision accessibility.
 *  - Multi-tab synchronization via storage events.
 *  - Automatic responsiveness to OS color scheme and forced-colors accessibility.
 */

import { create } from "zustand";
import {
  applyTheme,
  getAppliedTheme,
  readStoredPreference,
  resolveThemeMode,
  systemTheme,
  writeStoredPreference,
  THEME_STORAGE_KEY,
  THEME_CHANGE_EVENT,
  SYSTEM_THEME_QUERY,
} from "@/lib/theme/engine";
import { DEFAULT_THEME_MODE } from "@/lib/theme/tokens";
import type { ThemeMode, ThemePreference } from "@/lib/theme/types";

export interface ThemeStoreState {
  /** The user's chosen preference ('light', 'dark', 'high-contrast', or 'system') */
  theme: ThemePreference;
  /** Concrete active mode currently rendering ('light', 'dark', or 'high-contrast') */
  mode: ThemeMode;
  /** Alias for concrete active mode */
  resolvedTheme: ThemeMode;
  /** Whether the store has mounted and synced on client */
  mounted: boolean;
  /** Quick accessor for high-contrast accessibility */
  isHighContrast: boolean;

  /** Set explicit preference, persisting and applying immediately */
  setTheme: (theme: ThemePreference) => void;
  /** Toggle between light and dark (or high-contrast) */
  toggleTheme: () => void;
  /** Initialize/sync store with document and storage */
  initTheme: () => void;
}

export const selectTheme = (state: ThemeStoreState) => state.theme;
export const selectMode = (state: ThemeStoreState) => state.mode;
export const selectResolvedTheme = (state: ThemeStoreState) => state.resolvedTheme;
export const selectIsHighContrast = (state: ThemeStoreState) => state.isHighContrast;

/**
 * Helper to compute initial state safely across SSR and Client.
 * On client, reads the theme attribute already stamped by the blocking <head> script.
 */
function getInitialThemeState(): {
  theme: ThemePreference;
  mode: ThemeMode;
} {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return {
      theme: "system",
      mode: DEFAULT_THEME_MODE,
    };
  }

  // Read what the synchronous head bootstrap script already applied
  const applied = getAppliedTheme();
  const stored = readStoredPreference();
  const os = systemTheme();

  const theme: ThemePreference = stored ?? "system";
  const mode: ThemeMode = applied ?? resolveThemeMode(theme, os);

  return { theme, mode };
}

export const useThemeStore = create<ThemeStoreState>((set, get) => {
  const initial = getInitialThemeState();

  return {
    theme: initial.theme,
    mode: initial.mode,
    resolvedTheme: initial.mode,
    mounted: false,
    isHighContrast: initial.mode === "high-contrast",

    setTheme: (theme: ThemePreference) => {
      writeStoredPreference(theme);
      const os = systemTheme();
      const resolved = resolveThemeMode(theme, os);

      applyTheme(resolved);

      set({
        theme,
        mode: resolved,
        resolvedTheme: resolved,
        isHighContrast: resolved === "high-contrast",
      });

      if (typeof document !== "undefined") {
        document.dispatchEvent(
          new CustomEvent(THEME_CHANGE_EVENT, {
            detail: { preference: theme, mode: resolved, source: "stored" },
          }),
        );
      }
    },

    toggleTheme: () => {
      const current = get().mode;
      const next: ThemeMode = current === "dark" ? "light" : "dark";
      get().setTheme(next);
    },

    initTheme: () => {
      if (typeof window === "undefined") return;

      const stored = readStoredPreference();
      const os = systemTheme();
      const theme: ThemePreference = stored ?? "system";
      const applied = getAppliedTheme();
      const mode: ThemeMode = applied ?? resolveThemeMode(theme, os);

      // Ensure theme is applied to DOM without flash
      applyTheme(mode);

      set({
        theme,
        mode,
        resolvedTheme: mode,
        mounted: true,
        isHighContrast: mode === "high-contrast",
      });

      // Synchronize across browser tabs
      const handleStorage = (e: StorageEvent) => {
        if (e.key === THEME_STORAGE_KEY || e.key === "sp-theme" || e.key === "theme") {
          const newStored = readStoredPreference();
          const newTheme: ThemePreference = newStored ?? "system";
          const newResolved = resolveThemeMode(newTheme, systemTheme());
          applyTheme(newResolved);
          set({
            theme: newTheme,
            mode: newResolved,
            resolvedTheme: newResolved,
            isHighContrast: newResolved === "high-contrast",
          });
        }
      };

      // Listen to OS scheme changes if following system
      const mediaDark = window.matchMedia ? window.matchMedia(SYSTEM_THEME_QUERY) : null;
      const handleMediaChange = () => {
        if (get().theme === "system") {
          const newResolved = systemTheme();
          applyTheme(newResolved);
          set({
            mode: newResolved,
            resolvedTheme: newResolved,
            isHighContrast: newResolved === "high-contrast",
          });
        }
      };

      window.addEventListener("storage", handleStorage);
      mediaDark?.addEventListener?.("change", handleMediaChange);
    },
  };
});
