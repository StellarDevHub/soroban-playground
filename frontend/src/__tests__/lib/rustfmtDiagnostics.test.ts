import {
  parseRustfmtDiagnostic,
  parseRustfmtToml,
  applyRustfmtHeuristics,
  formatRustWithHeuristics,
} from "@/lib/rustfmtDiagnostics";

describe("rustfmtDiagnostics and heuristics engine", () => {
  describe("parseRustfmtDiagnostic", () => {
    it("maps rustfmt parse locations to Monaco coordinates", () => {
      expect(
        parseRustfmtDiagnostic(
          "error: expected `;`\n --> input.rs:8:13",
        ),
      ).toEqual({
        startLineNumber: 8,
        startColumn: 13,
        message: "error: expected `;`\n --> input.rs:8:13",
      });
    });

    it("does not report formatter runtime failures as source errors", () => {
      expect(
        parseRustfmtDiagnostic("rustfmt crashed while formatting"),
      ).toBeUndefined();
    });
  });

  describe("parseRustfmtToml", () => {
    it("parses user-configurable heuristics from rustfmt.toml string", () => {
      const toml = `
# Rustfmt Configuration
tab_spaces = 2
max_width = 80
edition = "2021"
struct_lit_single_line = true
struct_field_align_threshold = 20
newline_style = "Unix"
reorder_imports = true
`;
      const config = parseRustfmtToml(toml);
      expect(config.tab_spaces).toBe(2);
      expect(config.max_width).toBe(80);
      expect(config.edition).toBe("2021");
      expect(config.struct_lit_single_line).toBe(true);
      expect(config.struct_field_align_threshold).toBe(20);
      expect(config.newline_style).toBe("Unix");
      expect(config.reorder_imports).toBe(true);
    });

    it("ignores comments and whitespace gracefully", () => {
      const toml = `
# Comment line
tab_spaces = 4 # inline comment
`;
      const config = parseRustfmtToml(toml);
      expect(config.tab_spaces).toBe(4);
    });
  });

  describe("applyRustfmtHeuristics", () => {
    it("normalizes tab characters into configured spaces", () => {
      const input = "\tfn test() {\n\t\tlet x = 1;\n\t}";
      const output = applyRustfmtHeuristics(input, { tab_spaces: 2 });
      expect(output).toContain("  fn test() {");
      expect(output).toContain("    let x = 1;");
    });

    it("aligns struct fields when struct_field_align_threshold is enabled", () => {
      const input = `struct Example {
    short: u32,
    very_long_field_name: String,
}`;
      const output = applyRustfmtHeuristics(input, {
        struct_field_align_threshold: 30,
      });
      expect(output).toContain("short:                u32,");
      expect(output).toContain("very_long_field_name: String,");
    });
  });

  describe("formatRustWithHeuristics performance benchmark", () => {
    it("executes formatting in sub-50ms on large contracts (>500 lines)", () => {
      // Generate 600 lines of contract structs and functions
      let largeContract = "#![no_std]\nuse soroban_sdk::{contract, contractimpl, Env, Symbol};\n\n";
      for (let i = 0; i < 150; i++) {
        largeContract += `struct StateEntry${i} {\n\tpub id: u32,\n\tpub balance: i128,\n}\n\n`;
        largeContract += `fn process_item_${i}(env: &Env, val: u32) -> i128 {\n\tlet multiplier = ${i};\n\tval as i128 * multiplier\n}\n\n`;
      }

      const { formatted, executionTimeMs } = formatRustWithHeuristics(largeContract, {
        tab_spaces: 4,
        struct_field_align_threshold: 20,
      });

      expect(formatted).toBeDefined();
      expect(formatted.length).toBeGreaterThan(0);
      expect(executionTimeMs).toBeLessThan(50);
    });
  });
});
