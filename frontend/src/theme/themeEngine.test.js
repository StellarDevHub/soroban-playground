/**
 * Verifies the zero-FOUC bootstrap contract and the high-contrast theme.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  THEME_BOOTSTRAP_SCRIPT,
  THEME_ATTRIBUTE,
  THEME_STORAGE_KEY,
  applyTheme,
  getAppliedTheme,
} from "@/lib/theme/engine";
import {
  applyThemeName,
  getStoredThemeName,
  resolveThemeName,
  setThemePreference,
  HIGH_CONTRAST_CLASS,
} from "@/state/themeStore";
import { validateTheme } from "@/lib/theme/engine";

function mockMatchMedia(dark) {
  return () => ({
    matches: dark,
    media: "",
    addEventListener() {},
    removeEventListener() {},
  });
}

function runBootstrap() {
  // eslint-disable-next-line no-new-func
  new Function(THEME_BOOTSTRAP_SCRIPT)();
}

describe("zero-FOUC bootstrap script", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute(THEME_ATTRIBUTE);
    document.documentElement.removeAttribute("style");
    localStorage.clear();
    vi.stubGlobal("matchMedia", mockMatchMedia(false));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sets data-theme synchronously before any effect runs", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    runBootstrap();
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe("dark");
  });

  it("honours a stored light preference so dark never flashes first", () => {
    vi.stubGlobal("matchMedia", mockMatchMedia(true));
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    runBootstrap();
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("follows the OS when preference is system or absent", () => {
    vi.stubGlobal("matchMedia", mockMatchMedia(true));
    runBootstrap();
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe("dark");
  });

  it("falls back to the default theme when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    runBootstrap();
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe("dark");
  });

  it("contains no external references (self-contained for the CSP)", () => {
    expect(THEME_BOOTSTRAP_SCRIPT).not.toMatch(/https?:\/\//);
  });
});

describe("high-contrast theme", () => {
  beforeEach(() => {
    document.documentElement.className = "";
    document.documentElement.removeAttribute(THEME_ATTRIBUTE);
    localStorage.clear();
  });

  it("persists and resolves the high-contrast preference", () => {
    setThemePreference("high-contrast");
    expect(localStorage.getItem("sp:theme")).toBe("high-contrast");
    expect(getStoredThemeName()).toBe("high-contrast");
    expect(resolveThemeName("high-contrast")).toBe("high-contrast");
  });

  it("adds the high-contrast class while keeping a dark base", () => {
    applyThemeName("high-contrast");
    expect(document.documentElement.classList.contains(HIGH_CONTRAST_CLASS)).toBe(true);
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe("dark");
  });

  it("removes the class when switching back to a standard theme", () => {
    applyThemeName("high-contrast");
    applyThemeName("light");
    expect(document.documentElement.classList.contains(HIGH_CONTRAST_CLASS)).toBe(false);
    expect(getAppliedTheme()).toBe("light");
  });

  it("both standard palettes still meet WCAG AAA body-text contrast", () => {
    for (const mode of ["dark", "light"]) {
      const report = validateTheme(mode);
      const body = report.results.filter((r) => r.name.startsWith("Body text"));
      for (const r of body) expect(r.passes).toBe(true);
    }
  });
});

describe("applyTheme", () => {
  it("mirrors tokens as CSS custom properties on the root", () => {
    applyTheme("light");
    expect(document.documentElement.style.getPropertyValue("--background")).not.toBe("");
    expect(getAppliedTheme()).toBe("light");
  });
});
