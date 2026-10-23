/**
 * Spotlight keybinding preferences (issue #1725).
 *
 * Persistence, validation-on-read and the chord ⇄ event mapping. Everything
 * here has to survive a hand-edited localStorage entry without taking the
 * palette down.
 */

import {
  chordFromEvent,
  chordsMatch,
  effectiveChord,
  formatChord,
  isModifierOnly,
  loadKeybindingOverrides,
  saveKeybindingOverrides,
  SPOTLIGHT_KEYBINDINGS_STORAGE_KEY,
  type KeyChord,
} from "@/lib/spotlightKeybindings";

function keydown(init: Partial<KeyboardEventInit> & { key: string }) {
  return new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("load/save", () => {
  it("round-trips overrides", () => {
    const overrides: Record<string, KeyChord> = {
      "build.compile": ["Meta", "Shift", "KeyB"],
    };
    saveKeybindingOverrides(overrides);
    expect(loadKeybindingOverrides()).toEqual(overrides);
  });

  it("returns an empty record when nothing is stored", () => {
    expect(loadKeybindingOverrides()).toEqual({});
  });

  it("survives corrupt JSON", () => {
    window.localStorage.setItem(SPOTLIGHT_KEYBINDINGS_STORAGE_KEY, "{oops");
    expect(loadKeybindingOverrides()).toEqual({});
  });

  it("drops entries with invalid shapes but keeps valid ones", () => {
    window.localStorage.setItem(
      SPOTLIGHT_KEYBINDINGS_STORAGE_KEY,
      JSON.stringify({
        good: ["Meta", "KeyJ"],
        modifierOnly: ["Shift"],
        notArray: "Meta+KeyJ",
        tooLong: ["KeyA", "KeyB", "KeyC", "KeyD"],
        number: 42,
      }),
    );
    expect(loadKeybindingOverrides()).toEqual({
      good: ["Meta", "KeyJ"],
    });
  });
});

describe("effectiveChord", () => {
  const fallback: KeyChord = ["Meta", "Shift", "KeyB"];

  it("prefers the override", () => {
    expect(
      effectiveChord({ id: ["Meta", "KeyJ"] }, "id", fallback),
    ).toEqual(["Meta", "KeyJ"]);
  });

  it("falls back to the default when unbound", () => {
    expect(effectiveChord({}, "id", fallback)).toBe(fallback);
  });

  it("falls back when the override is invalid", () => {
    expect(
      effectiveChord({ id: ["Shift"] as unknown as KeyChord }, "id", fallback),
    ).toBe(fallback);
  });
});

describe("formatChord", () => {
  it("uses platform-appropriate rendering", () => {
    // jsdom reports a non-Apple platform, so the ASCII form is expected.
    expect(formatChord(["Meta", "KeyK"])).toBe("Win+K");
    expect(formatChord(["Control", "Shift", "KeyB"])).toBe("Ctrl+Shift+B");
    expect(formatChord(["Shift", "KeyS"])).toBe("Shift+S");
  });

  it("names special keys", () => {
    expect(formatChord(["Enter"])).toBe("↵");
    expect(formatChord(["ArrowDown"])).toBe("↓");
    expect(formatChord(["Escape"])).toBe("Esc");
    expect(formatChord(["F5"])).toBe("F5");
  });

  it("returns undefined for empty or modifier-only chords", () => {
    expect(formatChord(undefined)).toBeUndefined();
    expect(formatChord([])).toBeUndefined();
    expect(formatChord(["Shift"])).toBeUndefined();
  });
});

describe("chordFromEvent", () => {
  it("returns null for a bare modifier press", () => {
    expect(chordFromEvent(keydown({ key: "Shift", code: "ShiftLeft", shiftKey: true }))).toBeNull();
    expect(chordFromEvent(keydown({ key: "Meta", code: "MetaLeft", metaKey: true }))).toBeNull();
  });

  it("captures modifiers plus the physical key", () => {
    expect(chordFromEvent(keydown({ key: "k", code: "KeyK", metaKey: true }))).toEqual([
      "Meta",
      "KeyK",
    ]);
    expect(
      chordFromEvent(
        keydown({ key: "b", code: "KeyB", ctrlKey: true, shiftKey: true }),
      ),
    ).toEqual(["Control", "Shift", "KeyB"]);
  });

  it("falls back to event.key when code is unavailable", () => {
    const event = keydown({ key: "s" });
    Object.defineProperty(event, "code", { value: "" });
    expect(chordFromEvent(event)).toEqual(["s"]);
  });
});

describe("chordsMatch", () => {
  it("matches regardless of modifier order", () => {
    expect(chordsMatch(["Meta", "Shift", "KeyB"], ["Shift", "Meta", "KeyB"])).toBe(true);
    expect(chordsMatch(["Meta", "KeyB"], ["Control", "KeyB"])).toBe(false);
  });
});

describe("isModifierOnly", () => {
  it("detects chords with no printable key", () => {
    expect(isModifierOnly([])).toBe(true);
    expect(isModifierOnly(["Shift", "Control"])).toBe(true);
    expect(isModifierOnly(["Shift", "KeyS"])).toBe(false);
  });
});
