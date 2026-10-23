/**
 * Spotlight registry (issue #1725) — the pure rank/group pipeline behind the
 * palette's five required groups.
 */

import {
  buildNavigationActions,
  flattenSpotlightGroups,
  groupSpotlightResults,
  rankSpotlightActions,
  SPOTLIGHT_GROUPS,
  type SpotlightAction,
} from "@/lib/spotlightRegistry";
import type { NavigationItem } from "@/lib/navigation";

const ROUTES: NavigationItem[] = [
  {
    name: "IDE Playground",
    href: "/playground",
    icon: "code",
    description: "Monaco editor desk",
    keywords: ["editor", "monaco"],
  },
  {
    name: "Compile Dashboard",
    href: "/compile-dashboard",
    icon: "zap",
    description: "Compile queue",
    keywords: ["build", "wasm"],
  },
];

const ACTIONS: SpotlightAction[] = [
  {
    id: "build.compile",
    title: "Compile contract",
    group: "Build",
    keywords: ["compile", "build", "cargo", "wasm"],
    defaultChord: ["Meta", "Shift", "KeyB"],
  },
  {
    id: "deploy.artifact",
    title: "Deploy compiled contract",
    group: "Deploy",
    keywords: ["deploy", "publish"],
  },
  {
    id: "settings.theme",
    title: "Toggle light / dark theme",
    group: "Settings",
    keywords: ["theme", "dark", "light"],
  },
];

describe("buildNavigationActions", () => {
  it("maps every route into the Navigation group", () => {
    const actions = buildNavigationActions(ROUTES);
    expect(actions).toHaveLength(2);
    expect(actions.every((a) => a.group === "Navigation")).toBe(true);
    expect(actions[0].href).toBe("/playground");
    expect(actions[0].keywords).toContain("editor");
  });

  it("omits the route the user is already on", () => {
    const actions = buildNavigationActions(ROUTES, {
      currentPath: "/playground",
    });
    expect(actions.some((a) => a.href === "/playground")).toBe(false);
    expect(actions).toHaveLength(1);
  });
});

describe("rankSpotlightActions", () => {
  const index = [...ACTIONS, ...buildNavigationActions(ROUTES)];

  it("returns everything, in registry order, for an empty query", () => {
    const results = rankSpotlightActions(index, "");
    expect(results.map((r) => r.action.id)).toEqual([
      "build.compile",
      "deploy.artifact",
      "settings.theme",
      "nav:/playground",
      "nav:/compile-dashboard",
    ]);
  });

  it("puts the exact title match first", () => {
    const [top] = rankSpotlightActions(index, "compile");
    expect(top.action.title).toBe("Compile contract");
    expect(top.score).toBeGreaterThan(0);
  });

  it("matches scattered subsequences across fields", () => {
    // "dbd" walks "Deploy compiled contract"… and "wasm" only exists in the
    // Build keywords, so both must be findable.
    const results = rankSpotlightActions(index, "wasm");
    expect(results[0].action.id).toBe("build.compile");
  });

  it("marks the matched characters for highlighting", () => {
    const [top] = rankSpotlightActions(index, "cmpct");
    expect(top.action.id).toBe("build.compile");
    expect(top.segments.filter((s) => s.match).length).toBeGreaterThan(0);
    expect(top.segments.map((s) => s.text).join("")).toBe(top.action.title);
  });

  it("honours the limit", () => {
    expect(rankSpotlightActions(index, "c", { limit: 2 })).toHaveLength(2);
  });

  it("returns nothing for a non-matching query", () => {
    expect(rankSpotlightActions(index, "zzzqqqxxx")).toHaveLength(0);
  });
});

describe("groupSpotlightResults / flattenSpotlightGroups", () => {
  it("paints groups in the canonical order required by the issue", () => {
    const results = rankSpotlightActions(
      [...ACTIONS, ...buildNavigationActions(ROUTES)],
      "",
    );
    const groups = groupSpotlightResults(results);
    const order = groups.map((g) => g.group);
    // Only present groups are returned, always in SPOTLIGHT_GROUPS order.
    const expected = SPOTLIGHT_GROUPS.filter((group) => order.includes(group));
    expect(order).toEqual(expected);
    expect(order).toContain("Navigation");
    expect(order).toContain("Build");
    expect(order).toContain("Deploy");
    expect(order).toContain("Settings");
  });

  it("drops no result when flattening", () => {
    const results = rankSpotlightActions(
      [...ACTIONS, ...buildNavigationActions(ROUTES)],
      "c",
    );
    const flattened = flattenSpotlightGroups(groupSpotlightResults(results));
    expect(flattened).toHaveLength(results.length);
  });
});
