import { registerRustLanguage } from "@/lib/rustLanguage";
import { analyzeRustSyntax } from "@/lib/rustSyntax";

describe("Rust language support", () => {
  it("ignores delimiters in strings and nested comments", () => {
    const diagnostics = analyzeRustSyntax(
      'fn main() { let text = r##"} ] /* not a comment */"##; /* outer /* nested */ ] still comment */ }',
    );

    expect(diagnostics).toEqual([]);
  });

  it("reports mismatched and unclosed delimiters with source positions", () => {
    const diagnostics = analyzeRustSyntax("fn main() {\n  let value = (1];\n}");

    expect(diagnostics).toEqual(
      [
        expect.objectContaining({
          startLineNumber: 2,
          startColumn: 17,
          severity: "error",
          message: "Unmatched closing bracket ']'",
        }),
      ],
    );

    expect(analyzeRustSyntax("let value = (")).toEqual([
      expect.objectContaining({
        startLineNumber: 1,
        startColumn: 13,
        message: "Unclosed opening bracket '('",
      }),
    ]);
  });

  it("registers Rust tokenization and editor configuration once", () => {
    const monacoApi = {
      languages: {
        getLanguages: jest.fn(() => []),
        register: jest.fn(),
        setMonarchTokensProvider: jest.fn(),
        setLanguageConfiguration: jest.fn(),
      },
    } as unknown as typeof import("monaco-editor");

    registerRustLanguage(monacoApi);
    registerRustLanguage(monacoApi);

    expect(monacoApi.languages.register).toHaveBeenCalledTimes(1);
    expect(monacoApi.languages.setMonarchTokensProvider).toHaveBeenCalledTimes(1);
    expect(monacoApi.languages.setLanguageConfiguration).toHaveBeenCalledTimes(1);
  });
});