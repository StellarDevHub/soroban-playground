/**
 * Unit tests for Theme Store (Issue #2052 / Clean Architecture)
 */

import {
  useThemeStore,
  selectTheme,
  selectMode,
  selectResolvedTheme,
  selectIsHighContrast,
} from "../../state/themeStore";
import {
  THEME_STORAGE_KEY,
  THEME_ATTRIBUTE,
  applyTheme,
  getAppliedTheme,
} from "../../lib/theme/engine";

describe("Theme Store", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute(THEME_ATTRIBUTE);
    document.documentElement.className = "";
    // Reset store state
    useThemeStore.setState({
      theme: "system",
      mode: "dark",
      resolvedTheme: "dark",
      mounted: false,
      isHighContrast: false,
    });
  });

  it("provides initial store state and selectors", () => {
    const state = useThemeStore.getState();
    expect(selectTheme(state)).toBe("system");
    expect(selectMode(state)).toBe("dark");
    expect(selectResolvedTheme(state)).toBe("dark");
    expect(selectIsHighContrast(state)).toBe(false);
  });

  it("updates state and persists when setTheme is called with light", () => {
    useThemeStore.getState().setTheme("light");

    const state = useThemeStore.getState();
    expect(selectTheme(state)).toBe("light");
    expect(selectMode(state)).toBe("light");
    expect(selectResolvedTheme(state)).toBe("light");
    expect(selectIsHighContrast(state)).toBe(false);

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });

  it("updates state and document when setTheme is called with high-contrast", () => {
    useThemeStore.getState().setTheme("high-contrast");

    const state = useThemeStore.getState();
    expect(selectTheme(state)).toBe("high-contrast");
    expect(selectMode(state)).toBe("high-contrast");
    expect(selectResolvedTheme(state)).toBe("high-contrast");
    expect(selectIsHighContrast(state)).toBe(true);

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("high-contrast");
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe("high-contrast");
    expect(document.documentElement.classList.contains("high-contrast")).toBe(true);
  });

  it("toggles between dark and light themes", () => {
    useThemeStore.getState().setTheme("dark");
    expect(useThemeStore.getState().mode).toBe("dark");

    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().mode).toBe("light");

    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().mode).toBe("dark");
  });

  it("synchronizes with the document and storage on initTheme without flash", () => {
    // Pre-paint state set by blocking <head> script
    document.documentElement.setAttribute(THEME_ATTRIBUTE, "high-contrast");
    document.documentElement.classList.add("high-contrast");
    window.localStorage.setItem(THEME_STORAGE_KEY, "high-contrast");

    useThemeStore.getState().initTheme();

    const state = useThemeStore.getState();
    expect(state.mounted).toBe(true);
    expect(state.theme).toBe("high-contrast");
    expect(state.mode).toBe("high-contrast");
    expect(state.isHighContrast).toBe(true);
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe("high-contrast");
  });

  it("synchronizes when storage event is fired from another tab", () => {
    useThemeStore.getState().initTheme();

    // Another tab writes to localStorage
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: THEME_STORAGE_KEY,
        newValue: "light",
      }),
    );

    const state = useThemeStore.getState();
    expect(state.theme).toBe("light");
    expect(state.mode).toBe("light");
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe("light");
  });
});
