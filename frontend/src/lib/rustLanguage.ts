import type * as monaco from "monaco-editor";

const LANGUAGE: monaco.languages.IMonarchLanguage = {
  defaultToken: "",
  tokenPostfix: ".rs",
  keywords: [
    "as", "async", "await", "break", "const", "continue", "crate",
    "dyn", "else", "enum", "extern", "false", "fn", "for", "if",
    "impl", "in", "let", "loop", "match", "mod", "move", "mut",
    "pub", "ref", "return", "self", "Self", "static", "struct",
    "super", "trait", "true", "type", "unsafe", "use", "where",
    "while", "yield",
  ],
  typeKeywords: [
    "bool", "char", "f32", "f64", "i8", "i16", "i32", "i64", "i128",
    "isize", "str", "u8", "u16", "u32", "u64", "u128", "usize",
  ],
  operators: [
    "=", ">", "<", "!", "~", "?", ":", "==", "<=", ">=", "!=", "&&",
    "||", "++", "--", "+", "-", "*", "/", "&", "|", "^", "%", "<<",
    ">>", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>=",
    "=>", "->", "..", "..=", "::",
  ],
  symbols: /[=><!~?:&|+\-*\/%^]+/,
  tokenizer: {
    root: [
      [/[ \t\r\n]+/, "white"],
      [/\/\*/, "comment", "@comment"],
      [/\/\/.*$/, "comment"],
      [/#\[.*\]/, "annotation"],
      [/b?"/, "string", "@string"],
      [/'(?:\\.|[^'\\])'/, "string"],
      [/[A-Z][\w$]*/, "type.identifier"],
      [/[a-zA-Z_$][\w$]*/, {
        cases: {
          "@keywords": "keyword",
          "@typeKeywords": "type",
          "@default": "identifier",
        },
      }],
      [/0[xX][\da-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|\d[\d_]*/, "number"],
      [/[{}()[\]]/, "@brackets"],
      [/[,;.]/, "delimiter"],
      [/@symbols/, {
        cases: {
          "@operators": "operator",
          "@default": "",
        },
      }],
    ],
    comment: [
      [/[^/*]+/, "comment"],
      [/\/\*/, "comment", "@push"],
      [/\*\//, "comment", "@pop"],
      [/[/*]/, "comment"],
    ],
    string: [
      [/[^\\"]+/, "string"],
      [/\\./, "string.escape"],
      [/"/, "string", "@pop"],
    ],
  },
};

const LANGUAGE_CONFIGURATION: monaco.languages.LanguageConfiguration = {
  comments: { lineComment: "//", blockComment: ["/*", "*/"] },
  brackets: [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
  ],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"' },
  ],
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"' },
  ],
};

const registeredMonacoInstances = new WeakSet<object>();

export function registerRustLanguage(monacoApi: typeof import("monaco-editor")) {
  if (registeredMonacoInstances.has(monacoApi)) return;

  if (!monacoApi.languages.getLanguages().some(({ id }) => id === "rust")) {
    monacoApi.languages.register({
      id: "rust",
      extensions: [".rs"],
      aliases: ["Rust", "rust"],
    });
  }

  monacoApi.languages.setMonarchTokensProvider("rust", LANGUAGE);
  monacoApi.languages.setLanguageConfiguration("rust", LANGUAGE_CONFIGURATION);
  registeredMonacoInstances.add(monacoApi);
}