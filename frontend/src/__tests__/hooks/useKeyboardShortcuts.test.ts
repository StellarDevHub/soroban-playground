// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { act, renderHook } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import {
  useKeyboardShortcuts,
  VIM_MODE_CHANGE_EVENT,
} from "@/hooks/useKeyboardShortcuts";
import {
  KEYBOARD_SHORTCUTS_STORAGE_KEY,
  KEYMAP_PRESET_STORAGE_KEY,
  VIM_MODE_STORAGE_KEY,
} from "@/lib/shortcuts/storage";

describe("useKeyboardShortcuts — Cross-Platform Hotkeys & Presets (#2077)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.clearAllMocks();
  });

  describe("Platform Detection & Dynamic Modifiers", () => {
    it("identifies Windows platform and sets modifier to Ctrl", () => {
      const { result } = renderHook(() =>
        useKeyboardShortcuts({ isMacOverride: false }),
      );

      expect(result.current.isMac).toBe(false);
      expect(result.current.modKey).toBe("Ctrl");
      expect(result.current.formatKey("Mod+S")).toBe("Ctrl+S");
      expect(result.current.formatKey("Mod+Shift+B")).toBe("Ctrl+Shift+B");
    });

    it("identifies macOS platform and sets modifier to ⌘ Cmd", () => {
      const { result } = renderHook(() =>
        useKeyboardShortcuts({ isMacOverride: true }),
      );

      expect(result.current.isMac).toBe(true);
      expect(result.current.modKey).toBe("⌘");
      expect(result.current.formatKey("Mod+S")).toBe("⌘S");
      expect(result.current.formatKey("Mod+Shift+B")).toBe("⌘⇧B");
    });
  });

  describe("Cross-Platform Shortcut Execution (Windows Ctrl+S vs macOS Cmd+S)", () => {
    it("executes shortcut on Windows with Ctrl+S", () => {
      const { result } = renderHook(() =>
        useKeyboardShortcuts({ isMacOverride: false }),
      );

      const mockSaveHandler = jest.fn();
      act(() => {
        result.current.registerAction("editor.save", mockSaveHandler);
      });

      // Windows user presses Ctrl+S
      fireEvent.keyDown(window, {
        key: "s",
        code: "KeyS",
        ctrlKey: true,
        metaKey: false,
      });

      expect(mockSaveHandler).toHaveBeenCalledTimes(1);

      // Windows user pressing Meta+S alone should NOT trigger Windows Ctrl+S shortcut
      fireEvent.keyDown(window, {
        key: "s",
        code: "KeyS",
        ctrlKey: false,
        metaKey: true,
      });

      expect(mockSaveHandler).toHaveBeenCalledTimes(1);
    });

    it("executes shortcut on macOS with Cmd+S", () => {
      const { result } = renderHook(() =>
        useKeyboardShortcuts({ isMacOverride: true }),
      );

      const mockSaveHandler = jest.fn();
      act(() => {
        result.current.registerAction("editor.save", mockSaveHandler);
      });

      // macOS user presses Cmd+S (metaKey)
      fireEvent.keyDown(window, {
        key: "s",
        code: "KeyS",
        metaKey: true,
        ctrlKey: false,
      });

      expect(mockSaveHandler).toHaveBeenCalledTimes(1);

      // macOS user pressing Ctrl+S should NOT trigger Mod+S
      fireEvent.keyDown(window, {
        key: "s",
        code: "KeyS",
        metaKey: false,
        ctrlKey: true,
      });

      expect(mockSaveHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe("Keymap Presets Switching (VSCode, Vim, Sublime Text)", () => {
    it("loads default VSCode preset with standard shortcuts", () => {
      const { result } = renderHook(() =>
        useKeyboardShortcuts({ isMacOverride: false }),
      );

      expect(result.current.preset).toBe("vscode");
      const buildShortcut = result.current.shortcuts.find(
        (s) => s.id === "build.compile",
      );
      expect(buildShortcut?.defaultKey).toBe("Mod+Shift+B");

      const paletteShortcut = result.current.shortcuts.find(
        (s) => s.id === "palette.spotlight",
      );
      expect(paletteShortcut?.defaultKey).toBe("Mod+K");
    });

    it("switches to Vim preset and enables Monaco Vim mode", () => {
      const dispatchSpy = jest.spyOn(window, "dispatchEvent");
      const { result } = renderHook(() =>
        useKeyboardShortcuts({ isMacOverride: false }),
      );

      act(() => {
        result.current.setPreset("vim");
      });

      expect(result.current.preset).toBe("vim");
      expect(result.current.vimModeEnabled).toBe(true);

      const findShortcut = result.current.shortcuts.find(
        (s) => s.id === "editor.find",
      );
      expect(findShortcut?.defaultKey).toBe("/");

      const helpShortcut = result.current.shortcuts.find(
        (s) => s.id === "general.shortcuts_modal",
      );
      expect(helpShortcut?.defaultKey).toBe("?");

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: VIM_MODE_CHANGE_EVENT }),
      );
      expect(window.localStorage.getItem(KEYMAP_PRESET_STORAGE_KEY)).toContain(
        "vim",
      );
    });

    it("switches to Sublime Text preset with classic Sublime bindings", () => {
      const { result } = renderHook(() =>
        useKeyboardShortcuts({ isMacOverride: false }),
      );

      act(() => {
        result.current.setPreset("sublime");
      });

      expect(result.current.preset).toBe("sublime");

      // In Sublime, Spotlight/Command Palette is Mod+Shift+P
      const palette = result.current.shortcuts.find(
        (s) => s.id === "palette.spotlight",
      );
      expect(palette?.defaultKey).toBe("Mod+Shift+P");

      // In Sublime, Build is Mod+B
      const build = result.current.shortcuts.find(
        (s) => s.id === "build.compile",
      );
      expect(build?.defaultKey).toBe("Mod+B");

      expect(window.localStorage.getItem(KEYMAP_PRESET_STORAGE_KEY)).toContain(
        "sublime",
      );
    });
  });

  describe("Custom Key Remapping & Persistence", () => {
    it("allows remapping a shortcut and executes with new binding", () => {
      const { result } = renderHook(() =>
        useKeyboardShortcuts({ isMacOverride: false }),
      );

      const mockSaveHandler = jest.fn();
      act(() => {
        result.current.registerAction("editor.save", mockSaveHandler);
      });

      // Remap editor.save from Ctrl+S to Ctrl+Alt+S
      act(() => {
        result.current.updateShortcut("editor.save", "Mod+Alt+S");
      });

      const updated = result.current.shortcuts.find(
        (s) => s.id === "editor.save",
      );
      expect(updated?.customKey).toBe("Mod+Alt+S");

      // Verified stored in localStorage
      const stored = JSON.parse(
        window.localStorage.getItem(KEYBOARD_SHORTCUTS_STORAGE_KEY) || "{}",
      );
      expect(stored["editor.save"]).toBe("Mod+Alt+S");

      // Old Ctrl+S does not trigger handler
      fireEvent.keyDown(window, {
        key: "s",
        code: "KeyS",
        ctrlKey: true,
        altKey: false,
      });
      expect(mockSaveHandler).not.toHaveBeenCalled();

      // New Ctrl+Alt+S triggers handler
      fireEvent.keyDown(window, {
        key: "s",
        code: "KeyS",
        ctrlKey: true,
        altKey: true,
      });
      expect(mockSaveHandler).toHaveBeenCalledTimes(1);
    });

    it("resets individual shortcut to default", () => {
      const { result } = renderHook(() =>
        useKeyboardShortcuts({
          isMacOverride: false,
          initialOverrides: { "editor.save": "Mod+Alt+S" },
        }),
      );

      expect(
        result.current.shortcuts.find((s) => s.id === "editor.save")?.customKey,
      ).toBe("Mod+Alt+S");

      act(() => {
        result.current.resetShortcut("editor.save");
      });

      expect(
        result.current.shortcuts.find((s) => s.id === "editor.save")?.customKey,
      ).toBeUndefined();

      const stored = JSON.parse(
        window.localStorage.getItem(KEYBOARD_SHORTCUTS_STORAGE_KEY) || "{}",
      );
      expect(stored["editor.save"]).toBeUndefined();
    });

    it("resets all shortcuts to defaults", () => {
      const { result } = renderHook(() =>
        useKeyboardShortcuts({
          isMacOverride: false,
          initialOverrides: {
            "editor.save": "Mod+Alt+S",
            "palette.spotlight": "Mod+J",
          },
        }),
      );

      act(() => {
        result.current.resetAllShortcuts();
      });

      expect(
        result.current.shortcuts.find((s) => s.id === "editor.save")?.customKey,
      ).toBeUndefined();
      expect(
        result.current.shortcuts.find((s) => s.id === "palette.spotlight")
          ?.customKey,
      ).toBeUndefined();

      const stored = JSON.parse(
        window.localStorage.getItem(KEYBOARD_SHORTCUTS_STORAGE_KEY) || "{}",
      );
      expect(Object.keys(stored)).toHaveLength(0);
    });
  });

  describe("Conflict Detection", () => {
    it("detects conflicting hotkeys", () => {
      const { result } = renderHook(() =>
        useKeyboardShortcuts({ isMacOverride: false }),
      );

      // Mod+K is already used by palette.spotlight
      const conflict = result.current.findConflict("Mod+K", "some.new.action");
      expect(conflict).not.toBeNull();
      expect(conflict?.existingShortcut.id).toBe("palette.spotlight");

      // Same ID does not self-conflict
      const selfConflict = result.current.findConflict("Mod+K", "palette.spotlight");
      expect(selfConflict).toBeNull();

      // Unused key has no conflict
      const unused = result.current.findConflict("Mod+Alt+Z");
      expect(unused).toBeNull();
    });
  });

  describe("Monaco Vim Mode Toggle", () => {
    it("toggles Vim mode on and off and persists setting", () => {
      const { result } = renderHook(() =>
        useKeyboardShortcuts({ initialVimMode: false }),
      );

      expect(result.current.vimModeEnabled).toBe(false);

      act(() => {
        result.current.toggleVimMode();
      });

      expect(result.current.vimModeEnabled).toBe(true);
      expect(window.localStorage.getItem(VIM_MODE_STORAGE_KEY)).toContain("true");

      act(() => {
        result.current.toggleVimMode();
      });

      expect(result.current.vimModeEnabled).toBe(false);
      expect(window.localStorage.getItem(VIM_MODE_STORAGE_KEY)).toContain("false");
    });
  });

  describe("Typing Element Isolation", () => {
    it("does not trigger single character shortcuts like / when user is typing in input", () => {
      const { result } = renderHook(() =>
        useKeyboardShortcuts({
          isMacOverride: false,
          initialPreset: "vim",
        }),
      );

      const mockFindHandler = jest.fn();
      act(() => {
        result.current.registerAction("actions.find", mockFindHandler);
      });

      const input = document.createElement("input");
      document.body.appendChild(input);
      input.focus();

      // Pressing / inside input should NOT trigger actions.find
      fireEvent.keyDown(input, { key: "/" });
      expect(mockFindHandler).not.toHaveBeenCalled();

      document.body.removeChild(input);
    });
  });
});
