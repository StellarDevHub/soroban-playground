/*
 * Markdown AST plugins for the interactive documentation renderer.
 *
 * This module provides a safe, deterministic markdown parser that supports custom
 * fenced blocks for live contract execution widgets:
 *
 *   ```live-query
 *   { "contractId": "CA...", "method": "balance", "args": [] }
 *   ```
 *
 *   ```live-simulate
 *   { "contractId": "CA...", "method": "transfer", "args": [] }
 *   ```
 *
 *   ```live-editor
 *   { "language": "rust", "code": "..." }
 *   ```
 *
 * The parser is pure and returns a structured abstract syntax tree. Rendering is
 * handled elsewhere (LiveInteractiveMarkdown.tsx), and the AST tree is designed to
 * be safe to render without injecting raw HTML.
 */

export type MarkdownInlineNode =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "strong"; children: MarkdownInlineNode[] }
  | { type: "em"; children: MarkdownInlineNode[] }
  | { type: "link"; href: string; children: MarkdownInlineNode[] }
  | { type: "codeSpan"; value: string };

export type LiveQueryBlock = {
  type: "liveQuery";
  contractId: string;
  method: string;
  args: unknown[];
  networkPassphrase?: string;
  label?: string;
  raw: string;
};

export type LiveSimulateBlock = {
  type: "liveSimulate";
  contractId: string;
  method: string;
  args: unknown[];
  networkPassphrase?: string;
  label?: string;
  raw: string;
};

export type LiveEditorBlock = {
  type: "liveEditor";
  language: string;
  code: string;
  contractId?: string;
  method?: string;
  label?: string;
  raw: string;
};

export type MarkdownBlockNode =
  | { type: "paragraph"; children: MarkdownInlineNode[] }
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; children: MarkdownInlineNode[] }
  | { type: "codeBlock"; language: string; value: string }
  | { type: "list"; ordered: boolean; items: MarkdownInlineNode[][] }
  | { type: "blockquote"; children: MarkdownBlockNode[] }
  | { type: "hr" }
  | LiveQueryBlock
  | LiveSimulateBlock
  | LiveEditorBlock;

export type MarkdownDocument = {
  type: "document";
  children: MarkdownBlockNode[];
};

const LIVE_BLOCK_TYPES = new Set(["live-query", "live-simulate", "live-editor"]);

function isSafeUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!/^[a-zA-z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    // Relative URLs and fragments only.
    return /^[^\s<>]+$/.test(trimmed);
  }
  const scheme = trimmed.slice(0, trimmed.indexOf(":")).toLowerCase();
  return scheme === "http" || scheme === "https" || scheme === "mailto";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function escapeHtmlInline(value: string): string {
  return escapeHtml(value);
}

function parseInline(text: string): MarkdownInlineNode[] {
  const nodes: MarkdownInlineNode[] = [];
  let i = 0;
  let buffer = "";

  const flush = () => {
    if (buffer.length > 0) {
      nodes.push({ type: "text", value: buffer });
      buffer = "";
    }
  };

  while (i < text.length) {
    const char = text[i];

    if (char === "`") {
      const end = text.indexOf("`", i + 1);
      if (end === -1) {
        buffer += char;
        i += 1;
        continue;
      }
      flush();
      nodes.push({ type: "codeSpan", value: text.slice(i + 1, end) });
      i = end + 1;
      continue;
    }

    if (char === "*" && text[i + 1] === "*") {
      const end = text.indexOf("**", i + 2);
      if (end !== -1) {
        flush();
        nodes.push({ type: "strong", children: parseInline(text.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }

    if (char === "_" && text[i + 1] === "_") {
      const end = text.indexOf("__", i + 2);
      if (end !== -1) {
        flush();
        nodes.push({ type: "strong", children: parseInline(text.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }

    if (char === "*") {
      const end = text.indexOf("*", i + 1);
      if (end !== -1) {
        flush();
        nodes.push({ type: "em", children: parseInline(text.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }

    if (char === "_") {
      const end = text.indexOf("_", i + 1);
      if (end !== -1) {
        flush();
        nodes.push({ type: "em", children: parseInline(text.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }

    if (char === "[") {
      const closeBracket = text.indexOf("]", i + 1);
      if (closeBracket !== -1 && text[closeBracket + 1] === "(") {
        const closeParen = text.indexOf(")", closeBracket + 2);
        if (closeParen !== -1) {
          const label = text.slice(i + 1, closeBracket);
          const href = text.slice(closeBracket + 2, closeParen).trim();
          flush();
          if (isSafeUrl(href)) {
            nodes.push({ type: "link", href, children: parseInline(label) });
          } else {
            nodes.push({ type: "text", value: label });
          }
          i = closeParen + 1;
          continue;
        }
      }
    }

    buffer += char;
    i += 1;
  }

  flush();
  return nodes;
}

function parseJsonBody(body: string): Record<string, unknown> {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    throw new Error("Live block requires a JSON body");
  }
  const parsed = JSON.parse(trimmed);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Live block body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Live block field "${field}" must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function parseArgs(value: unknown): unknown[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error('Live block field "args" must be an array');
  }
  return value;
}

export function parseLiveQueryBlock(body: string): LiveQueryBlock {
  const json = parseJsonBody(body);
  return {
    type: "liveQuery",
    contractId: requireString(json.contractId, "contractId"),
    method: requireString(json.method, "method"),
    args: parseArgs(json.args),
    networkPassphrase: optionalString(json.networkPassphrase),
    label: optionalString(json.label),
    raw: body,
  };
}

export function parseLiveSimulateBlock(body: string): LiveSimulateBlock {
  const json = parseJsonBody(body);
  return {
    type: "liveSimulate",
    contractId: requireString(json.contractId, "contractId"),
    method: requireString(json.method, "method"),
    args: parseArgs(json.args),
    networkPassphrase: optionalString(json.networkPassphrase),
    label: optionalString(json.label),
    raw: body,
  };
}

export function parseLiveEditorBlock(body: string): LiveEditorBlock {
  const json = parseJsonBody(body);
  const code = typeof json.code === "string" ? json.code : "";
  return {
    type: "liveEditor",
    language: optionalString(json.language) ?? "rust",
    code,
    contractId: optionalString(json.contractId),
    method: optionalString(json.method),
    label: optionalString(json.label),
    raw: body,
  };
}

function parseFencedLiveBlock(language: string, body: string): MarkdownBlockNode {
  switch (language) {
    case "live-query":
      return parseLiveQueryBlock(body);
    case "live-simulate":
      return parseLiveSimulateBlock(body);
    case "live-editor":
      return parseLiveEditorBlock(body);
    default:
      throw new Error(`Unsupported live block language "${language}"`);
  }
}

export function parseMarkdown(source: string): MarkdownDocument {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const children: MarkdownBlockNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().length === 0) {
      i += 1;
      continue;
    }

    const fenceMatch = /^```([A-Za-z0-9-]*)/.exec(line);
    if (fenceMatch) {
      const language = fenceMatch[1] || "";
      const bodyLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) {
        bodyLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) {
        i += 1;
      }
      const body = bodyLines.join("\n");
      if (LIVE_BLOCK_TYPES.has(language)) {
        children.push(parseFencedLiveBlock(language, body));
      } else {
        children.push({ type: "codeBlock", language, value: body });
      }
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      children.push({
        type: "heading",
        level,
        children: parseInline(headingMatch[2]),
      });
      i += 1;
      continue;
    }

    if (/^(?:-{3}|\*{3}|_{3})$/.test(line.trim())) {
      children.push({ type: "hr" });
      i += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }
      children.push({ type: "blockquote", children: parseMarkdown(quoteLines.join("\n")).children });
      continue;
    }

    const listMatch = /^(\s*)([-+\*]|\d+\.)\s+(.+)/.exec(line);
    if (listMatch) {
      const ordered = /^\d+\.$/.test(listMatch[2]);
      const items: MarkdownInlineNode[][] = [];
      while (i < lines.length) {
        const itemMatch = /^\s*([-+*]|\d+\.)\s+(.+)/.exec(lines[i]);
        if (!itemMatch) {
          break;
        }
        items.push(parseInline(itemMatch[2]));
        i += 1;
      }
      children.push({ type: "list", ordered, items });
      continue;
    }

    const paragraphLines: string[] = [line];
    i += 1;
    while (i < lines.length) {
      const nextLine = lines[i];
      if (
        nextLine.trim().length === 0 ||
        /^```/.test(nextLine) ||
        /^#{1,6}\s+/.test(nextLine) ||
        /^>\s?/.test(nextLine) ||
        /^\s*([-+*]|\d+\.)\s+/.test(nextLine)
      ) {
        break;
      }
      paragraphLines.push(nextLine);
      i += 1;
    }
    children.push({ type: "paragraph", children: parseInline(paragraphLines.join(" ")) });
  }

  return { type: "document", children };
}
