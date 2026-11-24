/**
 * HSL design tokens for the Soroban Playground dynamic theme engine.
 *
 * Every colour is an HSL channel triple (`"h s% l%"`). `globals.css` mirrors
 * these values as CSS custom properties (`--background`, `--code-keyword`, …)
 * and `THEME_CSS_VARIABLES` keeps the TypeScript and CSS definitions pointing at
 * the same variable names — a test asserts the two never drift.
 *
 * The palettes below are not arbitrary: every pair listed in
 * {@link CONTRAST_REQUIREMENTS} is checked by `validateTheme` and covered by
 * `src/__tests__/theme/contrast.test.ts`, so a colour tweak that breaks WCAG
 * AAA on code highlights fails CI instead of shipping.
 *
 * Zero-FOUC: `THEME_BOOTSTRAP_SCRIPT` is a tiny synchronous script intended to
 * be inlined in `<head>` before first paint. It resolves the stored/OS theme
 * and writes the `data-theme` attribute plus the CSS custom properties onto
 * `<html>` so the very first frame already uses the correct palette.
 */

import { WCAG_AA_NORMAL, WCAG_AAA_NORMAL } from "./contrast";
import type { ContrastRequirement, ThemeMode, ThemeTokens } from "./types";

/** Default dark palette — matches the historically dark-only UI. */
export const DARK_TOKENS: ThemeTokens = {
  background: "217 59% 8%",
  foreground: "214 52% 94%",
  accent: "172 66% 50%",
  accentStrong: "25 95% 53%",
  panel: "217 59% 8%",
  panelBorder: "220 30% 60%",
  grid: "220 30% 60%",
  codeBackground: "220 45% 7%",
  codeForeground: "210 40% 96%",
  codeKeyword: "268 85% 78%",
  codeString: "152 65% 68%",
  codeNumber: "30 95% 72%",
  codeComment: "215 22% 66%",
  codeFunction: "190 80% 72%",
  codeType: "45 90% 70%",
  codeOperator: "210 25% 85%",
};

/**
 * Light palette.
 *
 * Code highlights are deliberately darker and more saturated than a naive
 * light-mode inversion: WCAG AAA (7:1) against a 96%-light code surface leaves
 * very little headroom, so each token was solved for the darkest accessible
 * hue its family allows.
 */
export const LIGHT_TOKENS: ThemeTokens = {
  background: "210 40% 98%",
  foreground: "222 47% 11%",
  accent: "172 80% 25%",
  accentStrong: "25 92% 36%",
  panel: "0 0% 100%",
  panelBorder: "222 25% 45%",
  grid: "222 25% 45%",
  codeBackground: "210 30% 96%",
  codeForeground: "222 47% 11%",
  codeKeyword: "268 60% 35%",
  codeString: "152 75% 20%",
  codeNumber: "20 85% 30%",
  codeComment: "215 28% 32%",
  codeFunction: "200 95% 24%",
  codeType: "34 90% 25%",
  codeOperator: "222 30% 25%",
};

/**
 * High-contrast palette meeting WCAG AAA (7:1) for body text and all code
 * highlights. Pure black/white surfaces with saturated, high-luminance accents
 * on dark and near-black accents on light are used so every pair in
 * {@link CONTRAST_REQUIREMENTS} clears the AAA threshold by a wide margin.
 */
export const HIGH_CONTRAST_TOKENS: ThemeTokens = {
  background: "0 0% 0%",
  foreground: "0 0% 100%",
  accent: "180 100% 60%",
  accentStrong: "50 100% 60%",
  panel: "0 0% 0%",
  panelBorder: "0 0% 100%",
  grid: "0 0% 100%",
  codeBackground: "0 0% 0%",
  codeForeground: "0 0% 100%",
  codeKeyword: "300 100% 80%",
  codeString: "120 100% 70%",
  codeNumber: "40 100% 70%",
  codeComment: "0 0% 85%",
  codeFunction: "190 100% 75%",
  codeType: "55 100% 70%",
  codeOperator: "0 0% 95%",
};

/** Token values keyed by mode. */
export const THEME_TOKENS: Record<ThemeMode, ThemeTokens> = {
  dark: DARK_TOKENS,
  light: LIGHT_TOKENS,
  "high-contrast": HIGH_CONTRAST_TOKENS,
};

/** The mode used when nothing has been stored and the OS has no preference. */
export const DEFAULT_THEME_MODE: ThemeMode = "dark";

/**
 * CSS custom property backing each token. Kept in sync with `globals.css` by
 * `src/__tests__/theme/tokens.test.ts`.
 */
export const THEME_CSS_VARIABLES: Record<keyof ThemeTokens, string> = {
  background: "--background",
  foreground: "--foreground",
  accent: "--accent",
  accentStrong: "--accent-strong",
  panel: "--panel",
  panelBorder: "--panel-border",
  grid: "--grid",
  codeBackground: "--code-background",
  codeForeground: "--code-foreground",
  codeKeyword: "--code-keyword",
  codeString: "--code-string",
  codeNumber: "--code-number",
  codeComment: "--code-comment",
  codeFunction: "--code-function",
  codeType: "--code-type",
  codeOperator: "--code-operator",
};

/** The resolved token set for a mode. */
export function tokensForMode(mode: ThemeMode): ThemeTokens {
  return THEME_TOKENS[mode] ?? DARK_TOKENS;
}

/** `{ "--background": "217 59% 8%", ... }` for inline style application. */
export function tokensToCssVariables(tokens: ThemeTokens): Record<string, string> {
  return Object.fromEntries(
    (Object.keys(THEME_CSS_VARIABLES) as (keyof ThemeTokens)[]).map((token) => [
      THEME_CSS_VARIABLES[token],
      tokens[token],
    ]),
  );
}

/**
 * Synchronous, blocking bootstrap script to inline in `<head>` before first
 * paint. It is self-contained (no imports) and mirrors the token values above
 * as a serialized map so the initial frame already uses the resolved palette.
 * Storage/OS-preference failures fall back to {@link DEFAULT_THEME_MODE}.
 */
export const THEME_STORAGE_KEY = "soroban-theme";

export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var m=null;try{m=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)})}catch(e){}
if(m!=='dark'&&m!=='light'&&m!=='high-contrast'){m=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches)?'light':'${DEFAULT_THEME_MODE}';}
var t=${JSON.stringify(
  Object.fromEntries(
    (Object.keys(THEME_TOKENS) as ThemeMode[]).map((mode) => [
      mode,
      tokensToCssVariables(THEME_TOKENS[mode]),
    ]),
  ),
)};
var root=document.documentElement;root.setAttribute('data-theme',m);root.style.colorScheme=m==='light'?'light':'dark';
var vars=t[m];for(var k in vars){root.style.setProperty(k,vars[k]);}
}catch(e){}})();`;

/**
 * The contrast contract every theme must satisfy.
 *
 * Body text and every code-highlight token must reach WCAG AAA; the two brand
 * accents only need AA because they are used for large/bold UI affordances.
 */
export const CONTRAST_REQUIREMENTS: ContrastRequirement[] = [
  {
    name: "Body text on page background",
    foreground: "foreground",
    background: "background",
    minimum: WCAG_AAA_NORMAL,
  },
  {
    name: "Body text on panel surface",
    foreground: "foreground",
    background: "panel",
    minimum: WCAG_AAA_NORMAL,
  },
  {
    name: "Accent text on page background",
    foreground: "accent",
    background: "background",
    minimum: WCAG_AA_NORMAL,
  },
  {
    name: "Strong accent text on page background",
    foreground: "accentStrong",
    background: "background",
    minimum: WCAG_AA_NORMAL,
  },
  {
    name: "Code text on code surface",
    foreground: "codeForeground",
    background: "codeBackground",
    minimum: WCAG_AAA_NORMAL,
  },
  {
    name: "Code keyword highlight",
    foreground: "codeKeyword",
    background: "codeBackground",
    minimum: WCAG_AAA_NORMAL,
  },
  {
    name: "Code string highlight",
    foreground: "codeString",
    background: "codeBackground",
    minimum: WCAG_AAA_NORMAL,
  },
  {
    name: "Code number highlight",
    foreground: "codeNumber",
    background: "codeBackground",
    minimum: WCAG_AAA_NORMAL,
  },
  {
    name: "Code comment highlight",
    foreground: "codeComment",
    background: "codeBackground",
    minimum: WCAG_AAA_NORMAL,
  },
  {
    name: "Code function highlight",
    foreground: "codeFunction",
    background: "codeBackground",
    minimum: WCAG_AAA_NORMAL,
  },
  {
    name: "Code type highlight",
    foreground: "codeType",
    background: "codeBackground",
    minimum: WCAG_AAA_NORMAL,
  },
  {
    name: "Code operator highlight",
    foreground: "codeOperator",
    background: "codeBackground",
    minimum: WCAG_AAA_NORMAL,
  },
];
