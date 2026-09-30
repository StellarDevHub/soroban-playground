export interface RustDiagnostic {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  severity: "error" | "warning" | "info";
  message: string;
}

interface OpenDelimiter {
  char: string;
  line: number;
  column: number;
}

const MATCHING_DELIMITERS: Record<string, string> = {
  "{": "}",
  "(": ")",
  "[": "]",
};

export function analyzeRustSyntax(code: string): RustDiagnostic[] {
  const diagnostics: RustDiagnostic[] = [];
  const openDelimiters: OpenDelimiter[] = [];
  const lines = code.split("\n");
  let blockCommentDepth = 0;
  let rawStringTerminator: string | null = null;

  lines.forEach((line, lineIndex) => {
    let inString = false;
    let escaped = false;

    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const next = line[index + 1];

      if (rawStringTerminator) {
        const terminatorIndex = line.indexOf(rawStringTerminator, index);
        if (terminatorIndex < 0) break;
        index = terminatorIndex + rawStringTerminator.length - 1;
        rawStringTerminator = null;
        continue;
      }

      if (blockCommentDepth > 0) {
        if (char === "/" && next === "*") {
          blockCommentDepth += 1;
          index += 1;
        } else if (char === "*" && next === "/") {
          blockCommentDepth -= 1;
          index += 1;
        }
        continue;
      }

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === "/" && next === "/") break;
      if (char === "/" && next === "*") {
        blockCommentDepth = 1;
        index += 1;
        continue;
      }
      const rawStringPrefix = line.slice(index).match(/^(?:b)?r(#{0,255})"/);
      if (rawStringPrefix) {
        rawStringTerminator = `"${rawStringPrefix[1]}`;
        index += rawStringPrefix[0].length - 1;
        continue;
      }
      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === "'" && isCharacterLiteral(line, index)) {
        index += characterLiteralLength(line, index) - 1;
        continue;
      }

      if (char in MATCHING_DELIMITERS) {
        openDelimiters.push({
          char,
          line: lineIndex + 1,
          column: index + 1,
        });
        continue;
      }

      if (char === "}" || char === ")" || char === "]") {
        const opener = openDelimiters[openDelimiters.length - 1];
        if (!opener || MATCHING_DELIMITERS[opener.char] !== char) {
          diagnostics.push({
            startLineNumber: lineIndex + 1,
            startColumn: index + 1,
            endLineNumber: lineIndex + 1,
            endColumn: index + 2,
            severity: "error",
            message: `Unmatched closing bracket '${char}'`,
          });
          if (opener) openDelimiters.pop();
        } else {
          openDelimiters.pop();
        }
      }
    }
  });

  for (const opener of openDelimiters) {
    diagnostics.push({
      startLineNumber: opener.line,
      startColumn: opener.column,
      endLineNumber: opener.line,
      endColumn: opener.column + 1,
      severity: "error",
      message: `Unclosed opening bracket '${opener.char}'`,
    });
  }

  return diagnostics;
}

function isCharacterLiteral(line: string, index: number): boolean {
  return characterLiteralLength(line, index) > 0;
}

function characterLiteralLength(line: string, index: number): number {
  const match = line.slice(index).match(/^'(?:\\.|[^'\\])'/);
  return match?.[0].length ?? 0;
}