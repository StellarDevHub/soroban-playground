// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import {
  detectPlatform,
  eventToShortcutString,
  formatShortcut,
  getPlatformModifier,
  isApplePlatform,
  matchesShortcut,
  MODIFIER_KEYS,
} from "@/lib/shortcuts/platform";
import {
  PRESET_MAP,
  SUBLIME_SHORTCUTS,
  VIM_SHORTCUTS,
  VSCODE_SHORTCUTS,
} from "@/lib/shortcuts/presets";
import {
  loadKeymapPreset,
  loadShortcutOverrides,
  loadVimModeEnabled,
  saveKeymapPreset,
  saveShortcutOverrides,
  saveVimModeEnabled,
} from "@/lib/shortcuts/storage";

describe("Shortcuts Architecture & Platform Engine (#2077)", () => {
  describe("Platform Detection", () => {
    it("respects override flag for deterministic cross-platform behavior", () => {
      expect(isApplePlatform(true)).toBe(true);
      expect(isApplePlatform(false)).toBe(false);
      expect(detectPlatform(true)).toBe("mac");
      expect(detectPlatform(false)).toBe("windows");
      expect(getPlatformModifier(true)).toBe("Cmd");
      expect(getPlatformModifier(false)).toBe("Ctrl");
    });
  });

  describe("formatShortcut formatting", () => {
    it("formats shortcuts correctly for macOS with symbols", () => {
      expect(formatShortcut("Mod+S", true)).toBe("⌘S");
      expect(formatShortcut("Mod+Shift+B", true)).toBe("⌘⇧B");
      expect(formatShortcut("Mod+Alt+V", true)).toBe("⌘⌥V");
      expect(formatShortcut("Mod+Enter", true)).toBe("⌘↵");
      expect(formatShortcut("Mod+/", true)).toBe("⌘/");
      expect(formatShortcut("?", true)).toBe("?");
      expect(formatShortcut("", true)).toBe("");
      expect(formatShortcut(undefined, true)).toBe("");
    });

    it("formats shortcuts correctly for Windows/Linux with text representation", () => {
      expect(formatShortcut("Mod+S", false)).toBe("Ctrl+S");
      expect(formatShortcut("Mod+Shift+B", false)).toBe("Ctrl+Shift+B");
      expect(formatShortcut("Mod+Alt+V", false)).toBe("Ctrl+Alt+V");
      expect(formatShortcut("Mod+Enter", false)).toBe("Ctrl+Enter");
      expect(formatShortcut("Mod+/", false)).toBe("Ctrl+/");
      expect(formatShortcut("?", false)).toBe("?");
    });
  });

  describe("matchesShortcut matching logic", () => {
    it("matches Windows Ctrl+S and rejects macOS Cmd+S on Windows", () => {
      const windowsEvent = new KeyboardEvent("keydown", {
        key: "s",
        code: "KeyS",
        ctrlKey: true,
        metaKey: false,
      });

      const macEvent = new KeyboardEvent("keydown", {
        key: "s",
        code: "KeyS",
        ctrlKey: false,
        metaKey: true,
      });

      expect(matchesShortcut(windowsEvent, "Mod+S", false)).toBe(true);
      expect(matchesShortcut(macEvent, "Mod+S", false)).toBe(false);
    });

    it("matches macOS Cmd+S and rejects Windows Ctrl+S on macOS", () => {
      const macEvent = new KeyboardEvent("keydown", {
        key: "s",
        code: "KeyS",
        ctrlKey: false,
        metaKey: true,
      });

      const windowsEvent = new KeyboardEvent("keydown", {
        key: "s",
        code: "KeyS",
        ctrlKey: true,
        metaKey: false,
      });

      expect(matchesShortcut(macEvent, "Mod+S", true)).toBe(true);
      expect(matchesShortcut(windowsEvent, "Mod+S", true)).toBe(false);
    });

    it("dynamically adapts hardcoded Cmd shortcuts on Windows systems", () => {
      // Legacy code with hardcoded 'Cmd+S'
      const windowsEvent = new KeyboardEvent("keydown", {
        key: "s",
        code: "KeyS",
        ctrlKey: true,
        metaKey: false,
      });

      expect(matchesShortcut(windowsEvent, "Cmd+S", false)).toBe(true);
    });

    it("matches combinations with Shift and Alt", () => {
      const buildEvent = new KeyboardEvent("keydown", {
        key: "B",
        code: "KeyB",
        ctrlKey: true,
        shiftKey: true,
      });

      expect(matchesShortcut(buildEvent, "Mod+Shift+B", false)).toBe(true);

      const missingShift = new KeyboardEvent("keydown", {
        key: "b",
        code: "KeyB",
        ctrlKey: true,
        shiftKey: false,
      });

      expect(matchesShortcut(missingShift, "Mod+Shift+B", false)).toBe(false);
    });

    it("matches single character Vim shortcuts like / and ?", () => {
      const slashEvent = new KeyboardEvent("keydown", {
        key: "/",
        code: "Slash",
      });
      expect(matchesShortcut(slashEvent, "/", false)).toBe(true);

      const questionEvent = new KeyboardEvent("keydown", {
        key: "?",
        shiftKey: true,
      });
      expect(matchesShortcut(questionEvent, "?", false)).toBe(true);
    });
  });

  describe("eventToShortcutString recording", () => {
    it("returns null for modifier-only key presses", () => {
      for (const mod of Array.from(MODIFIER_KEYS)) {
        const ev = new KeyboardEvent("keydown", { key: mod });
        expect(eventToShortcutString(ev)).toBeNull();
      }
    });

    it("creates canonical shortcut string on Windows", () => {
      const ev = new KeyboardEvent("keydown", {
        key: "s",
        code: "KeyS",
        ctrlKey: true,
      });
      expect(eventToShortcutString(ev, false)).toBe("Mod+S");
    });

    it("creates canonical shortcut string on macOS", () => {
      const ev = new KeyboardEvent("keydown", {
        key: "b",
        code: "KeyB",
        metaKey: true,
        shiftKey: true,
      });
      expect(eventToShortcutString(ev, true)).toBe("Mod+Shift+B");
    });
  });

  describe("Keymap Presets Integrity", () => {
    it("validates all built-in presets have required properties and unique IDs", () => {
      for (const [presetKey, list] of Object.entries(PRESET_MAP)) {
        expect(list.length).toBeGreaterThan(0);
        const ids = new Set<string>();
        for (const item of list) {
          expect(item.id).toBeTruthy();
          expect(item.label).toBeTruthy();
          expect(item.description).toBeTruthy();
          expect(item.defaultKey).toBeTruthy();
          expect(item.category).toBeTruthy();
          expect(ids.has(item.id)).toBe(false);
          ids.add(item.id);
        }
      }
    });

    it("has VSCode, Vim, and Sublime presets registered", () => {
      expect(PRESET_MAP.vscode).toBe(VSCODE_SHORTCUTS);
      expect(PRESET_MAP.vim).toBe(VIM_SHORTCUTS);
      expect(PRESET_MAP.sublime).toBe(SUBLIME_SHORTCUTS);
    });
  });

  describe("Storage Persistence Helpers", () => {
    beforeEach(() => {
      window.localStorage.clear();
    });

    it("saves and loads shortcut overrides safely", () => {
      expect(loadShortcutOverrides()).toEqual({});

      saveShortcutOverrides({ "editor.save": "Mod+Shift+S" });
      expect(loadShortcutOverrides()).toEqual({
        "editor.save": "Mod+Shift+S",
      });
    });

    it("saves and loads keymap preset safely", () => {
      expect(loadKeymapPreset()).toBe("vscode");

      saveKeymapPreset("vim");
      expect(loadKeymapPreset()).toBe("vim");

      saveKeymapPreset("sublime");
      expect(loadKeymapPreset()).toBe("sublime");
    });

    it("saves and loads Vim mode flag safely", () => {
      expect(loadVimModeEnabled()).toBe(false);

      saveVimModeEnabled(true);
      expect(loadVimModeEnabled()).toBe(true);

      saveVimModeEnabled(false);
      expect(loadVimModeEnabled()).toBe(false);
    });
  });
});
