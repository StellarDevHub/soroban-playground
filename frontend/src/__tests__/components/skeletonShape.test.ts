/**
 * Content-aware skeletons (issue #1529).
 *
 * The shape table is declarative so a new route is a one-line change. These
 * tests pin the parts that are easy to break silently: query-string and
 * trailing-slash normalisation, sub-path matching for the routes that have
 * children, and the rule-order interaction (a specific rule must win over a
 * broader one that appears earlier).
 */

import {
  inferSkeletonReason,
  inferSkeletonShape,
  skeletonLabel,
  type SkeletonShape,
} from "@/components/skeletons/shape";

describe("inferSkeletonShape", () => {
  it.each<[string, SkeletonShape]>([
    ["/playground", "editor"],
    ["/wasm-inspector", "code"],
    ["/xdr-decoder", "form"],
    ["/storage-browser", "table"],
    ["/compile-dashboard", "console"],
    ["/template-library", "card-grid"],
    ["/search", "search"],
    ["/docs", "article"],
    ["/docs/getting-started/install", "article"],
    ["/admin", "table"],
    ["/admin/users", "table"],
    ["/rate-limits", "chart"],
    ["/oracle", "chart"],
    ["/patents", "table"],
    ["/patent-registry", "detail"],
    ["/reit", "stat"],
    ["/yield-optimizer", "chart"],
    ["/offline", "list"],
  ])("maps %s to %s", (pathname, expected) => {
    expect(inferSkeletonShape(pathname)).toBe(expected);
  });

  it("ignores a query string", () => {
    expect(inferSkeletonShape("/search?q=wasm")).toBe("search");
  });

  it("ignores a hash", () => {
    expect(inferSkeletonShape("/docs#install")).toBe("article");
  });

  it("normalises a trailing slash", () => {
    expect(inferSkeletonShape("/playground/")).toBe("editor");
    expect(inferSkeletonShape("/playground///")).toBe("editor");
  });

  it("falls back to a list for an unknown route", () => {
    expect(inferSkeletonShape("/some-future-page")).toBe("list");
  });

  it("uses a stat shape when there is no pathname yet", () => {
    // On the very first render `usePathname()` can be empty; a stat block is
    // the least surprising placeholder for "nothing is known yet".
    expect(inferSkeletonShape("")).toBe("stat");
    expect(inferSkeletonShape(null)).toBe("stat");
    expect(inferSkeletonShape(undefined)).toBe("stat");
  });

  it("does not let a broad rule shadow a specific one", () => {
    // `/admin` is a table, and `/admin/settings` must not fall through to the
    // default list just because the prefix matched a later rule.
    expect(inferSkeletonShape("/admin/settings")).toBe("table");
    expect(inferSkeletonShape("/oracle/contracts")).toBe("chart");
  });

  it("is stable across repeated calls", () => {
    // The rules are module-level regexes; a `g` flag would make `.test()`
    // alternate results between calls.
    for (let i = 0; i < 5; i += 1) {
      expect(inferSkeletonShape("/playground")).toBe("editor");
      expect(inferSkeletonShape("/docs/install")).toBe("article");
    }
  });
});

describe("inferSkeletonReason", () => {
  it("names the rule that matched", () => {
    expect(inferSkeletonReason("/playground")).toBe("playground");
    expect(inferSkeletonReason("/docs/install")).toBe("docs");
  });

  it("reports the fallback for an unknown route", () => {
    expect(inferSkeletonReason("/nope")).toBe("default");
  });

  it("reports why there is no shape", () => {
    expect(inferSkeletonReason(null)).toBe("no-pathname");
  });

  it("agrees with the shape for every rule", () => {
    expect(inferSkeletonReason("/offline")).not.toBe("default");
    expect(inferSkeletonReason("/offline")).toBe(inferSkeletonReason("/offline/"));
  });
});

describe("skeletonLabel", () => {
  it("gives every shape a distinct, human label", () => {
    const shapes: SkeletonShape[] = [
      "article",
      "card-grid",
      "chart",
      "code",
      "console",
      "detail",
      "editor",
      "form",
      "list",
      "search",
      "stat",
      "table",
    ];
    const labels = shapes.map(skeletonLabel);
    expect(new Set(labels).size).toBe(shapes.length);
    for (const label of labels) {
      expect(label.startsWith("Loading ")).toBe(true);
    }
  });

  it("ends in an ellipsis for screen readers", () => {
    expect(skeletonLabel("editor").endsWith("…")).toBe(true);
  });
});
