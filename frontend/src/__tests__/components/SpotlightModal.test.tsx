/**
 * Spotlight command palette (issue #1725).
 *
 * The registry half is a pure rank/group pipeline; the component half covers
 * the global hotkeys, the ARIA combobox contract, the keyboard model, fuzzy
 * highlighting and the persisting shortcut editor — the parts that regress
 * silently and also have to work for anyone navigating by keyboard.
 */

import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { SpotlightModal } from "@/components/CommandPalette/SpotlightModal";
import type { SpotlightAction } from "@/lib/spotlightRegistry";
import type { NavigationItem } from "@/lib/navigation";
import {
  SPOTLIGHT_COMPILE_REQUEST_EVENT,
  SPOTLIGHT_DEPLOY_REQUEST_EVENT,
} from "@/state/compileStore";

// The `mock` prefix is required: jest hoists these factories above the
// declarations, and only `mock`-prefixed bindings are allowed to be captured.
const mockPush = jest.fn();
const mockToggleTheme = jest.fn();
const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockDisconnect = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => "/",
}));

jest.mock("@/components/providers/ThemeProvider", () => ({
  useTheme: () => ({ state: { mode: "dark" }, toggle: mockToggleTheme }),
}));

jest.mock("@/components/providers/WalletProvider", () => ({
  useWallet: () => ({
    status: "idle",
    connect: mockConnect,
    disconnect: mockDisconnect,
  }),
}));

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
  {
    name: "Docs & Reference",
    href: "/docs",
    icon: "book",
    description: "Guides",
    keywords: ["help", "sdk"],
  },
];

function renderSpotlight(
  props: Partial<React.ComponentProps<typeof SpotlightModal>> = {},
) {
  return render(
    <SpotlightModal
      open
      onOpenChange={jest.fn()}
      routes={ROUTES}
      {...props}
    />,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  mockPush.mockClear();
  mockToggleTheme.mockClear();
  mockConnect.mockClear();
  mockDisconnect.mockClear();
});

describe("SpotlightModal — global keys", () => {
  it("renders nothing while closed", () => {
    const { container } = render(
      <SpotlightModal open={false} onOpenChange={jest.fn()} routes={ROUTES} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("listens for Cmd+K / Ctrl+K globally and toggles through the parent", () => {
    const onOpenChange = jest.fn();
    // Closed: both platform chords request an open.
    const view = render(
      <SpotlightModal
        open={false}
        onOpenChange={onOpenChange}
        routes={ROUTES}
      />,
    );
    fireEvent.keyDown(document, { key: "k", code: "KeyK", metaKey: true });
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    fireEvent.keyDown(document, { key: "k", code: "KeyK", ctrlKey: true });
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    view.unmount();

    // Open: the same chord requests a close.
    const onOpenChangeOpen = jest.fn();
    render(
      <SpotlightModal
        open
        onOpenChange={onOpenChangeOpen}
        routes={ROUTES}
      />,
    );
    fireEvent.keyDown(document, { key: "k", code: "KeyK", metaKey: true });
    expect(onOpenChangeOpen).toHaveBeenLastCalledWith(false);
  });

  it("closes on Escape", () => {
    const onOpenChange = jest.fn();
    renderSpotlight({ onOpenChange });
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("runs a configured action chord app-wide", () => {
    const onOpenChange = jest.fn();
    const compileRequests = jest.fn();
    window.addEventListener(SPOTLIGHT_COMPILE_REQUEST_EVENT, compileRequests);
    renderSpotlight({ onOpenChange });

    // Default chord for build.compile is Cmd+Shift+B.
    fireEvent.keyDown(document, {
      key: "b",
      code: "KeyB",
      metaKey: true,
      shiftKey: true,
    });

    expect(compileRequests).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    window.removeEventListener(
      SPOTLIGHT_COMPILE_REQUEST_EVENT,
      compileRequests,
    );
  });

  it("runs the deploy action chord", () => {
    const deployRequests = jest.fn();
    window.addEventListener(SPOTLIGHT_DEPLOY_REQUEST_EVENT, deployRequests);
    renderSpotlight();

    fireEvent.keyDown(document, {
      key: "d",
      code: "KeyD",
      metaKey: true,
      shiftKey: true,
    });

    expect(deployRequests).toHaveBeenCalledTimes(1);
    window.removeEventListener(SPOTLIGHT_DEPLOY_REQUEST_EVENT, deployRequests);
  });
});

describe("SpotlightModal — groups and rendering", () => {
  it("shows the five required groups with keybinding hints", () => {
    renderSpotlight();
    for (const group of ["Navigation", "Build", "Deploy", "Wallets", "Settings"]) {
      expect(
        screen.getAllByText(new RegExp(group)).length,
      ).toBeGreaterThan(0);
    }
    // The default Cmd+Shift+B chord renders as a hint on "Compile contract".
    const compileRow = screen.getByText("Compile contract").closest("li");
    expect(compileRow).not.toBeNull();
    expect(within(compileRow as HTMLElement).getByText(/Shift/)).toBeInTheDocument();
  });

  it("exposes the combobox contract", () => {
    renderSpotlight();
    const input = screen.getByRole("combobox");
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-controls", "spotlight-listbox");
    expect(input).toHaveAttribute("aria-autocomplete", "list");
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("dialog")).toHaveAttribute(
      "aria-label",
      "Spotlight command palette",
    );
  });

  it("connects wallets from the Wallets group", () => {
    renderSpotlight();
    fireEvent.click(screen.getByText("Connect Freighter wallet"));
    expect(mockConnect).toHaveBeenCalledWith("freighter");
  });

  it("toggles the theme from the Settings group", () => {
    renderSpotlight();
    fireEvent.click(screen.getByText("Toggle light / dark theme"));
    expect(mockToggleTheme).toHaveBeenCalledTimes(1);
  });

  it("opens the classic palette when the shell provides the hook", () => {
    const onOpenClassicPalette = jest.fn();
    renderSpotlight({ onOpenClassicPalette });
    fireEvent.click(screen.getByText("Open command search"));
    expect(onOpenClassicPalette).toHaveBeenCalledTimes(1);
  });

  it("fuzzy-matches and highlights the matched characters", () => {
    const { container } = renderSpotlight();
    const input = screen.getByRole("combobox");

    // "cmpct" is a scattered subsequence of "Compile contract".
    fireEvent.change(input, { target: { value: "cmpct" } });
    const compileRow = screen
      .getAllByRole("option")
      .find((option) => option.textContent?.includes("Compile contract"));
    expect(compileRow).toBeDefined();
    const marks = (compileRow as HTMLElement).querySelectorAll("mark");
    expect(marks.length).toBeGreaterThan(0);
    // Highlighted characters are exactly the query characters, in order.
    const highlighted = Array.from(marks)
      .map((mark) => mark.textContent)
      .join("");
    expect(highlighted.toLowerCase()).toBe("cmpct");
    // And the non-matched remainder of the title is still rendered.
    expect(container.textContent).toContain("Compile contract");
  });

  it("shows an empty state for a query with no matches", () => {
    renderSpotlight();
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "zzzqqqxxx" } });
    expect(screen.getByText(/No matches/)).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

describe("SpotlightModal — keyboard navigation", () => {
  it("walks the painted order with the arrow keys and runs with Enter", () => {
    renderSpotlight();
    const input = screen.getByRole("combobox");

    // Painted order starts with the Navigation group: /playground first.
    expect(input).toHaveAttribute("aria-activedescendant");
    const firstId = input.getAttribute("aria-activedescendant");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).not.toBe(firstId);

    fireEvent.keyDown(input, { key: "Enter" });
    expect(mockPush).toHaveBeenCalledWith("/compile-dashboard");
  });

  it("wraps from the last row back to the first with ArrowDown", () => {
    renderSpotlight();
    const input = screen.getByRole("combobox");
    const listbox = screen.getByRole("listbox");
    const options = within(listbox).getAllByRole("option");
    expect(options.length).toBeGreaterThan(2);

    fireEvent.keyDown(input, { key: "ArrowUp" }); // wrap to last
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      options[options.length - 1].id,
    );
    fireEvent.keyDown(input, { key: "ArrowDown" }); // wrap to first
    expect(input).toHaveAttribute("aria-activedescendant", options[0].id);
  });

  it("supports Home and End", () => {
    renderSpotlight();
    const input = screen.getByRole("combobox");
    const options = within(screen.getByRole("listbox")).getAllByRole("option");

    fireEvent.keyDown(input, { key: "End" });
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      options[options.length - 1].id,
    );
    fireEvent.keyDown(input, { key: "Home" });
    expect(input).toHaveAttribute("aria-activedescendant", options[0].id);
  });

  it("marks exactly one option as selected at a time", () => {
    renderSpotlight();
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const selected = screen
      .getAllByRole("option")
      .filter((option) => option.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
  });
});

describe("SpotlightModal — configurable shortcuts", () => {
  const findRow = (title: string) => {
    const row = screen.getByText(title).closest("li");
    expect(row).not.toBeNull();
    return row as HTMLElement;
  };

  it("rebinds an action with Alt+Enter and persists it across sessions", () => {
    const compileRequests = jest.fn();
    window.addEventListener(SPOTLIGHT_COMPILE_REQUEST_EVENT, compileRequests);

    const first = renderSpotlight();
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "compile contract" } });

    // Alt+Enter starts capture on the highlighted row.
    fireEvent.keyDown(input, { key: "Enter", code: "Enter", altKey: true });
    expect(screen.getByText(/Press a shortcut/)).toHaveTextContent(
      /Compile contract/,
    );

    // Press the new chord (Cmd+J) to commit it.
    fireEvent.keyDown(document, { key: "j", code: "KeyJ", metaKey: true });
    expect(
      window.localStorage.getItem("sp:spotlight-keybindings"),
    ).toContain("KeyJ");
    expect(screen.queryByText(/Press a shortcut/)).not.toBeInTheDocument();
    first.unmount();

    // "New session": a fresh mount reads the override from localStorage and
    // the new chord now fires the compile request.
    compileRequests.mockClear();
    renderSpotlight();
    fireEvent.keyDown(document, { key: "j", code: "KeyJ", metaKey: true });
    expect(compileRequests).toHaveBeenCalledTimes(1);

    // The old default chord is gone.
    fireEvent.keyDown(document, {
      key: "b",
      code: "KeyB",
      metaKey: true,
      shiftKey: true,
    });
    expect(compileRequests).toHaveBeenCalledTimes(1);
    window.removeEventListener(SPOTLIGHT_COMPILE_REQUEST_EVENT, compileRequests);
  });

  it("rejects rebinding onto the reserved Cmd+K chord and Escape cancels", () => {
    renderSpotlight();
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "compile contract" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter", altKey: true });

    fireEvent.keyDown(document, { key: "k", code: "KeyK", metaKey: true });
    expect(screen.getByText(/reserved/)).toBeInTheDocument();
    expect(
      window.localStorage.getItem("sp:spotlight-keybindings"),
    ).toBeNull();

    // Escape cancels capture without closing the palette.
    fireEvent.keyDown(input, { key: "Escape", code: "Escape" });
    expect(screen.queryByText(/Press a shortcut/)).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("restores defaults through the Settings reset action", () => {
    const compileRequests = jest.fn();
    window.addEventListener(SPOTLIGHT_COMPILE_REQUEST_EVENT, compileRequests);

    renderSpotlight();
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "compile contract" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter", altKey: true });
    fireEvent.keyDown(document, { key: "j", code: "KeyJ", metaKey: true });
    expect(
      window.localStorage.getItem("sp:spotlight-keybindings"),
    ).toContain("KeyJ");

    fireEvent.change(input, { target: { value: "reset all spotlight shortcuts" } });
    const resetRow = screen
      .getByText("Restore the default keybindings")
      .closest("li");
    expect(resetRow).not.toBeNull();
    fireEvent.click(resetRow as HTMLElement);
    expect(
      window.localStorage.getItem("sp:spotlight-keybindings"),
    ).toContain("{}");

    // Default chord works again after the reset.
    fireEvent.keyDown(document, {
      key: "b",
      code: "KeyB",
      metaKey: true,
      shiftKey: true,
    });
    expect(compileRequests).toHaveBeenCalledTimes(1);
    window.removeEventListener(SPOTLIGHT_COMPILE_REQUEST_EVENT, compileRequests);
  });
});

describe("SpotlightModal — contributed shell actions", () => {
  it("merges provider actions into their group and runs them", () => {
    const run = jest.fn();
    const shellAction: SpotlightAction = {
      id: "shell.sync",
      title: "Sync workspace now",
      group: "Settings",
      action: run,
    };
    renderSpotlight({ actions: [shellAction] });
    fireEvent.click(screen.getByText("Sync workspace now"));
    expect(run).toHaveBeenCalledTimes(1);
  });
});
