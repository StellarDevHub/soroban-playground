import {
  THEME_ATTRIBUTE,
  THEME_BOOTSTRAP_SCRIPT,
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
  applyTheme,
  createThemeController,
  getAppliedTheme,
  getAppliedTokens,
  readStoredPreference,
  resolveThemeMode,
  resolveThemeState,
  systemTheme,
  validateTheme,
  writeStoredPreference,
} from "../../lib/theme/engine";
import {
  DARK_TOKENS,
  HIGH_CONTRAST_TOKENS,
  LIGHT_TOKENS,
} from "../../lib/theme/tokens";

/** Minimal in-memory `Storage` so tests never touch the real localStorage. */
function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
  } as Storage;
}

/** A `matchMedia` implementation that reports OS preferences accurately. */
function fakeMatchMedia(dark: boolean, highContrast: boolean = false) {
  return ((query: string) =>
    ({
      matches:
        query.includes("forced-colors") || query.includes("prefers-contrast")
          ? highContrast
          : query.includes("prefers-color-scheme")
            ? dark
            : false,
      media: query,
      onchange: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }) as unknown as MediaQueryList) as (query: string) => MediaQueryList;
}

describe("theme preference resolution", () => {
  it("pins an explicit preference regardless of the OS theme", () => {
    expect(resolveThemeMode("light", "dark")).toBe("light");
    expect(resolveThemeMode("dark", "light")).toBe("dark");
  });

  it("follows the OS theme when the preference is system", () => {
    expect(resolveThemeMode("system", "dark")).toBe("dark");
    expect(resolveThemeMode("system", "light")).toBe("light");
  });

  it("reads the OS preference from matchMedia", () => {
    expect(systemTheme(fakeMatchMedia(true))).toBe("dark");
    expect(systemTheme(fakeMatchMedia(false))).toBe("light");
    expect(systemTheme(fakeMatchMedia(false, true))).toBe("high-contrast");
  });

  it("falls back to dark when matchMedia is unavailable", () => {
    expect(systemTheme(null as unknown as (q: string) => MediaQueryList)).toBe(
      "dark",
    );
  });

  it("defaults to the OS theme for a first-time visitor", () => {
    const state = resolveThemeState(fakeStorage(), fakeMatchMedia(false));
    expect(state).toEqual({ preference: "system", mode: "light", source: "system" });
  });

  it("honours a stored preference", () => {
    const state = resolveThemeState(
      fakeStorage({ [THEME_STORAGE_KEY]: "light" }),
      fakeMatchMedia(true),
    );
    expect(state).toEqual({ preference: "light", mode: "light", source: "stored" });
  });

  it("follows the OS when the stored preference is system", () => {
    const state = resolveThemeState(
      fakeStorage({ [THEME_STORAGE_KEY]: "system" }),
      fakeMatchMedia(true),
    );
    expect(state).toEqual({ preference: "system", mode: "dark", source: "system" });
  });

  it("ignores a corrupt stored value", () => {
    const state = resolveThemeState(
      fakeStorage({ [THEME_STORAGE_KEY]: "solarized" }),
      fakeMatchMedia(true),
    );
    expect(state.source).toBe("system");
  });
});

describe("preference persistence", () => {
  it("reads back what it writes", () => {
    const storage = fakeStorage();
    writeStoredPreference("dark", storage);
    expect(readStoredPreference(storage)).toBe("dark");
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("migrates and clears the legacy key", () => {
    const storage = fakeStorage({ "sp-theme": "light" });
    expect(readStoredPreference(storage)).toBe("light");
    writeStoredPreference("dark", storage);
    expect(storage.getItem("sp-theme")).toBeNull();
  });

  it("returns null when nothing is stored", () => {
    expect(readStoredPreference(fakeStorage())).toBeNull();
  });

  it("never throws when storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(readStoredPreference(blocked)).toBeNull();
    expect(() => writeStoredPreference("light", blocked)).not.toThrow();
  });
});

describe("applying a theme to the document", () => {
  afterEach(() => {
    document.documentElement.removeAttribute(THEME_ATTRIBUTE);
  });

  it("writes the data-theme attribute", () => {
    expect(applyTheme("light")).toBe("light");
    expect(getAppliedTheme()).toBe("light");
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe("light");
  });

  it("applies the matching token set", () => {
    applyTheme("dark");
    expect(getAppliedTokens()).toBe(DARK_TOKENS);
    applyTheme("light");
    expect(getAppliedTokens()).toBe(LIGHT_TOKENS);
    applyTheme("high-contrast");
    expect(getAppliedTokens()).toBe(HIGH_CONTRAST_TOKENS);
  });

  it("reports null before any theme has been applied", () => {
    document.documentElement.removeAttribute(THEME_ATTRIBUTE);
    expect(getAppliedTheme()).toBeNull();
  });

  it("tolerates a missing document (SSR)", () => {
    expect(applyTheme("light", null)).toBe("light");
    expect(getAppliedTheme(null)).toBeNull();
    expect(getAppliedTokens(undefined as unknown as Document)).toBe(DARK_TOKENS);
  });
});

describe("contrast validation", () => {
  it("passes for all shipped themes including WCAG AAA high contrast", () => {
    expect(validateTheme("dark").passes).toBe(true);
    expect(validateTheme("light").passes).toBe(true);
    expect(validateTheme("high-contrast").passes).toBe(true);
  });
});

describe("bootstrap script", () => {
  it("is syntactically valid JavaScript", () => {
    expect(() => new Function(THEME_BOOTSTRAP_SCRIPT)).not.toThrow();
  });

  it("knows the storage key, the legacy key and the attribute", () => {
    expect(THEME_BOOTSTRAP_SCRIPT).toContain(THEME_STORAGE_KEY);
    expect(THEME_BOOTSTRAP_SCRIPT).toContain("sp-theme");
    expect(THEME_BOOTSTRAP_SCRIPT).toContain(THEME_ATTRIBUTE);
    expect(THEME_BOOTSTRAP_SCRIPT).toContain("prefers-color-scheme");
    expect(THEME_BOOTSTRAP_SCRIPT).toContain("high-contrast");
  });
});

describe("createThemeController", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute(THEME_ATTRIBUTE);
  });

  it("applies the resolved theme on creation", () => {
    const controller = createThemeController();
    expect(getAppliedTheme()).toBe(controller.getState().mode);
    controller.destroy();
  });

  it("persists and applies an explicit preference", () => {
    const controller = createThemeController();
    const next = controller.setPreference("light");

    expect(next.preference).toBe("light");
    expect(next.mode).toBe("light");
    expect(next.source).toBe("stored");
    expect(getAppliedTheme()).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    controller.destroy();
  });

  it("toggles between light and dark", () => {
    const controller = createThemeController();
    controller.setPreference("dark");

    expect(controller.toggle().mode).toBe("light");
    expect(controller.toggle().mode).toBe("dark");
    controller.destroy();
  });

  it("notifies subscribers and stops after unsubscribe", () => {
    const controller = createThemeController();
    const listener = jest.fn();
    const unsubscribe = controller.subscribe(listener);

    controller.setPreference("light");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ preference: "light", mode: "light" }),
    );

    unsubscribe();
    controller.setPreference("dark");
    expect(listener).toHaveBeenCalledTimes(1);
    controller.destroy();
  });

  it("emits a theme change event on the document", () => {
    const controller = createThemeController();
    const listener = jest.fn();
    document.addEventListener(THEME_CHANGE_EVENT, listener);

    controller.setPreference("dark");
    expect(listener).toHaveBeenCalledTimes(1);

    document.removeEventListener(THEME_CHANGE_EVENT, listener);
    controller.destroy();
  });

  it("can be destroyed twice without throwing", () => {
    const controller = createThemeController();
    expect(() => {
      controller.destroy();
      controller.destroy();
    }).not.toThrow();
  });
});
