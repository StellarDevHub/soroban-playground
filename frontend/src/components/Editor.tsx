"use client";

import React from "react";
import MonacoEditor from "@monaco-editor/react";

interface EditorProps {
  code: string;
  setCode: (value: string) => void;
}

export default function Editor({ code, setCode }: EditorProps) {
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
