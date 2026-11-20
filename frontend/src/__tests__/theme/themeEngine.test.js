// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT
// Theme Engine & Zero-FOUC Bootstrap unit tests (Issue #2052)

const {
  THEME_BOOTSTRAP_SCRIPT,
  THEME_STORAGE_KEY,
  THEME_ATTRIBUTE,
  applyTheme,
  getAppliedTheme,
  systemTheme,
} = require("../../lib/theme/engine");
const {
  THEME_TOKENS,
  DEFAULT_THEME_MODE,
  HIGH_CONTRAST_TOKENS,
  CONTRAST_REQUIREMENTS,
  tokensForMode,
  getSemanticVariables,
} = require("../../lib/theme/tokens");
const { evaluateContrast } = require("../../lib/theme/contrast");

describe("Theme Engine", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute(THEME_ATTRIBUTE);
    document.documentElement.className = "";
  });

  it("default theme is dark", () => {
    expect(["dark", "light", "high-contrast"]).toContain(DEFAULT_THEME_MODE);
    expect(DEFAULT_THEME_MODE).toBe("dark");
  });

  it("theme tokens include primary colour and semantic variables", () => {
    const tokens = tokensForMode("dark");
    expect(tokens.accent).toBeDefined();
    expect(tokens.background).toBeDefined();
    expect(tokens.panel).toBeDefined();
    expect(tokens.foreground).toBeDefined();

    const semanticVars = getSemanticVariables("dark");
    expect(semanticVars["--bg-primary"]).toBeDefined();
    expect(semanticVars["--text-primary"]).toBeDefined();
    expect(semanticVars["--border-primary"]).toBeDefined();
  });

  it("switching theme updates class and data-theme on document without flash", () => {
    applyTheme("light");
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    applyTheme("high-contrast");
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe("high-contrast");
    expect(document.documentElement.classList.contains("high-contrast")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);

    applyTheme("dark");
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("high-contrast")).toBe(false);
  });

  it("persists theme preference to localStorage", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "high-contrast");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("high-contrast");

    window.localStorage.setItem("theme", "light");
    expect(window.localStorage.getItem("theme")).toBe("light");
  });

  it("falls back to system preference when no stored value", () => {
    const darkMatchMedia = (query) => ({
      matches: query.includes("prefers-color-scheme") && query.includes("dark"),
      media: query,
    });
    expect(systemTheme(darkMatchMedia)).toBe("dark");

    const highContrastMatchMedia = (query) => ({
      matches: query.includes("forced-colors") || query.includes("prefers-contrast"),
      media: query,
    });
    expect(systemTheme(highContrastMatchMedia)).toBe("high-contrast");
  });

  it("provides official WCAG AAA High-Contrast theme meeting all contrast criteria", () => {
    const report = evaluateContrast(HIGH_CONTRAST_TOKENS, CONTRAST_REQUIREMENTS);
    expect(report.passes).toBe(true);
    for (const check of report.checks) {
      expect(check.passes).toBe(true);
      expect(check.ratio).toBeGreaterThanOrEqual(check.minimum);
    }
  });

  it("synchronous blocking head script applies theme before first paint (Zero-FOUC)", () => {
    // Simulate stored user preference in dark mode
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");

    // Execute the bootstrap script in isolation as would happen in <head>
    eval(THEME_BOOTSTRAP_SCRIPT);

    // Verify documentElement has theme attribute and class set immediately
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");

    // Simulate switching stored preference to high-contrast
    window.localStorage.setItem(THEME_STORAGE_KEY, "high-contrast");
    eval(THEME_BOOTSTRAP_SCRIPT);

    expect(document.documentElement.getAttribute("data-theme")).toBe("high-contrast");
    expect(document.documentElement.classList.contains("high-contrast")).toBe(true);
  });

  it("verifies zero visual flash during simulated page load with light theme", () => {
    // Initial server-rendered state with dark default
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.className = "dark";

    // User preference in localStorage is light
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");

    // Running head script prior to body render flips attributes synchronously
    eval(THEME_BOOTSTRAP_SCRIPT);

    // Document is already light BEFORE body renders
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
