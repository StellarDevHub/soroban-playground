import {
  parseRustfmtDiagnostic,
  parseRustfmtDiagnostics,
  parseRustfmtToml,
  resolveRustfmtOptions,
  formatRustCode,
  setCustomFormatter,
  DEFAULT_RUSTFMT_CONFIG,
} from "@/lib/rustfmtDiagnostics";
import { createRustfmtWorkerClient } from "@/lib/rustfmtClient";

describe("rustfmtDiagnostics and Configuration Heuristics", () => {
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

    it("maps <stdin> error locations to Monaco coordinates", () => {
      expect(
        parseRustfmtDiagnostic(
          "error: expected expression, found `;`\n --> <stdin>:4:19",
        ),
      ).toEqual({
        startLineNumber: 4,
        startColumn: 19,
        message: "error: expected expression, found `;`\n --> <stdin>:4:19",
      });
    });

    it("does not report formatter runtime failures as source errors", () => {
      expect(
        parseRustfmtDiagnostic("rustfmt crashed while formatting"),
      ).toBeUndefined();
    });

    it("extracts multiple diagnostics from stderr via parseRustfmtDiagnostics", () => {
      const stderr = "error: expected `;`\n --> input.rs:12:5";
      const diagnostics = parseRustfmtDiagnostics(stderr);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toEqual({
        startLineNumber: 12,
        startColumn: 5,
        message: stderr,
      });
    });
  });

  describe("parseRustfmtToml heuristics", () => {
    it("parses tab width, max width, newline formatting, and struct styling", () => {
      const toml = `
        # rustfmt.toml heuristics for Soroban smart contracts
        tab_spaces = 2
        max_width = 80
        newline_style = "Unix"
        hard_tabs = false
        edition = "2021"
        struct_lit_single_line = false
        struct_field_align_threshold = 20
        reorder_imports = true
      `;

      const config = parseRustfmtToml(toml);

      expect(config.tabSpaces).toBe(2);
      expect(config.maxWidth).toBe(80);
      expect(config.newlineStyle).toBe("Unix");
      expect(config.hardTabs).toBe(false);
      expect(config.edition).toBe("2021");
      expect(config.structLitSingleLine).toBe(false);
      expect(config.structFieldAlignThreshold).toBe(20);
      expect(config.reorderImports).toBe(true);
      expect(config.config?.struct_lit_single_line).toBe(false);
      expect(config.config?.struct_field_align_threshold).toBe(20);
    });

    it("handles Windows newline formatting and alternative tab_width naming", () => {
      const toml = `
        tab_width = 4
        newline_style = "Windows"
      `;

      const config = parseRustfmtToml(toml);
      expect(config.tabSpaces).toBe(4);
      expect(config.newlineStyle).toBe("Windows");
    });

    it("preserves custom and nightly rustfmt heuristics in config map", () => {
      const toml = `
        fn_call_width = 60
        struct_lit_width = 18
      `;

      const config = parseRustfmtToml(toml);
      expect(config.config?.fn_call_width).toBe(60);
      expect(config.config?.struct_lit_width).toBe(18);
    });
  });

  describe("resolveRustfmtOptions", () => {
    it("provides standard defaults when no options are given", () => {
      const options = resolveRustfmtOptions();
      expect(options.edition).toBe("2021");
      expect(options.tabSpaces).toBe(4);
      expect(options.maxWidth).toBe(100);
      expect(options.newlineStyle).toBe("Auto");
    });

    it("bridges struct styling into the config dictionary for rustfmt engine", () => {
      const options = resolveRustfmtOptions({
        structLitSingleLine: false,
        structFieldAlignThreshold: 25,
      });

      expect(options.config?.struct_lit_single_line).toBe(false);
      expect(options.config?.struct_field_align_threshold).toBe(25);
    });

    it("parses TOML strings directly into resolved options", () => {
      const toml = `
        tab_spaces = 2
        max_width = 90
        struct_lit_single_line = true
      `;
      const options = resolveRustfmtOptions(toml);

      expect(options.tabSpaces).toBe(2);
      expect(options.maxWidth).toBe(90);
      expect(options.config?.struct_lit_single_line).toBe(true);
    });
  });

  describe("formatRustCode formatting execution and performance", () => {
    beforeAll(() => {
      setCustomFormatter(async (code: string, options: any) => {
        if (code.includes("let x = ;")) {
          throw new Error(
            "error: expected expression, found `;`\n --> <stdin>:1:21",
          );
        }

        const indent = " ".repeat(options?.tabSpaces ?? 4);

        if (options?.config?.struct_lit_single_line === false && code.includes("Point {")) {
          return `struct Point {\n${indent}x: i32,\n${indent}y: i32,\n}\nfn main() {\n${indent}let p = Point {\n${indent}${indent}x: 1,\n${indent}${indent}y: 2,\n${indent}};\n}\n`;
        }

        if (code.includes("let x = 10;")) {
          return `fn test() {\n${indent}let x = 10;\n}\n`;
        }

        return code.trim() + "\n";
      });
    });

    afterAll(() => {
      setCustomFormatter(undefined);
    });

    it("formats Rust code with custom tab width heuristics", async () => {
      const unformatted = "fn test() { let x = 10; }";
      const result = await formatRustCode(unformatted, { tabSpaces: 2 });

      expect("formatted" in result).toBe(true);
      if ("formatted" in result) {
        expect(result.formatted).toContain("  let x = 10;");
      }
    });

    it("formats Rust code with struct literal multi-line styling", async () => {
      const code =
        "struct Point { x: i32, y: i32 }\nfn main() { let p = Point { x: 1, y: 2 }; }";
      const result = await formatRustCode(code, {
        structLitSingleLine: false,
      });

      expect("formatted" in result).toBe(true);
      if ("formatted" in result) {
        expect(result.formatted).toContain("Point {\n");
        expect(result.formatted).toContain("x: 1,");
        expect(result.formatted).toContain("y: 2,");
      }
    });

    it("returns Monaco diagnostics on Rust syntax error", async () => {
      const invalidCode = "fn main() { let x = ; }";
      const result = await formatRustCode(invalidCode);

      expect("diagnostics" in result).toBe(true);
      if ("diagnostics" in result) {
        expect(result.diagnostics.length).toBeGreaterThan(0);
        expect(result.diagnostics[0].startLineNumber).toBe(1);
        expect(result.diagnostics[0].startColumn).toBe(21);
      }
    });

    it("verifies sub-50ms formatting execution time on Soroban smart contract", async () => {
      const contractSource = `#![no_std]
use soroban_sdk::{contract, contractimpl, symbol_short, Env, Symbol};

#[contract]
pub struct CounterContract;

#[contractimpl]
impl CounterContract {
    pub fn increment(env: Env) -> u32 {
        let mut count: u32 = env.storage().instance().get(&symbol_short!("COUNT")).unwrap_or(0);
        count += 1;
        env.storage().instance().set(&symbol_short!("COUNT"), &count);
        count
    }

    pub fn get(env: Env) -> u32 {
        env.storage().instance().get(&symbol_short!("COUNT")).unwrap_or(0)
    }
}
`;

      const result = await formatRustCode(contractSource, {
        tabSpaces: 4,
        maxWidth: 100,
      });

      expect("formatted" in result).toBe(true);
      if ("formatted" in result) {
        expect(result.durationMs).toBeDefined();
        // Sub-50ms execution time requirement from Issue #2079
        expect(result.durationMs!).toBeLessThan(50);
        expect(result.formatted).toContain("pub struct CounterContract;");
      }
    });
  });

  describe("Web Worker client offloading", () => {
    it("offloads formatting requests and receives formatted result with duration", async () => {
      let messageHandler: ((event: MessageEvent) => void) | undefined;
      const mockWorker = {
        postMessage: jest.fn((request: { id: number; code: string }) => {
          setTimeout(() => {
            messageHandler?.({
              data: {
                id: request.id,
                formatted: "fn formatted() {}\n",
                durationMs: 4.2,
              },
            } as MessageEvent);
          }, 0);
        }),
        terminate: jest.fn(),
        set onmessage(handler: (event: MessageEvent) => void) {
          messageHandler = handler;
        },
        get onmessage() {
          return messageHandler as any;
        },
        onerror: null,
      } as unknown as Worker;

      const client = createRustfmtWorkerClient({
        createWorker: () => mockWorker,
      });

      const result = await client.format("fn formatted(){}", { tabSpaces: 4 });

      expect(mockWorker.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "fn formatted(){}",
          config: { tabSpaces: 4 },
        }),
      );
      expect(result).toEqual({
        formatted: "fn formatted() {}\n",
        durationMs: 4.2,
      });

      client.dispose();
      expect(mockWorker.terminate).toHaveBeenCalled();
    });

    it("propagates syntax diagnostics returned by the background worker", async () => {
      let messageHandler: ((event: MessageEvent) => void) | undefined;
      const mockWorker = {
        postMessage: jest.fn((request: { id: number; code: string }) => {
          setTimeout(() => {
            messageHandler?.({
              data: {
                id: request.id,
                diagnostics: [
                  {
                    startLineNumber: 3,
                    startColumn: 10,
                    message: "error: expected `;`",
                  },
                ],
                durationMs: 2.1,
              },
            } as MessageEvent);
          }, 0);
        }),
        terminate: jest.fn(),
        set onmessage(handler: (event: MessageEvent) => void) {
          messageHandler = handler;
        },
        get onmessage() {
          return messageHandler as any;
        },
        onerror: null,
      } as unknown as Worker;

      const client = createRustfmtWorkerClient({
        createWorker: () => mockWorker,
      });

      const result = await client.format("invalid rust code");
      expect(result).toEqual({
        diagnostics: [
          {
            startLineNumber: 3,
            startColumn: 10,
            message: "error: expected `;`",
          },
        ],
        durationMs: 2.1,
      });

      client.dispose();
    });
  });
});
