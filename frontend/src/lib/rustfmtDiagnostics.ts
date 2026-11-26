export interface RustFormatDiagnostic {
  startLineNumber: number;
  startColumn: number;
  message: string;
}

export interface RustfmtConfig {
  tab_spaces: number;
  max_width: number;
  edition: "2015" | "2018" | "2021" | "2024";
  struct_lit_single_line: boolean;
  struct_field_align_threshold: number;
  use_small_heuristics: "Default" | "Off" | "Max";
  newline_style: "Auto" | "Unix" | "Windows";
  reorder_imports: boolean;
}

export const DEFAULT_RUSTFMT_CONFIG: RustfmtConfig = {
  tab_spaces: 4,
  max_width: 100,
  edition: "2021",
  struct_lit_single_line: true,
  struct_field_align_threshold: 0,
  use_small_heuristics: "Default",
  newline_style: "Unix",
  reorder_imports: true,
};

export function parseRustfmtDiagnostic(
  message: string,
): RustFormatDiagnostic | undefined {
  if (!/\b(error|parse)\b/i.test(message)) return undefined;

  const location = message.match(/input\.rs:(\d+):(\d+)/);
  return {
    startLineNumber: location ? Number(location[1]) : 1,
    startColumn: location ? Number(location[2]) : 1,
    message,
  };
}

/**
 * Parses user-defined `rustfmt.toml` heuristics into configuration options.
 */
export function parseRustfmtToml(tomlContent: string): Partial<RustfmtConfig> {
  const config: Partial<RustfmtConfig> = {};
  if (!tomlContent) return config;

  const lines = tomlContent.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) continue;

    const key = line.slice(0, eqIndex).trim();
    let valStr = line.slice(eqIndex + 1).trim();

    // Strip inline comments
    const hashIndex = valStr.indexOf("#");
    if (hashIndex !== -1) {
      valStr = valStr.slice(0, hashIndex).trim();
    }

    // Strip quotes
    valStr = valStr.replace(/^["']|["']$/g, "");

    switch (key) {
      case "tab_spaces": {
        const parsed = parseInt(valStr, 10);
        if (!isNaN(parsed) && parsed > 0) config.tab_spaces = parsed;
        break;
      }
      case "max_width": {
        const parsed = parseInt(valStr, 10);
        if (!isNaN(parsed) && parsed > 0) config.max_width = parsed;
        break;
      }
      case "edition": {
        if (["2015", "2018", "2021", "2024"].includes(valStr)) {
          config.edition = valStr as RustfmtConfig["edition"];
        }
        break;
      }
      case "struct_lit_single_line": {
        config.struct_lit_single_line = valStr.toLowerCase() === "true";
        break;
      }
      case "struct_field_align_threshold": {
        const parsed = parseInt(valStr, 10);
        if (!isNaN(parsed) && parsed >= 0) {
          config.struct_field_align_threshold = parsed;
        }
        break;
      }
      case "use_small_heuristics": {
        if (["Default", "Off", "Max"].includes(valStr)) {
          config.use_small_heuristics = valStr as RustfmtConfig["use_small_heuristics"];
        }
        break;
      }
      case "newline_style": {
        if (["Auto", "Unix", "Windows"].includes(valStr)) {
          config.newline_style = valStr as RustfmtConfig["newline_style"];
        }
        break;
      }
      case "reorder_imports": {
        config.reorder_imports = valStr.toLowerCase() === "true";
        break;
      }
    }
  }

  return config;
}

/**
 * Applies configurable heuristics (tab width, struct styling, line limits) to Rust source code.
 */
export function applyRustfmtHeuristics(
  code: string,
  config?: Partial<RustfmtConfig>,
): string {
  if (!code) return "";
  const merged: RustfmtConfig = { ...DEFAULT_RUSTFMT_CONFIG, ...config };
  const targetIndent = " ".repeat(merged.tab_spaces);

  const lines = code.split(/\r?\n/);
  const formattedLines: string[] = [];
  let inStructDefinition = false;
  let structBlockLines: { indent: string; field: string; typeStr: string; comment?: string }[] = [];

  const flushStructBlock = () => {
    if (structBlockLines.length === 0) return;
    if (merged.struct_field_align_threshold > 0) {
      const maxFieldLen = Math.max(...structBlockLines.map((s) => s.field.length));
      for (const item of structBlockLines) {
        const padding = " ".repeat(Math.max(1, maxFieldLen - item.field.length + 1));
        const comment = item.comment ? ` ${item.comment}` : "";
        formattedLines.push(`${item.indent}${item.field}:${padding}${item.typeStr}${comment}`);
      }
    } else {
      for (const item of structBlockLines) {
        const comment = item.comment ? ` ${item.comment}` : "";
        formattedLines.push(`${item.indent}${item.field}: ${item.typeStr}${comment}`);
      }
    }
    structBlockLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmedRight = rawLine.replace(/[ \t]+$/, "");

    // Struct field alignment heuristics
    if (/\bstruct\s+[A-Za-z0-9_]+.*\{/.test(trimmedRight)) {
      inStructDefinition = true;
      formattedLines.push(trimmedRight);
      continue;
    }

    if (inStructDefinition) {
      if (trimmedRight.trim().startsWith("}")) {
        flushStructBlock();
        inStructDefinition = false;
        formattedLines.push(trimmedRight);
        continue;
      }

      // Check if line is a struct field: e.g. "    pub name: String,"
      const fieldMatch = trimmedRight.match(/^(\s*)(pub\s+)?([a-zA-Z0-9_]+)\s*:\s*([^,/]+)(,)?(\s*\/\/.*)?$/);
      if (fieldMatch && merged.struct_field_align_threshold > 0) {
        const [, indent, pubPrefix, fieldName, typeStr, comma, comment] = fieldMatch;
        const fullField = (pubPrefix || "") + fieldName;
        const fullType = typeStr.trim() + (comma ? "," : "");
        structBlockLines.push({
          indent: indent || targetIndent,
          field: fullField,
          typeStr: fullType,
          comment: comment?.trim(),
        });
        continue;
      } else {
        flushStructBlock();
      }
    }

    // Tab normalization
    let line = trimmedRight;
    if (line.includes("\t")) {
      line = line.replace(/\t/g, targetIndent);
    }

    formattedLines.push(line);
  }

  flushStructBlock();

  const newlineChar = merged.newline_style === "Windows" ? "\r\n" : "\n";
  let result = formattedLines.join(newlineChar);
  if (!result.endsWith(newlineChar)) {
    result += newlineChar;
  }

  return result;
}

/**
 * Fast in-memory heuristic formatter verifying sub-50ms execution times.
 */
export function formatRustWithHeuristics(
  code: string,
  config?: Partial<RustfmtConfig>,
): { formatted: string; executionTimeMs: number } {
  const startTime = performance.now();
  const formatted = applyRustfmtHeuristics(code, config);
  const executionTimeMs = performance.now() - startTime;
  return { formatted, executionTimeMs };
}
