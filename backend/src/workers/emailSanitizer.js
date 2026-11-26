// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

/**
 * HTML sanitization for the email worker (Issue #2008).
 *
 * Every outgoing HTML email is rendered from a template whose variables are
 * attacker-influenced (user names, contract metadata, compile diagnostics).
 * The worker is the last stop before the SMTP transport, so it is the correct
 * choke point: sanitizing here covers every template and every variable
 * instead of relying on each template author to escape correctly.
 *
 * DOMPurify alone is not enough for email. Its default policy keeps inline
 * `<style>` blocks and `url(...)` inside `style` attributes, both of which are
 * CSS-injection vectors (data exfiltration and UI redress in webmail clients),
 * so the policy below is stricter and fails closed.
 */

// Executable or remote-loading elements. DOMPurify removes most of these by
// default; listing them explicitly keeps the email policy independent of
// upstream default changes.
const FORBIDDEN_TAGS = [
  'script',
  'style',
  'link',
  'meta',
  'base',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'form',
  'input',
  'button',
  'select',
  'option',
  'textarea',
  'template',
  'noscript',
  'svg',
  'math',
];

// Attributes that load remote resources, submit data, or rebind URLs outside
// of the sanitized `href`/`src` path.
const FORBIDDEN_ATTRIBUTES = [
  'srcset',
  'ping',
  'formaction',
  'xlink:href',
  'xmlns',
  'background',
];

/**
 * CSS constructs that can exfiltrate data, load remote resources or execute
 * script in legacy clients. `\\` is rejected as well because CSS escapes
 * (`u\72l(`) are the standard way to smuggle the other patterns past a
 * substring check.
 */
const DANGEROUS_CSS_PATTERNS = [
  /url\s*\(/i,
  /expression\s*\(/i,
  /javascript\s*:/i,
  /vbscript\s*:/i,
  /behavior\s*:/i,
  /-moz-binding/i,
  /@import/i,
  /position\s*:\s*fixed/i,
  /\\/,
];

const SANITIZE_OPTIONS = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: FORBIDDEN_TAGS,
  FORBID_ATTR: FORBIDDEN_ATTRIBUTES,
  ALLOW_DATA_ATTR: false,
  KEEP_CONTENT: true,
};

/**
 * The DOM implementation is created once per worker process on first use, so
 * text-only emails do not pay the jsdom startup cost.
 */
let purifier = null;

/**
 * Detect a style value that must be dropped entirely. Style declarations are
 * not parsed; any value carrying a dangerous construct is rejected as a whole,
 * which is the only safe choice when the value is attacker-controlled.
 */
export function isDangerousStyleValue(value) {
  if (typeof value !== 'string') {
    return true;
  }

  // Strip CSS comments so `url(/*x*/...)` cannot hide a construct.
  const normalized = value.replace(/\/\*[\s\S]*?\*\//g, '');

  return DANGEROUS_CSS_PATTERNS.some((pattern) => pattern.test(normalized));
}

function getPurifier() {
  if (purifier) {
    return purifier;
  }

  purifier = createDOMPurify(new JSDOM('').window);

  purifier.addHook('uponSanitizeAttribute', (node, data) => {
    if (data.attrName === 'style' && isDangerousStyleValue(data.attrValue)) {
      data.keepAttr = false;
    }
  });

  return purifier;
}

/**
 * Sanitize an untrusted HTML email body.
 *
 * Returns an empty string for non-strings and for content that sanitized away
 * completely, so callers can treat "no safe HTML left" as "no HTML body".
 */
export function sanitizeEmailHtml(dirty) {
  if (typeof dirty !== 'string' || dirty.trim() === '') {
    return '';
  }

  return getPurifier().sanitize(dirty, SANITIZE_OPTIONS);
}
