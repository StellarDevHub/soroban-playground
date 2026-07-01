"use client";

import React, { useEffect, useState } from "react";
import type MonacoEditorComponent from "@monaco-editor/react";
import { scheduleEditorLoad, loadMonacoEditor } from "@/lib/editorLoadScheduler";
import { configureMonacoWorkers } from "@/lib/monacoWorkers";

interface EditorProps {
  code: string;
  setCode: (value: string) => void;
}

function EditorLoadingState() {
  return (
    <div className="flex items-center justify-center h-full w-full text-gray-500">
      <div className="flex flex-col items-center gap-3">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-500" />
        <span className="text-xs font-mono text-gray-400">Loading editor...</span>
      </div>
    </div>
  );
}

export default function Editor({ code, setCode }: EditorProps) {
  const [MonacoEditor, setMonacoEditor] = useState<typeof MonacoEditorComponent | null>(null);

  useEffect(() => {
    let mounted = true;

    const cancelLoad = scheduleEditorLoad(async () => {
      configureMonacoWorkers();
      const editorModule = await loadMonacoEditor();

      if (mounted) {
        setMonacoEditor(() => editorModule.default);
      }
    });

    return () => {
      mounted = false;
      cancelLoad();
    };
  }, []);

  return (
    <div className="relative h-[500px] w-full rounded-xl overflow-hidden border border-gray-800 bg-[#1e1e1e] shadow-2xl">
      {MonacoEditor ? (
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
            padding: { top: 16, bottom: 16 },
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            cursorBlinking: "smooth",
            cursorSmoothCaretAnimation: "on",
            formatOnPaste: true,
            wordWrap: "on",
            lineNumbers: "on",
            bracketPairColorization: { enabled: true },
            tabSize: 4,
            insertSpaces: true,
            renderLineHighlight: "all",
          }}
          loading={<EditorLoadingState />}
        />
      ) : (
        <EditorLoadingState />
      )}
    </div>
  );
}
