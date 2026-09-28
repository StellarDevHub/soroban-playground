// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Dependency-free fuzzy matching engine backing the global command palette
 * (issue #1527).
 *
 * The matcher is a scored subsequence search: every query character must appear
 * in the candidate in order, but not necessarily adjacently. Scoring rewards
 * the shapes users expect from a "smart" search box — exact hits, prefixes,
 * word/camel-case boundaries and runs of consecutive characters — and lightly
 * penalises leading and interior gaps so `"ct"` ranks `Counter` above
 * `ContractTokenFactory`.
 *
 * No third-party fuzzy dependency is used so the palette stays tree-shakeable
 * and works identically in the browser, in Jest and inside a service worker.
 */

/** Score returned for a candidate that cannot match at all. */
export const NO_MATCH = Number.NEGATIVE_INFINITY;

const SCORE_EXACT = 1200;
const SCORE_PREFIX = 600;
const SCORE_BOUNDARY = 120;
const SCORE_CAMEL = 90;
const SCORE_CONSECUTIVE = 60;
const PENALTY_LEADING = 2;
const PENALTY_GAP = 6;
const PENALTY_MAX = 400;
const SCORE_MIN = 1;

export interface FuzzyMatch {
  /** Higher is better. Never negative for a successful match. */
  score: number;
  /**
   * Indices into the *original* haystack that the query characters matched.
   * Used to highlight the visible characters in the palette results.
   */
  indices: number[];
}

export interface HighlightSegment {
  text: string;
  match: boolean;
}

export interface RankedItem<T> {
  item: T;
  score: number;
  /** Highlight ranges for the primary (title) field. */
  indices: number[];
  /** Field that produced the best score — useful for debugging ranking. */
  field: string;
}

function isWordChar(char: string): boolean {
  return /[a-z0-9]/.test(char);
}

function isUpperCase(char: string): boolean {
  return char >= "A" && char <= "Z";
}

/**
 * Run the scored subsequence match.
 *
 * Returns `null` when `needle` is not a subsequence of `haystack` (after case
 * folding), so callers can treat a miss as "not a result" rather than score 0.
 */
export function fuzzyMatch(
  haystack: string,
  needle: string,
): FuzzyMatch | null {
  if (typeof haystack !== "string" || typeof needle !== "string") return null;
  if (needle.length === 0) return { score: SCORE_MIN, indices: [] };
  if (haystack.length === 0) return null;

  const hayLower = haystack.toLowerCase();
  const needleLower = needle.toLowerCase();
  if (needleLower.length > hayLower.length) return null;

  if (hayLower === needleLower) {
    return { score: SCORE_EXACT, indices: Array.from(hayLower, (_c, i) => i) };
  }

  const indices: number[] = [];
  let score = 0;
  let hayIndex = 0;
  let previousIndex = -1;
  let penalty = 0;

  for (let needleIndex = 0; needleIndex < needleLower.length; ) {
    const target = needleLower[needleIndex];
    let found = -1;

    while (hayIndex < hayLower.length) {
      if (hayLower[hayIndex] === target) {
        found = hayIndex;
        hayIndex += 1;
        break;
      }
      hayIndex += 1;
    }

    if (found === -1) return null;

    indices.push(found);

    if (found === 0) {
      score += SCORE_PREFIX;
    } else {
      const previous = haystack[found - 1];
      const current = haystack[found];
      // A word-boundary / camel bonus is only meaningful at the *start* of a
      // run. Without the gap guard, `"con"` scores `"c-o-n"` (prefix + two
      // boundary bonuses) above `"contract"` (prefix + two consecutive
      // bonuses), which inverts what a user expects. Skipping exactly one
      // character is treated as part of the same fuzzy run, so no boundary
      // credit is given; a jump of two or more means a genuinely new word.
      const gap = previousIndex < 0 ? found : found - previousIndex - 1;
      const startsRun = previousIndex < 0 || gap >= 2;
      if (startsRun && !isWordChar(previous)) {
        score += SCORE_BOUNDARY;
      } else if (startsRun && isUpperCase(previous) && !isUpperCase(current)) {
        score += SCORE_CAMEL;
      }
    }

    if (previousIndex >= 0) {
      if (found === previousIndex + 1) {
        score += SCORE_CONSECUTIVE;
      } else {
        penalty += Math.min(
          PENALTY_MAX,
          (found - previousIndex - 1) * PENALTY_GAP,
        );
      }
    } else {
      penalty += Math.min(PENALTY_MAX, found * PENALTY_LEADING);
    }

    previousIndex = found;
    needleIndex += 1;
  }

  // Shorter candidates are more relevant when scores are otherwise close.
  score -= Math.min(PENALTY_MAX, hayLower.length - needleLower.length);
  score -= penalty;

  return { score: Math.max(SCORE_MIN, score), indices };
}

/**
 * Split `text` into matched / unmatched runs so the UI can highlight without
 * doing regex bookkeeping. `indices` must be sorted ascending.
 */
export function highlightSegments(
  text: string,
  indices: readonly number[],
): HighlightSegment[] {
  if (text.length === 0) return [];
  if (indices.length === 0) return [{ text, match: false }];

  const matched = new Set(indices);
  const segments: HighlightSegment[] = [];
  let buffer = "";
  let bufferMatch = matched.has(0);

  for (let i = 0; i < text.length; i += 1) {
    const isMatch = matched.has(i);
    if (isMatch !== bufferMatch) {
      if (buffer) segments.push({ text: buffer, match: bufferMatch });
      buffer = "";
      bufferMatch = isMatch;
    }
    buffer += text[i];
  }

  if (buffer) segments.push({ text: buffer, match: bufferMatch });
  return segments;
}

export interface SearchField<T> {
  /** Field name, echoed back on {@link RankedItem.field}. */
  key: string;
  /** Weight multiplier; 1 by default, 0 disables the field. */
  weight?: number;
  /** Values to match against. String entries are matched, others are ignored. */
  get: (item: T) => Array<string | number | undefined | null>;
}

/**
 * Rank `items` against a whitespace-separated query. Every whitespace-separated
 * token must match at least one field, so `"tok fun"` behaves like an AND
 * filter while still tolerating typos and abbreviations.
 */
export function rankItems<T>(
  items: readonly T[],
  query: string,
  fields: readonly SearchField<T>[],
  options: { limit?: number } = {},
): Array<RankedItem<T>> {
  const tokens = query
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    const results = items.map((item) => ({ item, score: 0, indices: [], field: "" }));
    return typeof options.limit === "number"
      ? results.slice(0, options.limit)
      : results;
  }

  const results: Array<RankedItem<T>> = [];

  for (const item of items) {
    let total = 0;
    let bestField = "";
    let bestIndices: number[] = [];

    for (const token of tokens) {
      let tokenBest = NO_MATCH;
      let tokenField = "";
      let tokenIndices: number[] = [];

      for (const field of fields) {
        const weight = field.weight ?? 1;
        if (weight <= 0) continue;
        for (const raw of field.get(item)) {
          if (typeof raw === "number") continue;
          if (typeof raw !== "string" || raw.length === 0) continue;
          const match = fuzzyMatch(raw, token);
          if (!match) continue;
          const weighted = match.score * weight;
          if (weighted > tokenBest) {
            tokenBest = weighted;
            tokenField = field.key;
            tokenIndices = match.indices;
          }
        }
      }

      // AND semantics: a token that matches nothing removes the candidate.
      if (tokenBest === NO_MATCH) {
        total = NO_MATCH;
        break;
      }

      total += tokenBest;
      if (tokenBest > 0 && (bestIndices.length === 0 || tokenBest > total / 2)) {
        bestField = tokenField;
        bestIndices = tokenIndices;
      }
    }

    if (total === NO_MATCH) continue;
    results.push({ item, score: total, indices: bestIndices, field: bestField });
  }

  results.sort((a, b) => b.score - a.score);
  return typeof options.limit === "number"
    ? results.slice(0, options.limit)
    : results;
}

/**
 * Keep only the `limit` highest scores and drop anything scoring below
 * `threshold`. Used by the palette so a long index stays responsive.
 */
export function trimResults<T>(
  results: readonly RankedItem<T>[],
  limit: number,
  threshold: number,
): RankedItem<T>[] {
  return results.filter((result) => result.score >= threshold).slice(0, limit);
}
