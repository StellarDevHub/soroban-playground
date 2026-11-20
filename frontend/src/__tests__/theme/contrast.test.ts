import {
  WCAG_AA_LARGE,
  WCAG_AA_NORMAL,
  WCAG_AAA_NORMAL,
  contrastRatio,
  describeCheck,
  evaluateContrast,
  formatHslTriple,
  hslToHex,
  hslToRgb,
  parseHslTriple,
  relativeLuminance,
  wcagLevel,
} from "../../lib/theme/contrast";
import {
  CONTRAST_REQUIREMENTS,
  DARK_TOKENS,
  LIGHT_TOKENS,
  THEME_TOKENS,
} from "../../lib/theme/tokens";
import type { ThemeMode } from "../../lib/theme/types";

describe("HSL parsing", () => {
  it("parses a channel triple", () => {
    expect(parseHslTriple("217 59% 8%")).toEqual({ h: 217, s: 59, l: 8 });
  });

  it("normalises hue into [0, 360)", () => {
    expect(parseHslTriple("-30 50% 50%").h).toBe(330);
    expect(parseHslTriple("400 50% 50%").h).toBe(40);
  });

  it("round-trips through formatHslTriple", () => {
    expect(formatHslTriple(parseHslTriple("172 66% 50%"))).toBe("172 66% 50%");
  });

  it("rejects malformed or out-of-range values", () => {
    expect(() => parseHslTriple("#08111f")).toThrow(/Invalid HSL triple/);
    expect(() => parseHslTriple("217 59 8")).toThrow(/Invalid HSL triple/);
    expect(() => parseHslTriple("217 120% 8%")).toThrow(/saturation/);
    expect(() => parseHslTriple("217 59% 120%")).toThrow(/lightness/);
  });
});

describe("colour conversion", () => {
  const hexToRgb = (hex: string): [number, number, number] => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const maxChannelDelta = (a: string, b: string): number =>
    Math.max(
      ...hexToRgb(a).map((channel, index) =>
        Math.abs(channel - hexToRgb(b)[index]),
      ),
    );

  it("converts pure white and black exactly", () => {
    expect(hslToHex("0 0% 100%")).toBe("#ffffff");
    expect(hslToHex("0 0% 0%")).toBe("#000000");
    expect(hslToRgb("0 0% 100%")).toEqual([255, 255, 255]);
    expect(hslToRgb("0 0% 0%")).toEqual([0, 0, 0]);
  });

  it("stays within 3/255 per channel of the historical dark palette", () => {
    expect(
      maxChannelDelta(hslToHex(DARK_TOKENS.background), "#08111f"),
    ).toBeLessThanOrEqual(3);
    expect(
      maxChannelDelta(hslToHex(DARK_TOKENS.foreground), "#e6edf7"),
    ).toBeLessThanOrEqual(3);
  });

  it("gives the light theme a near-white background and near-black text", () => {
    expect(
      relativeLuminance(hslToRgb(LIGHT_TOKENS.background)),
    ).toBeGreaterThan(0.9);
    expect(relativeLuminance(hslToRgb(LIGHT_TOKENS.foreground))).toBeLessThan(
      0.03,
    );
  });

  it("emits a six-digit lowercase hex string for every token", () => {
    for (const tokens of [DARK_TOKENS, LIGHT_TOKENS]) {
      for (const value of Object.values(tokens)) {
        expect(hslToHex(value)).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });
});

describe("WCAG contrast maths", () => {
  it("matches the reference luminance of white and black", () => {
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 4);
    expect(relativeLuminance([0, 0, 0])).toBeCloseTo(0, 4);
  });

  it("returns the textbook 21:1 for black on white", () => {
    expect(contrastRatio("0 0% 0%", "0 0% 100%")).toBeCloseTo(21, 2);
  });

  it("is symmetric", () => {
    expect(contrastRatio(DARK_TOKENS.background, DARK_TOKENS.foreground)).toBeCloseTo(
      contrastRatio(DARK_TOKENS.foreground, DARK_TOKENS.background),
      6,
    );
  });

  it("classifies ratios into WCAG levels", () => {
    expect(wcagLevel(21)).toBe("AAA");
    expect(wcagLevel(WCAG_AAA_NORMAL)).toBe("AAA");
    expect(wcagLevel(WCAG_AA_NORMAL)).toBe("AA");
    expect(wcagLevel(WCAG_AA_LARGE)).toBe("AA-large");
    expect(wcagLevel(2)).toBe("fail");
  });
});

describe.each<ThemeMode>(["dark", "light", "high-contrast"])(
  "theme %s meets its contrast contract",
  (mode) => {
    const tokens = THEME_TOKENS[mode];
    const report = evaluateContrast(tokens, CONTRAST_REQUIREMENTS);

    it("passes every requirement", () => {
      const failures = report.checks
        .filter((check) => !check.passes)
        .map(describeCheck);
      expect(failures).toEqual([]);
      expect(report.passes).toBe(true);
    });

    it("reaches WCAG AAA (7:1) on the code surface", () => {
      const codeChecks = report.checks.filter((check) =>
        check.name.startsWith("Code "),
      );
      expect(codeChecks).toHaveLength(8);
      for (const check of codeChecks) {
        expect(check.ratio).toBeGreaterThanOrEqual(WCAG_AAA_NORMAL);
      }
    });

    it("reaches WCAG AAA (7:1) for body text", () => {
      for (const name of [
        "Body text on page background",
        "Body text on panel surface",
      ]) {
        const check = report.checks.find((entry) => entry.name === name);
        expect(check).toBeDefined();
        expect(check!.ratio).toBeGreaterThanOrEqual(WCAG_AAA_NORMAL);
      }
    });

    it("defines every token referenced by a requirement", () => {
      for (const requirement of CONTRAST_REQUIREMENTS) {
        expect(typeof tokens[requirement.foreground]).toBe("string");
        expect(typeof tokens[requirement.background]).toBe("string");
      }
    });
  },
);

describe("evaluateContrast", () => {
  it("reports which requirement failed", () => {
    const report = evaluateContrast(
      { ...DARK_TOKENS, codeComment: DARK_TOKENS.codeBackground },
      CONTRAST_REQUIREMENTS,
    );
    expect(report.passes).toBe(false);
    expect(
      report.checks.find((check) => check.name === "Code comment highlight")
        ?.passes,
    ).toBe(false);
    expect(report.checks[0].name).toBe("Body text on page background");
  });

  it("formats a readable summary", () => {
    const report = evaluateContrast(DARK_TOKENS, CONTRAST_REQUIREMENTS);
    expect(describeCheck(report.checks[0])).toMatch(
      /^(PASS|FAIL) \d+\.\d+:1 \(needs \d+(\.\d+)?:1, (AAA|AA|AA-large|fail)\) — /,
    );
  });
});
