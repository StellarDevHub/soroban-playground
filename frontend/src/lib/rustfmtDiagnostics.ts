export interface RustFormatDiagnostic {
  startLineNumber: number;
  startColumn: number;
  message: string;
}

export interface RustfmtConfig {
  /** Number of spaces per tab (default: 4) */
  tabSpaces?: number;
  /** Maximum line width (default: 100) */
  maxWidth?: number;
  /** Indent with hard tabs instead of spaces (default: false) */
  hardTabs?: boolean;
  /** Line ending style (default: "Auto") */
  newlineStyle?: "Auto" | "Windows" | "Unix" | "Native";
  /** Rust edition (default: "2021") */
  edition?: "2015" | "2018" | "2021" | "2024";
  /** Style edition */
  styleEdition?: "2015" | "2018" | "2021" | "2024";
  /** Struct literal single-line formatting */
  structLitSingleLine?: boolean;
  /** Alignment threshold for struct fields */
  structFieldAlignThreshold?: number;
  /** Reorder use statements */
  reorderImports?: boolean;
  /** Reorder module declarations */
  reorderModules?: boolean;
  /** Remove nested parentheses */
  removeNestedParens?: boolean;
  /** Format string literals that exceed maxWidth */
  formatStrings?: boolean;
  /** Additional raw configuration options */
  config?: Record<string, string | number | boolean>;
}

export const DEFAULT_RUSTFMT_CONFIG: RustfmtConfig = {
  tabSpaces: 4,
  maxWidth: 100,
  hardTabs: false,
  newlineStyle: "Auto",
  edition: "2021",
};

export type RustFormatResult =
  | { formatted: string; durationMs?: number }
  | { diagnostics: RustFormatDiagnostic[]; durationMs?: number };

export type RustFormatFn = (code: string, options?: any) => Promise<string>;

let customFormatter: RustFormatFn | undefined;

export function setCustomFormatter(fn: RustFormatFn | undefined): void {
  customFormatter = fn;
}

/**
 * Parses compiler/formatter error messages to extract Monaco-compatible diagnostics.
 */
export function parseRustfmtDiagnostic(
  message: string,
): RustFormatDiagnostic | undefined {
  if (!/\b(error|parse)\b/i.test(message)) return undefined;

  const location = message.match(
    /(?:input\.rs|<stdin>|lib\.rs|[\w.-]+\.rs):(\d+):(\d+)/i,
  );
  return {
    startLineNumber: location ? Number(location[1]) : 1,
    startColumn: location ? Number(location[2]) : 1,
    message,
  };
}

/**
 * Extracts multiple diagnostics from rustfmt stderr output.
 */
export function parseRustfmtDiagnostics(
  stderr: string,
): RustFormatDiagnostic[] {
  const diagnostic = parseRustfmtDiagnostic(stderr);
  return diagnostic ? [diagnostic] : [];
}

/**
 * Parses user-supplied `rustfmt.toml` contents into a typed `RustfmtConfig`.
 * Supports key heuristics: tab width, max width, struct styling, newline formatting, etc.
 */
export function parseRustfmtToml(tomlContent: string): RustfmtConfig {
  const result: RustfmtConfig = {
    config: {},
  };

  const lines = tomlContent.split(/\r?\n/);
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Handle comments outside of quoted strings
    let line = trimmed;
    const commentIndex = line.indexOf("#");
    if (commentIndex >= 0) {
      const firstQuote = line.indexOf('"');
      const lastQuote = line.lastIndexOf('"');
      if (
        firstQuote === -1 ||
        commentIndex < firstQuote ||
        commentIndex > lastQuote
      ) {
        line = line.slice(0, commentIndex).trim();
      }
    }
    if (!line) continue;

    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) continue;

    const key = line.slice(0, eqIndex).trim();
    const valStr = line.slice(eqIndex + 1).trim();

    // Parse scalar values: strings, booleans, integers, floats
    let val: string | number | boolean = valStr;
    if (
      (valStr.startsWith('"') && valStr.endsWith('"')) ||
      (valStr.startsWith("'") && valStr.endsWith("'"))
    ) {
      val = valStr.slice(1, -1);
    } else if (valStr === "true") {
      val = true;
    } else if (valStr === "false") {
      val = false;
    } else if (/^-?\d+$/.test(valStr)) {
      val = parseInt(valStr, 10);
    } else if (/^-?\d+\.\d+$/.test(valStr)) {
      val = parseFloat(valStr);
    }

    const normalizedKey = key.toLowerCase().replace(/[-_]/g, "");

    switch (normalizedKey) {
      case "tabspaces":
      case "tabwidth":
        result.tabSpaces = Number(val);
        break;
      case "maxwidth":
        result.maxWidth = Number(val);
        break;
      case "newlinestyle":
        if (
          val === "Auto" ||
          val === "Windows" ||
          val === "Unix" ||
          val === "Native"
        ) {
          result.newlineStyle = val;
        }
        break;
      case "hardtabs":
        result.hardTabs = Boolean(val);
        break;
      case "edition":
        if (
          val === "2015" ||
          val === "2018" ||
          val === "2021" ||
          val === "2024"
        ) {
          result.edition = val;
        }
        break;
      case "styleedition":
        if (
          val === "2015" ||
          val === "2018" ||
          val === "2021" ||
          val === "2024"
        ) {
          result.styleEdition = val;
        }
        break;
      case "structlitsingleline":
        result.structLitSingleLine = Boolean(val);
        if (result.config) result.config.struct_lit_single_line = Boolean(val);
        break;
      case "structfieldalignthreshold":
        result.structFieldAlignThreshold = Number(val);
        if (result.config)
          result.config.struct_field_align_threshold = Number(val);
        break;
      case "reorderimports":
        result.reorderImports = Boolean(val);
        break;
      case "reordermodules":
        result.reorderModules = Boolean(val);
        break;
      case "removenestedparens":
        result.removeNestedParens = Boolean(val);
        break;
      case "formatstrings":
        result.formatStrings = Boolean(val);
        break;
      default:
        if (result.config) {
          result.config[key] = val;
        }
        break;
    }
  }

  return result;
}

/**
 * Resolves configuration heuristics into options accepted by `@scalar/rust-fmt`.
 */
export function resolveRustfmtOptions(
  config?: RustfmtConfig | string | null,
): {
  edition?: "2015" | "2018" | "2021" | "2024";
  styleEdition?: "2015" | "2018" | "2021" | "2024";
  tabSpaces?: number;
  maxWidth?: number;
  hardTabs?: boolean;
  newlineStyle?: "Auto" | "Windows" | "Unix" | "Native";
  reorderImports?: boolean;
  reorderModules?: boolean;
  removeNestedParens?: boolean;
  formatStrings?: boolean;
  config?: Record<string, string | number | boolean>;
} {
  const parsed =
    typeof config === "string" ? parseRustfmtToml(config) : config ?? {};

  const extraConfig: Record<string, string | number | boolean> = {
    ...(parsed.config ?? {}),
  };

  if (typeof parsed.structLitSingleLine === "boolean") {
    extraConfig.struct_lit_single_line = parsed.structLitSingleLine;
  }
  if (typeof parsed.structFieldAlignThreshold === "number") {
    extraConfig.struct_field_align_threshold = parsed.structFieldAlignThreshold;
  }

  return {
    edition: parsed.edition ?? "2021",
    ...(parsed.styleEdition ? { styleEdition: parsed.styleEdition } : {}),
    ...(typeof parsed.tabSpaces === "number"
      ? { tabSpaces: parsed.tabSpaces }
      : { tabSpaces: 4 }),
    ...(typeof parsed.maxWidth === "number"
      ? { maxWidth: parsed.maxWidth }
      : { maxWidth: 100 }),
    ...(typeof parsed.hardTabs === "boolean"
      ? { hardTabs: parsed.hardTabs }
      : {}),
    ...(parsed.newlineStyle
      ? { newlineStyle: parsed.newlineStyle }
      : { newlineStyle: "Auto" }),
    ...(typeof parsed.reorderImports === "boolean"
      ? { reorderImports: parsed.reorderImports }
      : {}),
    ...(typeof parsed.reorderModules === "boolean"
      ? { reorderModules: parsed.reorderModules }
      : {}),
    ...(typeof parsed.removeNestedParens === "boolean"
      ? { removeNestedParens: parsed.removeNestedParens }
      : {}),
    ...(typeof parsed.formatStrings === "boolean"
      ? { formatStrings: parsed.formatStrings }
      : {}),
    ...(Object.keys(extraConfig).length > 0 ? { config: extraConfig } : {}),
  };
}

/**
 * Executes formatting with the specified heuristics and records execution duration.
 */
export async function formatRustCode(
  code: string,
  config?: RustfmtConfig | string,
  customFormatFn?: RustFormatFn,
): Promise<RustFormatResult> {
  const startTime = performance.now();
  const options = resolveRustfmtOptions(config);

  try {
    let fmt = customFormatFn ?? customFormatter;
    if (!fmt) {
      const scalar = await import("@scalar/rust-fmt");
      fmt = scalar.format;
    }
    const formatted = await fmt(code, options as any);
    const durationMs = performance.now() - startTime;
    return { formatted, durationMs };
  } catch (error) {
    const durationMs = performance.now() - startTime;
    const message = error instanceof Error ? error.message : String(error);
    const diagnostic = parseRustfmtDiagnostic(message);
    if (diagnostic) {
      return { diagnostics: [diagnostic], durationMs };
    }
    throw error;
  }
}
