import { createRustLanguageServer } from "@/lib/rustLanguageServer";

describe("Rust language server LSP protocol", () => {
  it("initializes, publishes versioned diagnostics, and clears them on close", () => {
    const send = jest.fn();
    const server = createRustLanguageServer(send);
    const uri = "file:///contract.rs";

    server.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { capabilities: {} },
    });
    expect(send).toHaveBeenLastCalledWith({
      jsonrpc: "2.0",
      id: 1,
      result: {
        capabilities: { textDocumentSync: 1 },
        serverInfo: { name: "Soroban Rust Syntax Service", version: "1" },
      },
    });

    server.handleMessage({
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: {
          uri,
          languageId: "rust",
          version: 3,
          text: "let value = 1];",
        },
      },
    });
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: "textDocument/publishDiagnostics",
        params: expect.objectContaining({ uri, version: 3 }),
      }),
    );
    expect(send.mock.calls.at(-1)?.[0].params.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 1,
          message: "Unmatched closing bracket ']'",
          range: {
            start: { line: 0, character: 13 },
            end: { line: 0, character: 14 },
          },
        }),
      ]),
    );

    server.handleMessage({
      jsonrpc: "2.0",
      method: "textDocument/didClose",
      params: { textDocument: { uri } },
    });
    expect(send).toHaveBeenLastCalledWith({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: { uri, diagnostics: [] },
    });
  });

  it("responds to the worker heartbeat request", () => {
    const send = jest.fn();
    const server = createRustLanguageServer(send);

    server.handleMessage({ jsonrpc: "2.0", id: 9, method: "$/heartbeat" });

    expect(send).toHaveBeenCalledWith({ jsonrpc: "2.0", id: 9, result: {} });
  });
});