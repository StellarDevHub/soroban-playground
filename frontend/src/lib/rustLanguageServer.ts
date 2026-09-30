import { analyzeRustSyntax } from "@/lib/rustSyntax";

interface RustTextDocument {
  version: number;
  text: string;
}

type SendLspMessage = (message: Record<string, unknown>) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function createRustLanguageServer(send: SendLspMessage) {
  const documents = new Map<string, RustTextDocument>();

  const publishDiagnostics = (uri: string) => {
    const document = documents.get(uri);
    if (!document) return;

    const diagnostics = analyzeRustSyntax(document.text).map((diagnostic) => ({
      range: {
        start: {
          line: diagnostic.startLineNumber - 1,
          character: diagnostic.startColumn - 1,
        },
        end: {
          line: diagnostic.endLineNumber - 1,
          character: diagnostic.endColumn - 1,
        },
      },
      severity:
        diagnostic.severity === "error"
          ? 1
          : diagnostic.severity === "warning"
            ? 2
            : 3,
      source: "soroban-rust",
      message: diagnostic.message,
    }));

    send({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: { uri, version: document.version, diagnostics },
    });
  };

  return {
    handleMessage(rawMessage: unknown) {
      if (!isRecord(rawMessage)) return;
      const message = rawMessage;

      if (message.method === "initialize" && message.id !== undefined) {
        send({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            capabilities: { textDocumentSync: 1 },
            serverInfo: { name: "Soroban Rust Syntax Service", version: "1" },
          },
        });
        return;
      }

      if (message.method === "$/heartbeat" && message.id !== undefined) {
        send({ jsonrpc: "2.0", id: message.id, result: {} });
        return;
      }

      const params = isRecord(message.params) ? message.params : {};

      if (message.method === "textDocument/didOpen") {
        const textDocument = isRecord(params.textDocument)
          ? params.textDocument
          : {};
        if (typeof textDocument.uri !== "string") return;
        documents.set(textDocument.uri, {
          version: Number(textDocument.version ?? 0),
          text: String(textDocument.text ?? ""),
        });
        publishDiagnostics(textDocument.uri);
        return;
      }

      if (message.method === "textDocument/didChange") {
        const textDocument = isRecord(params.textDocument)
          ? params.textDocument
          : {};
        if (typeof textDocument.uri !== "string") return;
        const current = documents.get(textDocument.uri);
        const contentChanges = Array.isArray(params.contentChanges)
          ? params.contentChanges
          : [];
        const latestChange = contentChanges.length
          ? contentChanges[contentChanges.length - 1]
          : undefined;
        if (!current || !isRecord(latestChange) || typeof latestChange.text !== "string") return;
        documents.set(textDocument.uri, {
          version: Number(textDocument.version ?? current.version + 1),
          text: latestChange.text,
        });
        publishDiagnostics(textDocument.uri);
        return;
      }

      if (message.method === "textDocument/didClose") {
        const textDocument = isRecord(params.textDocument)
          ? params.textDocument
          : {};
        const uri = textDocument.uri;
        if (typeof uri !== "string") return;
        documents.delete(uri);
        send({
          jsonrpc: "2.0",
          method: "textDocument/publishDiagnostics",
          params: { uri, diagnostics: [] },
        });
        return;
      }

      if (message.method === "shutdown" && message.id !== undefined) {
        send({ jsonrpc: "2.0", id: message.id, result: null });
      }
    },
  };
}