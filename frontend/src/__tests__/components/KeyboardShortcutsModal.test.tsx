// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { KeyboardShortcutsModal } from "@/components/KeyboardShortcutsModal";

describe("KeyboardShortcutsModal (#2077)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.clearAllMocks();
  });

  it("does not render when isOpen is false", () => {
    render(<KeyboardShortcutsModal isOpen={false} onClose={jest.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders accessible dialog with title and platform indicator when isOpen is true", () => {
    render(
      <KeyboardShortcutsModal
        isOpen={true}
        onClose={jest.fn()}
        isMacOverride={false}
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Keyboard Shortcuts")).toBeInTheDocument();
    expect(screen.getByText(/Windows\/Linux/)).toBeInTheDocument();
  });

  it("renders macOS platform badge when running on Mac", () => {
    render(
      <KeyboardShortcutsModal
        isOpen={true}
        onClose={jest.fn()}
        isMacOverride={true}
      />,
    );

    expect(screen.getByText(/macOS \(⌘ Cmd\)/)).toBeInTheDocument();
  });

  it("switches keymap presets when radio buttons are clicked", () => {
    render(
      <KeyboardShortcutsModal
        isOpen={true}
        onClose={jest.fn()}
        isMacOverride={false}
      />,
    );

    const vimRadio = screen.getByRole("radio", { name: "Vim" });
    const sublimeRadio = screen.getByRole("radio", { name: "Sublime Text" });

    // Switch to Vim preset
    fireEvent.click(vimRadio);
    expect(vimRadio).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/Save & Format Contract \(:w\)/)).toBeInTheDocument();

    // Switch to Sublime Text preset
    fireEvent.click(sublimeRadio);
    expect(sublimeRadio).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Goto Anything...")).toBeInTheDocument();
  });

  it("toggles Monaco Vim Mode switch", () => {
    render(
      <KeyboardShortcutsModal
        isOpen={true}
        onClose={jest.fn()}
        isMacOverride={false}
      />,
    );

    const switchBtn = screen.getByRole("switch");
    expect(switchBtn).toHaveAttribute("aria-checked", "false");

    fireEvent.click(switchBtn);
    expect(switchBtn).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Enabled")).toBeInTheDocument();

    fireEvent.click(switchBtn);
    expect(switchBtn).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Off")).toBeInTheDocument();
  });

  it("filters shortcuts via search query input", () => {
    render(
      <KeyboardShortcutsModal
        isOpen={true}
        onClose={jest.fn()}
        isMacOverride={false}
      />,
    );

    const searchInput = screen.getByPlaceholderText("Search shortcuts...");
    fireEvent.change(searchInput, { target: { value: "Deploy" } });

    expect(screen.getByText("Deploy Contract")).toBeInTheDocument();
    expect(screen.queryByText("Toggle Sidebar")).not.toBeInTheDocument();

    // Clear search
    const clearBtn = screen.getByText("Clear");
    fireEvent.click(clearBtn);
    expect(screen.getByText("Toggle Sidebar")).toBeInTheDocument();
  });

  it("filters shortcuts by category tab", () => {
    render(
      <KeyboardShortcutsModal
        isOpen={true}
        onClose={jest.fn()}
        isMacOverride={false}
      />,
    );

    const buildCategoryTab = screen.getByRole("button", {
      name: "Build & Deploy",
    });
    fireEvent.click(buildCategoryTab);

    expect(screen.getByText("Build & Compile WASM")).toBeInTheDocument();
    expect(screen.getByText("Deploy Contract")).toBeInTheDocument();
    expect(screen.queryByText("Toggle Sidebar")).not.toBeInTheDocument();
  });

  it("allows interactive remapping of a hotkey and shows customizer status", () => {
    render(
      <KeyboardShortcutsModal
        isOpen={true}
        onClose={jest.fn()}
        isMacOverride={false}
      />,
    );

    const remapBtn = screen.getByLabelText("Remap Save & Format Contract");
    fireEvent.click(remapBtn);

    expect(
      screen.getByText(/Press new shortcut\.\.\. \(Esc to cancel\)/),
    ).toBeInTheDocument();

    // User presses Ctrl+Alt+S
    fireEvent.keyDown(window, {
      key: "s",
      code: "KeyS",
      ctrlKey: true,
      altKey: true,
    });

    expect(screen.getByText("Customized")).toBeInTheDocument();
    expect(screen.getByText("Ctrl+Alt+S")).toBeInTheDocument();
    expect(screen.getByText(/Remapped to Ctrl\+Alt\+S/)).toBeInTheDocument();

    // Reset button should now be available
    const resetBtn = screen.getByLabelText(
      "Reset Save & Format Contract to default",
    );
    fireEvent.click(resetBtn);

    expect(screen.queryByText("Customized")).not.toBeInTheDocument();
    expect(screen.getByText("Ctrl+S")).toBeInTheDocument();
  });

  it("displays conflict warning when remapping to an already used hotkey", () => {
    render(
      <KeyboardShortcutsModal
        isOpen={true}
        onClose={jest.fn()}
        isMacOverride={false}
      />,
    );

    const remapBtn = screen.getByLabelText("Remap Save & Format Contract");
    fireEvent.click(remapBtn);

    // Ctrl+K is already used by Spotlight Command Palette
    fireEvent.keyDown(window, {
      key: "k",
      code: "KeyK",
      ctrlKey: true,
    });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/already mapped to/i);
  });

  it("cancels recording when Escape is pressed", () => {
    render(
      <KeyboardShortcutsModal
        isOpen={true}
        onClose={jest.fn()}
        isMacOverride={false}
      />,
    );

    const remapBtn = screen.getByLabelText("Remap Save & Format Contract");
    fireEvent.click(remapBtn);

    expect(
      screen.getByText(/Press new shortcut\.\.\. \(Esc to cancel\)/),
    ).toBeInTheDocument();

    // Escape cancels recording
    fireEvent.keyDown(window, { key: "Escape" });

    expect(
      screen.queryByText(/Press new shortcut\.\.\. \(Esc to cancel\)/),
    ).not.toBeInTheDocument();
  });

  it("closes modal on close button click or Escape key", () => {
    const handleClose = jest.fn();
    render(
      <KeyboardShortcutsModal
        isOpen={true}
        onClose={handleClose}
        isMacOverride={false}
      />,
    );

    // Click close icon
    const closeBtn = screen.getByLabelText("Close shortcuts modal");
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);

    // Click Done button
    const doneBtn = screen.getByRole("button", { name: "Done" });
    fireEvent.click(doneBtn);
    expect(handleClose).toHaveBeenCalledTimes(2);

    // Press Escape
    fireEvent.keyDown(window, { key: "Escape" });
    expect(handleClose).toHaveBeenCalledTimes(3);
  });

  it("resets all shortcuts to preset defaults when reset all button is clicked", () => {
    render(
      <KeyboardShortcutsModal
        isOpen={true}
        onClose={jest.fn()}
        isMacOverride={false}
      />,
    );

    // Remap a shortcut first
    const remapBtn = screen.getByLabelText("Remap Save & Format Contract");
    fireEvent.click(remapBtn);
    fireEvent.keyDown(window, {
      key: "s",
      code: "KeyS",
      ctrlKey: true,
      altKey: true,
    });
    expect(screen.getByText("Customized")).toBeInTheDocument();

    // Click Reset all
    const resetAllBtn = screen.getByRole("button", {
      name: /Reset all shortcuts to defaults/i,
    });
    fireEvent.click(resetAllBtn);

    expect(screen.queryByText("Customized")).not.toBeInTheDocument();
  });
});
