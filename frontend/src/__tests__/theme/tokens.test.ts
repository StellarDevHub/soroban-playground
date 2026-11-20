import fs from "fs";
import path from "path";
import { parseHslTriple } from "../../lib/theme/contrast";
import {
  CONTRAST_REQUIREMENTS,
  DARK_TOKENS,
  DEFAULT_THEME_MODE,
  HIGH_CONTRAST_TOKENS,
  LIGHT_TOKENS,
  THEME_CSS_VARIABLES,
  THEME_TOKENS,
  tokensForMode,
  tokensToCssVariables,
} from "../../lib/theme/tokens";
import type { ThemeTokens } from "../../lib/theme/types";

const GLOBALS_CSS = fs
  .readFileSync(path.join(__dirname, "..", "..", "app", "globals.css"), "utf8")
  .replace(/\r\n/g, "\n");

/** Everything between the first `{` after `selector` and its matching `}`. */
function ruleBody(css: string, selector: string): string {
  const selectorIndex = css.indexOf(selector);
  if (selectorIndex === -1) {
    throw new Error(`globals.css is missing the "${selector}" rule`);
  }
  const open = css.indexOf("{", selectorIndex);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

describe("token definitions", () => {
  it("exposes shipped themes plus a default", () => {
    expect(Object.keys(THEME_TOKENS).sort()).toEqual([
      "dark",
      "high-contrast",
      "light",
    ]);
    expect(DEFAULT_THEME_MODE).toBe("dark");
  });

  it("returns the same object identity for a mode", () => {
    expect(tokensForMode("dark")).toBe(DARK_TOKENS);
    expect(tokensForMode("light")).toBe(LIGHT_TOKENS);
    expect(tokensForMode("high-contrast")).toBe(HIGH_CONTRAST_TOKENS);
  });

  it("defines the same keys in both palettes", () => {
    expect(Object.keys(DARK_TOKENS).sort()).toEqual(
      Object.keys(LIGHT_TOKENS).sort(),
    );
  });

  it("stores every colour as a valid HSL channel triple", () => {
    for (const tokens of Object.values(THEME_TOKENS)) {
      for (const value of Object.values(tokens)) {
        expect(() => parseHslTriple(value)).not.toThrow();
        expect(value).toBe(value.trim());
      }
    }
  });

  it("uses a distinct code background from the page background", () => {
    expect(DARK_TOKENS.codeBackground).not.toBe(DARK_TOKENS.background);
    expect(LIGHT_TOKENS.codeBackground).not.toBe(LIGHT_TOKENS.background);
  });
});

describe("CSS variable bridge", () => {
  it("maps every token to a kebab-cased custom property", () => {
    const names = Object.values(THEME_CSS_VARIABLES);
    expect(names).toHaveLength(Object.keys(DARK_TOKENS).length);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^--[a-z-]+$/);
    }
  });

  it("serialises a token set into the same variable names", () => {
    const variables = tokensToCssVariables(LIGHT_TOKENS);
    expect(Object.keys(variables).sort()).toEqual(
      Object.values(THEME_CSS_VARIABLES).sort(),
    );
    for (const [token, name] of Object.entries(THEME_CSS_VARIABLES)) {
      expect(variables[name]).toBe(LIGHT_TOKENS[token as keyof ThemeTokens]);
    }
  });
});

describe("globals.css stays in sync with the tokens", () => {
  const darkBlock = ruleBody(GLOBALS_CSS, ':root,\n[data-theme="dark"]');
  const lightBlock = ruleBody(GLOBALS_CSS, '[data-theme="light"] {');
  const highContrastBlock = ruleBody(
    GLOBALS_CSS,
    '[data-theme="high-contrast"] {',
  );

  it("declares every token for the default + dark theme", () => {
    for (const [token, name] of Object.entries(THEME_CSS_VARIABLES)) {
      expect(darkBlock).toContain(
        `${name}: ${DARK_TOKENS[token as keyof ThemeTokens]};`,
      );
    }
  });

  it("declares every token for the light theme", () => {
    for (const [token, name] of Object.entries(THEME_CSS_VARIABLES)) {
      expect(lightBlock).toContain(
        `${name}: ${LIGHT_TOKENS[token as keyof ThemeTokens]};`,
      );
    }
  });

  it("declares every token for the high-contrast theme", () => {
    for (const [token, name] of Object.entries(THEME_CSS_VARIABLES)) {
      expect(highContrastBlock).toContain(
        `${name}: ${HIGH_CONTRAST_TOKENS[token as keyof ThemeTokens]};`,
      );
    }
  });

  it("binds semantic CSS custom properties across themes", () => {
    expect(darkBlock).toContain("--bg-primary:");
    expect(darkBlock).toContain("--text-primary:");
    expect(darkBlock).toContain("--border-primary:");
    expect(lightBlock).toContain("--bg-primary:");
    expect(lightBlock).toContain("--text-primary:");
    expect(lightBlock).toContain("--border-primary:");
    expect(highContrastBlock).toContain("--bg-primary: #000000;");
    expect(highContrastBlock).toContain("--text-primary: #ffffff;");
    expect(highContrastBlock).toContain("--border-primary: #ffffff;");
  });

  it("keys the default palette off [data-theme] so the engine can switch it", () => {
    expect(GLOBALS_CSS).toContain('[data-theme="dark"]');
    expect(GLOBALS_CSS).toContain('[data-theme="light"]');
    expect(GLOBALS_CSS).toContain('[data-theme="high-contrast"]');
    expect(GLOBALS_CSS).toContain("color-scheme: dark");
    expect(GLOBALS_CSS).toContain("color-scheme: light");
  });

  it("bridges the tokens into Tailwind utilities", () => {
    expect(GLOBALS_CSS).toContain("--color-background: hsl(var(--background))");
    expect(GLOBALS_CSS).toContain("--color-foreground: hsl(var(--foreground))");
    expect(GLOBALS_CSS).toContain("--color-panel: hsl(var(--panel))");
  });

  it("exposes every code highlight token as a reusable class", () => {
    for (const name of [
      "--code-background",
      "--code-foreground",
      "--code-keyword",
      "--code-string",
      "--code-number",
      "--code-comment",
      "--code-function",
      "--code-type",
      "--code-operator",
    ]) {
      expect(GLOBALS_CSS).toContain(`hsl(var(${name}))`);
    }
  });
});

describe("contrast requirements", () => {
  it("covers body text, both accents and all eight code highlights", () => {
    expect(CONTRAST_REQUIREMENTS).toHaveLength(12);
    const names = CONTRAST_REQUIREMENTS.map((requirement) => requirement.name);
    expect(new Set(names).size).toBe(names.length);
    expect(
      CONTRAST_REQUIREMENTS.filter((requirement) =>
        requirement.name.startsWith("Code "),
      ),
    ).toHaveLength(8);
  });

  it("only references tokens that exist", () => {
    const keys = Object.keys(DARK_TOKENS);
    for (const requirement of CONTRAST_REQUIREMENTS) {
      expect(keys).toContain(requirement.foreground);
      expect(keys).toContain(requirement.background);
    }
  });
});
