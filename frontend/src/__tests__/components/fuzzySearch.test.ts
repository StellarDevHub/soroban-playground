/**
 * Fuzzy search engine (issue #1527).
 *
 * The palette is only as good as this scorer, so the ranking invariants are
 * pinned here: exact beats prefix beats mid-word, contiguous beats scattered,
 * every query token must match, and a secondary field can still produce a hit.
 */

import {
  NO_MATCH,
  fuzzyMatch,
  highlightSegments,
  rankItems,
  trimResults,
  type SearchField,
} from "@/lib/fuzzySearch";

interface Row {
  name: string;
  tags: string[];
}

const FIELDS: SearchField<Row>[] = [
  { key: "name", weight: 1, get: (row) => [row.name] },
  { key: "tags", weight: 0.5, get: (row) => row.tags },
];

const scoreOf = (haystack: string, needle: string) =>
  fuzzyMatch(haystack, needle)!.score;

describe("fuzzyMatch", () => {
  it("treats an empty query as a match with no highlighted characters", () => {
    const result = fuzzyMatch("Hello World", "");
    expect(result).toEqual({ score: expect.any(Number), indices: [] });
    expect(result!.score).toBeGreaterThan(0);
  });

  it("returns the whole string for an exact match", () => {
    const result = fuzzyMatch("playground", "playground");
    expect(result!.indices).toHaveLength("playground".length);
  });

  it("is case-insensitive", () => {
    expect(fuzzyMatch("Playground", "PLAYGROUND")).not.toBeNull();
  });

  it("scores an exact match above a prefix match", () => {
    expect(scoreOf("template", "template")).toBeGreaterThan(
      scoreOf("template-library", "template"),
    );
  });

  it("scores a prefix above a mid-word hit", () => {
    expect(scoreOf("template-library", "temp")).toBeGreaterThan(
      scoreOf("astemplate", "temp"),
    );
  });

  it("scores a contiguous run above a scattered one", () => {
    expect(scoreOf("contract", "con")).toBeGreaterThan(
      scoreOf("c-o-n", "con"),
    );
  });

  it("scores a word-boundary hit above an interior one", () => {
    // "ct" reaching into the second word of a phrase still gets boundary
    // credit, which an interior hit does not.
    expect(scoreOf("the contract", "ct")).toBeGreaterThan(
      scoreOf("unstable", "st"),
    );
  });

  it("ranks a prefix query above a later camel-case match", () => {
    expect(scoreOf("counter", "ct")).toBeGreaterThan(
      scoreOf("ContractTokenFactory", "ct"),
    );
  });

  it("rejects a query that is not a subsequence", () => {
    expect(fuzzyMatch("playground", "zzz")).toBeNull();
  });

  it("rejects a query longer than the candidate", () => {
    expect(fuzzyMatch("ab", "abcdef")).toBeNull();
  });

  it("never returns a non-positive score for a match", () => {
    // A long, gappy hit: the penalties have to eat most of the score without
    // taking it to or below zero, or the palette would drop real results.
    const result = fuzzyMatch(
      "accounting-consolidation-engine-and-reporting-suite",
      "acre",
    );
    expect(result!.score).toBeGreaterThan(0);
  });
});

describe("highlightSegments", () => {
  it("marks exactly the matched indices", () => {
    expect(highlightSegments("Playground", [0, 4])).toEqual([
      { text: "P", match: true },
      { text: "lay", match: false },
      { text: "g", match: true },
      { text: "round", match: false },
    ]);
  });

  it("returns a single unmatched run for an empty index list", () => {
    expect(highlightSegments("abc", [])).toEqual([
      { text: "abc", match: false },
    ]);
  });

  it("ignores out-of-range indices rather than throwing", () => {
    expect(highlightSegments("ab", [0, 99])).toEqual([
      { text: "a", match: true },
      { text: "b", match: false },
    ]);
  });

  it("returns nothing for empty text", () => {
    expect(highlightSegments("", [0])).toEqual([]);
  });

  it("round-trips the indices produced by the matcher", () => {
    const { indices } = fuzzyMatch("Hello World", "hw")!;
    const matched = highlightSegments("Hello World", indices)
      .filter((segment) => segment.match)
      .map((segment) => segment.text)
      .join("");
    expect(matched).toBe("HW");
  });
});

describe("rankItems", () => {
  const rows: Row[] = [
    { name: "Hello World", tags: ["example", "greeting"] },
    { name: "Hello There", tags: ["example"] },
    { name: "Goodbye", tags: ["world"] },
  ];

  it("lists everything, unscored, for an empty query", () => {
    const results = rankItems(rows, "   ", FIELDS);
    expect(results).toHaveLength(rows.length);
    expect(results.every((r) => r.score === 0)).toBe(true);
  });

  it("honours the limit for an empty query", () => {
    expect(rankItems(rows, "", FIELDS, { limit: 2 })).toHaveLength(2);
  });

  it("matches across a secondary field", () => {
    const results = rankItems(rows, "greeting", FIELDS);
    expect(results).toHaveLength(1);
    expect(results[0].item.name).toBe("Hello World");
    expect(results[0].field).toBe("tags");
  });

  it("ranks the best primary-field match first", () => {
    const results = rankItems(rows, "hello", FIELDS);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].item.name).toBe("Hello World");
    expect(results[0].score).toBeGreaterThanOrEqual(
      results[results.length - 1].score,
    );
  });

  it("excludes rows that do not match at all", () => {
    const results = rankItems(rows, "hello", FIELDS);
    expect(results.map((r) => r.item.name)).not.toContain("Goodbye");
  });

  it("requires every whitespace-separated token to match (AND)", () => {
    // "world" is row 1's title and "greeting" is only its tag, so the
    // intersection is exactly one row.
    expect(rankItems(rows, "world greeting", FIELDS)).toHaveLength(1);
    expect(rankItems(rows, "world nonexistenttoken", FIELDS)).toEqual([]);
  });

  it("lets tokens match different fields", () => {
    const results = rankItems(rows, "hello greeting", FIELDS);
    expect(results).toHaveLength(1);
    expect(results[0].item.name).toBe("Hello World");
  });

  it("skips fields with a non-positive weight", () => {
    const nameOnly: SearchField<Row>[] = [
      { key: "name", weight: 1, get: (row) => [row.name] },
      { key: "tags", weight: 0, get: (row) => row.tags },
    ];
    expect(rankItems(rows, "greeting", nameOnly)).toEqual([]);
  });

  it("caps results with the limit option", () => {
    expect(rankItems(rows, "hello", FIELDS, { limit: 1 })).toHaveLength(1);
  });
});

describe("trimResults", () => {
  it("keeps the highest scores and drops anything under the threshold", () => {
    const results: ReturnType<typeof rankItems<Row>> = [
      { item: { name: "a", tags: [] }, score: 100, indices: [], field: "name" },
      { item: { name: "b", tags: [] }, score: 5, indices: [], field: "name" },
    ];
    const trimmed = trimResults(results, 10, 50);
    expect(trimmed).toHaveLength(1);
    expect(trimmed[0].item.name).toBe("a");
  });

  it("caps the list length", () => {
    const many: ReturnType<typeof rankItems<Row>> = Array.from(
      { length: 50 },
      (_v, i) => ({
        item: { name: `row ${i}`, tags: [] },
        score: 100 - i,
        indices: [],
        field: "name",
      }),
    );
    expect(trimResults(many, 10, NO_MATCH)).toHaveLength(10);
  });
});
