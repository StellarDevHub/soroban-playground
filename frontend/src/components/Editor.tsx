"use client";

import React, { useEffect } from "react";
import MonacoEditor, { useMonaco } from "@monaco-editor/react";
import { MonacoLanguageClient } from "monaco-languageclient";
import { BrowserMessageReader, BrowserMessageWriter } from "vscode-languageserver-protocol/browser";

interface EditorProps {
  code: string;
  setCode: (value: string) => void;
}

export default function Editor({ code, setCode }: EditorProps) {
  const monaco = useMonaco();

  useEffect(() => {
    if (!monaco) return;

    // 1. Spawn the background worker
    const worker = new Worker(new URL("../workers/rust-analyzer.worker.ts", import.meta.url));
    worker.postMessage({ type: "init" });

    worker.onmessage = (e) => {
      if (e.data.type === "ready") {
        
        // 2. Bind Monaco to the Worker via LSP
        const reader = new BrowserMessageReader(worker);
        const writer = new BrowserMessageWriter(worker);

        const languageClient = new MonacoLanguageClient({
          name: "Rust Analyzer Wasm Client",
          clientOptions: { documentSelector: ["rust"] },
          messageTransports: { reader, writer }
        });

        languageClient.start();
      }
    };

    return () => {
      worker.terminate();
    };
  }, [monaco]);

  return (
    <div className="flex-1 rounded-xl overflow-hidden border border-gray-800 bg-[#1e1e1e] shadow-2xl">
      <MonacoEditor
        height="100%"
        width="100%"
        language="rust"
        theme="vs-dark"
        value={code}
        onChange={(val) => setCode(val || "")}
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          fontFamily: "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          padding: { top: 16, bottom: 16 },
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          cursorBlinking: "smooth",
          cursorSmoothCaretAnimation: "on",
          formatOnPaste: true,
        }}
        loading={
          <div className="flex items-center justify-center h-full w-full text-gray-500">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
          </div>
        }
      />
    </div>
  );
}
