import type * as monaco from "monaco-editor";
import { hslToHex } from "./contrast";
import { tokensForMode } from "./tokens";
import type { ThemeMode, ThemeTokens } from "./types";

/** Registered Monaco theme name; the editor selects it instead of `vs-dark`. */
export const MONACO_THEME_NAME = "soroban-playground";

/**
 * Map the design tokens onto Monaco's token vocabulary.
 *
 * Keeping this in one place means the editor highlight colours can never drift
 * from the CSS tokens the rest of the app (and the WCAG validator) uses.
 */
const TOKEN_RULES: { token: string; tokenKey: keyof ThemeTokens }[] = [
  { token: "", tokenKey: "codeForeground" },
  { token: "comment", tokenKey: "codeComment" },
  { token: "keyword", tokenKey: "codeKeyword" },
  { token: "keyword.control", tokenKey: "codeKeyword" },
  { token: "keyword.directive", tokenKey: "codeKeyword" },
  { token: "string", tokenKey: "codeString" },
  { token: "string.escape", tokenKey: "codeString" },
  { token: "number", tokenKey: "codeNumber" },
  { token: "number.hex", tokenKey: "codeNumber" },
  { token: "identifier", tokenKey: "codeForeground" },
  { token: "function", tokenKey: "codeFunction" },
  { token: "type", tokenKey: "codeType" },
  { token: "type.identifier", tokenKey: "codeType" },
  { token: "operator", tokenKey: "codeOperator" },
  { token: "delimiter", tokenKey: "codeOperator" },
];

/**
 * Build a Monaco theme from the HSL design tokens for a given mode.
 *
 * The returned object is ready for `monaco.editor.defineTheme`.
 */
export function buildMonacoTheme(
  mode: ThemeMode = "dark",
): monaco.editor.IStandaloneThemeData {
  const tokens = tokensForMode(mode);
  const codeBackground = hslToHex(tokens.codeBackground);
  const codeForeground = hslToHex(tokens.codeForeground);
  const accent = hslToHex(tokens.accent);

  return {
    base: mode === "high-contrast" ? "hc-black" : mode === "dark" ? "vs-dark" : "vs",
    inherit: true,
    rules: TOKEN_RULES.map(({ token, tokenKey }) => ({
      token,
      foreground: hslToHex(tokens[tokenKey]).slice(1),
      background: token === "" ? codeBackground.slice(1) : undefined,
    })),
    colors: {
      "editor.background": codeBackground,
      "editor.foreground": codeForeground,
      "editorCursor.foreground": accent,
      "editor.lineHighlightBackground": `${codeForeground}14`,
      "editor.selectionBackground": `${accent}44`,
      "editorLineNumber.foreground": hslToHex(tokens.codeComment),
      "editorLineNumber.activeForeground": codeForeground,
      "editorIndentGuide.background1": `${codeForeground}1f`,
      "editorIndentGuide.activeBackground1": `${accent}66`,
      "editorWidget.background": codeBackground,
      "editorWidget.border": hslToHex(tokens.panelBorder),
      "editorGutter.background": codeBackground,
      "scrollbarSlider.background": `${codeForeground}1f`,
      "scrollbarSlider.hoverBackground": `${codeForeground}33`,
    },
  };
}

/** Register (or refresh) the theme for a mode on a Monaco instance. */
export function registerMonacoTheme(
  monacoApi: typeof monaco,
  mode: ThemeMode,
): string {
  monacoApi.editor.defineTheme(MONACO_THEME_NAME, buildMonacoTheme(mode));
  return MONACO_THEME_NAME;
}
