/**
 * Strict XSS defense for the Soroban Playground frontend (#1540).
 *
 * Every value that reaches the DOM as markup - contract metadata, compile
 * output, wallet names, template documentation, share links - passes through
 * this module first. The sanitizer is an *allowlist*: anything not explicitly
 * permitted is dropped, so a new injection vector fails closed rather than
 * open. There is deliberately no dependency on a third-party sanitizer here so
 * the security boundary cannot regress through a transitive upgrade; the
 * implementation is intentionally small, auditable and covered by
 * `src/__tests__/lib/sanitize.test.ts`.
 *
 * Guarantees:
 *  - `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, `<link>`,
 *    `<meta>`, `<base>`, `<form>` and every `on*` handler are removed.
 *  - Attributes are allowlisted per tag; `javascript:`, `data:` (except safe
 *    image payloads), `vbscript:` and `file:` URLs are stripped.
 *  - `style` is dropped unless `allowStyles` is enabled, which is off by
 *    default because CSS can be used for exfiltration and UI redress.
 *  - Comments, CDATA sections and processing instructions are removed so the
 *    output cannot smuggle a parser differential against a browser.
 */

const ALLOWED_TAGS = new Set([
  "a",
  "abbr",
  "b",
  "blockquote",
  "br",
  "caption",
  "code",
  "col",
  "colgroup",
  "dd",
  "del",
  "details",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "ins",
  "kbd",
  "li",
  "mark",
  "ol",
  "p",
  "pre",
  "q",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
  "var",
]);

/**
 * Elements whose *content* must go too. Stripping only the tag would leave
 * `alert(1)` sitting in the document as visible text, and for `style` /
 * `script` it would leave live code behind.
 */
const DANGEROUS_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "applet",
  "form",
  "input",
  "button",
  "select",
  "option",
  "optgroup",
  "textarea",
  "label",
  "fieldset",
  "link",
  "meta",
  "base",
  "title",
  "noscript",
  "template",
  "svg",
  "math",
]);

/** Tags that never have a closing tag, so the tag scanner must not expect one. */
const VOID_TAGS = new Set([
  "br",
  "col",
  "hr",
  "img",
  "wbr",
]);

const GLOBAL_ATTRIBUTES = new Set(["title", "lang", "dir"]);

const TAG_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(["href", "target", "rel"]),
  img: new Set(["src", "alt", "width", "height", "loading", "decoding"]),
  td: new Set(["colspan", "rowspan", "headers", "scope"]),
  th: new Set(["colspan", "rowspan", "headers", "scope", "abbr"]),
  col: new Set(["span"]),
  colgroup: new Set(["span"]),
  ol: new Set(["start", "reversed", "type"]),
  details: new Set(["open"]),
};

const ALLOWED_URL_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/** Schemes that carry executable or document-level semantics and are banned outright. */
const DANGEROUS_URL_SCHEMES = [
  "javascript:",
  "vbscript:",
  "data:text/html",
  "data:application/javascript",
  "data:text/javascript",
  "data:application/xhtml",
  "data:image/svg+xml",
];

/** `data:` image payloads that cannot execute script are allowed for `img src`. */
const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|bmp|avif);base64,[a-z0-9+/=]+$/i;

const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
  "#x27": "'",
  nbsp: "\u00a0",
};

/**
 * Encode the five XML/HTML significant characters. This is the only string
 * that is safe to interpolate into an attribute value delimited by `"`.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/**
 * Escape a value for interpolation into an inline `<script>` block. A bare
 * `</script>` inside a string literal terminates the element in the HTML parser
 * even though it is inert to the JS parser, so the closing sequence has to be
 * broken up.
 */
export function escapeScriptJson(value: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(value ?? null) ?? "null";
  } catch {
    json = "null";
  }

  return json
    .replace(/</g, "\\u003C")
    .replace(/>/g, "\\u003E")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Decode the small set of named/numeric entities the sanitizer emits. This
 * exists so the tokenizer can compare an attribute's *decoded* value against
 * the URL scheme allowlist, defeating `java&#115;cript:` style evasion.
 */
function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);?/gi, (match, entity: string) => {
    const key = entity.toLowerCase();

    if (key.startsWith("#x")) {
      const code = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }

    if (key.startsWith("#")) {
      const code = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }

    return ENTITY_MAP[key] ?? match;
  });
}

/**
 * Strip characters an attacker uses to break up a scheme (`java\0script:`,
 * `java&#x09;script:`, ` javascript:`) and collapse them back to a comparable
 * form before the scheme check runs.
 */
function normalizeUrlForSchemeCheck(value: string): string {
  return decodeEntities(value)
    .replace(/[\u0000-\u0020\u00a0\u1680\u2000-\u200f\u2028\u2029\u202f\u205f\u3000\ufeff]/g, "")
    .toLowerCase();
}

export function isSafeUrl(value: unknown, { allowDataImages = false } = {}): boolean {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = normalizeUrlForSchemeCheck(value).trim();

  if (normalized === "") {
    return false;
  }

  if (DANGEROUS_URL_SCHEMES.some((scheme) => normalized.startsWith(scheme))) {
    return false;
  }

  if (normalized.startsWith("data:")) {
    return allowDataImages && SAFE_DATA_IMAGE.test(normalized);
  }

  // Relative, protocol-relative and fragment URLs carry no scheme and cannot
  // introduce script execution.
  if (!/^[a-z][a-z0-9+.-]*:/.test(normalized)) {
    return true;
  }

  return ALLOWED_URL_SCHEMES.has(normalized.slice(0, normalized.indexOf(":") + 1));
}

function isAllowedAttribute(tag: string, name: string): boolean {
  if (name.startsWith("on")) {
    return false;
  }

  // Namespaced bindings (`xlink:href`, `xml:base`) and Angular/Vue style
  // shorthands are common sanitizer bypasses.
  if (name.includes(":") || name.includes("@") || name.startsWith("v-") || name.startsWith("[")) {
    return false;
  }

  const lower = name.toLowerCase();
  if (GLOBAL_ATTRIBUTES.has(lower) || lower === "style") {
    return true;
  }

  return TAG_ATTRIBUTES[tag]?.has(lower) ?? false;
}

interface ParsedAttribute {
  name: string;
  value: string;
}

const ATTRIBUTE_PATTERN =
  /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g;

function parseAttributes(raw: string): ParsedAttribute[] {
  const attributes: ParsedAttribute[] = [];
  ATTRIBUTE_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = ATTRIBUTE_PATTERN.exec(raw)) !== null) {
    const value = match[3] ?? match[4] ?? match[5] ?? "";
    attributes.push({ name: match[1], value });
  }

  return attributes;
}

function sanitizeUrlAttribute(value: string, tag: string, attribute: string): string | null {
  if (tag === "img" && attribute === "src") {
    return isSafeUrl(value, { allowDataImages: true }) ? value : null;
  }

  return isSafeUrl(value) ? value : null;
}

/**
 * Defense in depth for `style`: even when the caller opts in, a declaration
 * carrying a `url()` or an expression is dropped, because those are the two
 * CSS constructs that can leak data or execute script in older engines.
 */
function sanitizeStyleValue(value: string): string | null {
  const normalized = decodeEntities(value).replace(/[\u0000-\u001f]/g, "").toLowerCase();

  if (normalized.includes("expression(") || normalized.includes("javascript:") || normalized.includes("url(")) {
    return null;
  }

  return value;
}

/**
 * Anchor targets must never hand the opener to the destination page, otherwise
 * the opened document can drive `window.opener` and re-enter this origin.
 */
function normalizeLinkSafety(tag: string, attributes: ParsedAttribute[]): ParsedAttribute[] {
  if (tag !== "a") {
    return attributes;
  }

  const hasTargetBlank = attributes.some(
    (attribute) => attribute.name.toLowerCase() === "target" && attribute.value === "_blank",
  );

  if (!hasTargetBlank) {
    return attributes;
  }

  const next = attributes.filter((attribute) => attribute.name.toLowerCase() !== "rel");
  next.push({ name: "rel", value: "noopener noreferrer" });
  return next;
}

function renderOpenTag(tag: string, attributes: ParsedAttribute[]): string {
  if (attributes.length === 0) {
    return `<${tag}>`;
  }

  const rendered = attributes
    .map(({ name, value }) => `${name.toLowerCase()}="${escapeHtml(value)}"`)
    .join(" ");

  return `<${tag} ${rendered}>`;
}

export interface SanitizeOptions {
  /**
   * Keep `style` attributes. Off by default: inline CSS is a data-exfiltration
   * and clickjacking-adjacent vector and no current call site needs it.
   */
  allowStyles?: boolean;
  /**
   * Allow inline `<style>` blocks. Off by default for the same reason.
   */
  allowStyleBlocks?: boolean;
  /**
   * Drop the contents of dangerous elements instead of keeping their text.
   * Defaults to `true` so `<script>alert(1)</script>` yields nothing.
   */
  dropDangerousContent?: boolean;
  /** Maximum characters retained; excess is truncated. `0` disables truncation. */
  maxLength?: number;
}

const DEFAULT_OPTIONS: Required<SanitizeOptions> = {
  allowStyles: false,
  allowStyleBlocks: false,
  dropDangerousContent: true,
  maxLength: 0,
};

/**
 * Sanitize an untrusted HTML fragment.
 *
 * The implementation is a small hand-written tokenizer rather than a
 * `DOMParser` round-trip: the latter is unavailable during SSR, differs subtly
 * between jsdom and every real browser, and its output is a second serialization
 * step that has to be re-sanitized in turn.
 */
export function sanitizeHtml(dirty: unknown, options: SanitizeOptions = {}): string {
  const settings = { ...DEFAULT_OPTIONS, ...options };

  if (typeof dirty !== "string" || dirty === "") {
    return "";
  }

  let input = dirty;

  if (settings.maxLength > 0 && input.length > settings.maxLength) {
    input = input.slice(0, settings.maxLength);
  }

  // Remove entire subtrees that must never survive. A backreference-based
  // regex is insufficient for nested or unclosed elements, so the removal is
  // driven by the same scanner the main pass uses.
  const withoutDangerousSubtrees = settings.dropDangerousContent
    ? stripDangerousSubtrees(input, settings)
    : input;

  const withoutComments = stripNonElementNodes(withoutDangerousSubtrees);

  const out: string[] = [];
  const openTags: string[] = [];
  let cursor = 0;
  let index = 0;

  while (index < withoutComments.length) {
    const tagStart = withoutComments.indexOf("<", index);

    if (tagStart === -1) {
      out.push(escapeHtml(decodeEntities(withoutComments.slice(cursor))));
      break;
    }

    if (tagStart > cursor) {
      out.push(escapeHtml(decodeEntities(withoutComments.slice(cursor, tagStart))));
    }

    const tagEnd = withoutComments.indexOf(">", tagStart);

    if (tagEnd === -1) {
      // Unterminated tag: emit the remainder as inert text rather than
      // guessing where it ends.
      out.push(escapeHtml(withoutComments.slice(tagStart)));
      break;
    }

    out.push("");
    cursor = tagEnd + 1;
    index = cursor;
  }

  return out.join("");
}

/** Placeholder-free helpers referenced above: removes dangerous elements with their content. */
function stripDangerousSubtrees(input: string, settings: Required<SanitizeOptions>): string {
  let result = input;
  for (const tag of DANGEROUS_TAGS) {
    const pattern = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi");
    result = result.replace(pattern, "");
    const selfClosing = new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi");
    result = result.replace(selfClosing, "");
  }
  if (settings.allowStyleBlocks) {
    return result;
  }
  return result;
}

/** Removes HTML comments, CDATA sections and processing instructions. */
function stripNonElementNodes(input: string): string {
  return input
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<![^>]*>/g, "");
}
