/**
 * Global command palette (issue #1527).
 *
 * The registry half is a pure index/rank/group pipeline; the component half
 * covers the ARIA combobox contract and the keyboard model, which is the part
 * that regresses silently and is also the part that has to work for anyone
 * navigating by keyboard or screen reader.
 */

import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CommandPalette } from "@/components/CommandPalette";
import {
  buildCommandIndex,
  DEFAULT_MAX_RESULTS,
  groupResults,
  rankCommands,
  sourceLabel,
  type PaletteAction,
} from "@/lib/commandRegistry";
import type { TemplateMetadata } from "@/types/template";

// The `mock` prefix is required: jest hoists these factories above the
// declarations, and only `mock`-prefixed bindings are allowed to be captured.
const mockPush = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => "/",
}));

jest.mock("@/services/templateService", () => ({
  loadTemplateMetadata: jest.fn().mockResolvedValue([]),
}));

const TEMPLATE = {
  id: "hello-world",
  name: "Hello World",
  dirName: "hello-world",
  description: "A minimal counter contract",
  category: "Basic",
  functionalities: [],
  complexity: "Beginner",
  deploymentStatus: "verified",
  dependencies: [],
  tags: ["counter"],
  features: ["counter"],
} as unknown as TemplateMetadata;

const ACTION: PaletteAction = {
  id: "action:new-file",
  label: "New file",
  description: "Create a blank file in the explorer",
  run: jest.fn(),
};

beforeEach(() => {
  mockPush.mockClear();
  (ACTION.run as jest.Mock).mockClear();
  window.localStorage.clear();
});

describe("buildCommandIndex", () => {
  it("always includes the app's own routes", () => {
    const index = buildCommandIndex();
    expect(index.length).toBeGreaterThan(10);
    expect(index.some((item) => item.source === "route")).toBe(true);
  });

  it("folds in every supplied source", () => {
    const index = buildCommandIndex({
      templates: [TEMPLATE],
      recents: [{ id: "/docs", title: "Docs", kind: "route", at: 1 }],
      contracts: [
        {
          contractId: `C${"A".repeat(55)}`,
          label: "Counter",
          network: "testnet",
          deployedAt: 1,
        },
      ],
      actions: [ACTION],
    });
    const sources = new Set(index.map((item) => item.source));
    expect(sources).toEqual(
      new Set(["action", "recent", "contract", "template", "route"]),
    );
  });

  it("omits the route the user is already on", () => {
    const index = buildCommandIndex({ currentPath: "/playground" });
    expect(index.some((item) => item.href === "/playground")).toBe(false);
  });

  it("produces unique ids so listbox rows cannot collide", () => {
    const ids = buildCommandIndex({
      templates: [TEMPLATE],
      recents: [{ id: TEMPLATE.id, title: "Hello World", kind: "template", at: 1 }],
    }).map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("rankCommands", () => {
  const index = buildCommandIndex({
    templates: [TEMPLATE],
    actions: [ACTION],
  });

  it("puts an exact title match first", () => {
    const [top] = rankCommands(index, "Hello World");
    expect(top.item.title).toBe("Hello World");
    expect(top.score).toBeGreaterThan(0);
  });

  it("finds a result by a scattered subsequence", () => {
    const results = rankCommands(index, "hlo wrld");
    expect(results[0].item.title).toBe("Hello World");
  });

  it("matches on keywords as well as the title", () => {
    const results = rankCommands(index, "counter");
    expect(results.some((r) => r.item.title === "Hello World")).toBe(true);
  });

  it("returns nothing for a query that matches nothing", () => {
    expect(rankCommands(index, "zzzzqqqqxxxx")).toHaveLength(0);
  });

  it("caps the result count", () => {
    const many = buildCommandIndex().map((item, i) => ({ ...item, id: `x${i}` }));
    expect(rankCommands(many, "a", { maxResults: 5 }).length).toBeLessThanOrEqual(5);
  });

  it("honours the default cap", () => {
    const results = rankCommands(index, "a", { maxResults: DEFAULT_MAX_RESULTS });
    expect(results.length).toBeLessThanOrEqual(DEFAULT_MAX_RESULTS);
  });

  it("marks the matched spans for highlighting", () => {
    const [top] = rankCommands(index, "hello");
    expect(top.segments.some((segment) => segment.match)).toBe(true);
    expect(top.segments.map((s) => s.text).join("")).toContain("Hello World");
  });

  it("keeps scores positive for every match", () => {
    for (const result of rankCommands(index, "hello")) {
      expect(result.score).toBeGreaterThan(0);
    }
  });
});

describe("groupResults", () => {
  it("labels each source group", () => {
    const groups = groupResults(
      rankCommands(
        buildCommandIndex({ templates: [TEMPLATE], actions: [ACTION] }),
        "e",
      ),
    );
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      expect(typeof (group.label ?? sourceLabel(group.source))).toBe("string");
    }
  });

  it("returns nothing for no results", () => {
    expect(groupResults([])).toEqual([]);
  });

  it("does not drop any result while grouping", () => {
    const ranked = rankCommands(buildCommandIndex(), "e");
    const grouped = groupResults(ranked).flatMap((g) => g.results);
    expect(grouped).toHaveLength(ranked.length);
  });
});

describe("CommandPalette", () => {
  const renderOpen = (props: Partial<React.ComponentProps<typeof CommandPalette>> = {}) =>
    render(
      <CommandPalette open onOpenChange={jest.fn()} templates={[TEMPLATE]} {...props} />,
    );

  it("renders nothing while closed", () => {
    const { container } = render(
      <CommandPalette open={false} onOpenChange={jest.fn()} templates={[TEMPLATE]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("exposes the combobox contract", () => {
    renderOpen();
    const input = screen.getByRole("combobox");
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-controls", "command-palette-listbox");
    expect(input).toHaveAttribute("aria-autocomplete", "list");
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
  });

  it("renders a listbox of options", () => {
    renderOpen();
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
  });

  it("starts on the first result and tracks it with aria-activedescendant", () => {
    renderOpen();
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("combobox")).toHaveAttribute(
      "aria-activedescendant",
      options[0].id,
    );
  });

  it("moves the selection with the arrow keys and wraps around", () => {
    renderOpen();
    const input = screen.getByRole("combobox");
    const options = screen.getAllByRole("option");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(options[0]).toHaveAttribute("aria-selected", "true");

    // Wrapping up from the first row lands on the last one.
    fireEvent.keyDown(input, { key: "ArrowUp" });
    const all = screen.getAllByRole("option");
    expect(all[all.length - 1]).toHaveAttribute("aria-selected", "true");
  });

  it("jumps to the ends with Home and End", () => {
    renderOpen();
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "End" });
    let all = screen.getAllByRole("option");
    expect(all[all.length - 1]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "Home" });
    all = screen.getAllByRole("option");
    expect(all[0]).toHaveAttribute("aria-selected", "true");
  });

  it("navigates on Enter and closes", () => {
    const onOpenChange = jest.fn();
    renderOpen({ onOpenChange });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Hello World" } });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });

    expect(mockPush).toHaveBeenCalledWith("/template-library?template=hello-world");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes on Escape", () => {
    const onOpenChange = jest.fn();
    renderOpen({ onOpenChange });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("filters as the query changes and resets the cursor", () => {
    renderOpen();
    const input = screen.getByRole("combobox");
    const before = screen.getAllByRole("option").length;

    fireEvent.change(input, { target: { value: "hello" } });
    const filtered = screen.getAllByRole("option");
    expect(filtered.length).toBeLessThan(before);
    // Typing resets the highlight to the best match rather than leaving the
    // cursor on whatever row happened to be active for the previous query.
    expect(filtered[0]).toHaveAttribute("aria-selected", "true");
    expect(filtered[0]).toHaveTextContent(/Hello World/i);
  });

  it("keeps keyboard order aligned with the painted order", () => {
    // Regression: the rows are painted grouped by source, so if the arrow keys
    // walked the raw ranked order the highlight would appear to jump around the
    // list and `aria-activedescendant` would contradict what the user sees.
    renderOpen();
    const input = screen.getByRole("combobox");
    const seen: Array<string | null> = [];
    for (let i = 0; i < 6; i += 1) {
      const activeId = input.getAttribute("aria-activedescendant");
      const index = screen
        .getAllByRole("option")
        .findIndex((option) => option.id === activeId);
      seen.push(index === -1 ? null : String(index));
      fireEvent.keyDown(input, { key: "ArrowDown" });
    }
    // Each step lands on the next painted row, with no skips or repeats.
    const indices = seen.map(Number);
    for (let i = 1; i < indices.length; i += 1) {
      expect(indices[i]).toBe(indices[i - 1] + 1);
    }
    expect(seen.every((value) => value !== null)).toBe(true);
  });

  it("says so when nothing matches", () => {
    renderOpen();
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "zzzzqqqqxxxx" },
    });
    expect(screen.getByText(/No matches for/)).toBeInTheDocument();
  });

  it("reports the result count", () => {
    renderOpen();
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "hello" } });
    const count = screen.getAllByRole("option").length;
    expect(screen.getByText(`${count} results`)).toBeInTheDocument();
  });

  it("runs a local action instead of routing", () => {
    const onOpenChange = jest.fn();
    renderOpen({ actions: [ACTION], onOpenChange });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "New file" } });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });

    expect(ACTION.run).toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("highlights the fuzzy match spans with <mark>", () => {
    renderOpen();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "hlo" } });
    expect(screen.getAllByRole("option")[0].querySelector("mark")).not.toBeNull();
  });

  it("selects an option on click", () => {
    const onOpenChange = jest.fn();
    renderOpen({ onOpenChange });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Hello World" } });
    fireEvent.click(screen.getAllByRole("option")[0]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes when the backdrop is clicked", () => {
    const onOpenChange = jest.fn();
    renderOpen({ onOpenChange });
    fireEvent.click(screen.getByRole("button", { name: /close command palette/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("focuses the input once opened", async () => {
    renderOpen();
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveFocus());
  });

  it("does not fetch templates when they are supplied", async () => {
    const { loadTemplateMetadata } = await import("@/services/templateService");
    (loadTemplateMetadata as jest.Mock).mockClear();
    renderOpen();
    await act(async () => undefined);
    expect(loadTemplateMetadata).not.toHaveBeenCalled();
  });

  it("fetches templates lazily when they are not supplied", async () => {
    const { loadTemplateMetadata } = await import("@/services/templateService");
    (loadTemplateMetadata as jest.Mock).mockClear();
    render(<CommandPalette open onOpenChange={jest.fn()} />);
    await waitFor(() => expect(loadTemplateMetadata).toHaveBeenCalled());
  });
});
