/**
 * Shared types for the Soroban Playground dynamic theme engine.
 *
 * Colours are stored as **HSL channel triples** (`"h s% l%"`) rather than as
 * finished colour strings so that a single token can be consumed both as an
 * opaque colour (`hsl(var(--token))`) and with an arbitrary alpha channel
 * (`hsl(var(--token) / 0.4)`), and so the WCAG validator can reason about the
 * exact channels that the browser will paint.
 */

/** The three concrete themes the app can render. */
export type ThemeMode = "light" | "dark" | "high-contrast";

/**
 * What the user asked for. `"system"` follows `prefers-color-scheme` and is the
 * default for first-time visitors.
 */
export type ThemePreference = ThemeMode | "system";

/** Where the active theme came from — useful for debugging and telemetry. */
export type ThemeSource = "stored" | "system" | "default";

/**
 * The full palette of a theme.
 *
 * Every value is an HSL channel triple, e.g. `"217 59% 8%"`, which is meant to
 * be consumed as `hsl(var(--background))`.
 */
export interface ThemeTokens {
  /** Page background. */
  background: string;
  /** Default body text. */
  foreground: string;
  /** Accent brand colour, also used for focus rings / links. */
  accent: string;
  /** Secondary brand colour (call-to-action / warnings). */
  accentStrong: string;
  /** Opaque panel surface colour, used for contrast evaluation. */
  panel: string;
  /** Decorative panel border (usually rendered with an alpha channel). */
  panelBorder: string;
  /** Decorative background grid (usually rendered with an alpha channel). */
  grid: string;
  /** Background of code editors / highlight blocks. */
  codeBackground: string;
  /** Default code text. */
  codeForeground: string;
  /** `if`, `let`, `pub`, `fn`, … */
  codeKeyword: string;
  /** String literals. */
  codeString: string;
  /** Numeric literals. */
  codeNumber: string;
  /** Line and block comments. */
  codeComment: string;
  /** Function / method names. */
  codeFunction: string;
  /** Type names and trait names. */
  codeType: string;
  /** Operators and punctuation that should stand out. */
  codeOperator: string;
}

/**
 * A single contrast guarantee the theme must uphold.
 *
 * `foreground` and `background` are keys of {@link ThemeTokens} so a typo is a
 * compile error rather than a silently skipped check.
 */
export interface ContrastRequirement {
  /** Human readable description, surfaced in failure messages. */
  name: string;
  foreground: keyof ThemeTokens;
  background: keyof ThemeTokens;
  /** Minimum WCAG contrast ratio required for this pair. */
  minimum: number;
}
