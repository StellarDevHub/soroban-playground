"use client";

import React, { useCallback, useState } from "react";
import { Code2, Terminal } from "lucide-react";
import SplitPane from "@/components/layout/SplitPane";
import { HapticVirtualKeyboard } from "@/components/Mobile/HapticVirtualKeyboard";
import { useVirtualKeyboard } from "@/hooks/useVirtualKeyboard";

interface MobileEditorProps {
  editor: React.ReactNode;
  output: React.ReactNode;
  /**
   * Optional ref to the underlying Monaco editor instance so the haptic key
   * bar can insert text at the current cursor position.
   * When not supplied the bar is still rendered but insertions are no-ops.
   */
  editorRef?: React.RefObject<{ trigger: (source: string, handlerId: string, payload: unknown) => void } | null>;
}

MobileEditor.displayName = "MobileEditor";

export default function MobileEditor({ editor, output, editorRef }: MobileEditorProps) {
  const [activeTab, setActiveTab] = useState<"editor" | "output">("editor");
  const { isOpen: _keyboardOpen } = useVirtualKeyboard();

  const editorTabId = "mobile-editor-tab";
  const outputTabId = "mobile-output-tab";
  const editorPanelId = "mobile-editor-panel";
  const outputPanelId = "mobile-output-panel";

  /**
   * Insert text at the Monaco editor's current cursor position.
   * Falls back to a no-op when the editor ref is not wired up.
   */
  const handleInsert = useCallback(
    (text: string, cursorOffset?: number) => {
      const editor = editorRef?.current;
      if (!editor || typeof editor.trigger !== "function") return;
      // Use the built-in Monaco paste command to insert text at the cursor.
      editor.trigger("haptic-keyboard", "type", { text });
      // If the key pair needs the cursor placed inside (e.g. `{}` → `{|}`)
      // move left by the complement after insertion.
      if (cursorOffset !== undefined && cursorOffset < text.length) {
        const steps = text.length - cursorOffset;
        for (let i = 0; i < steps; i++) {
          editor.trigger("haptic-keyboard", "cursorLeft", null);
        }
      }
    },
    [editorRef],
  );

  return (
    <>
      {/* Desktop: adjustable, draggable split-pane container */}
      <div className="hidden lg:block">
        <SplitPane
          direction="horizontal"
          defaultSize={760}
          minSize={420}
          maxSize={1100}
          storageKey="soroban.playground.split.editor-output"
          label="Resize editor and output panels"
          className="h-[calc(100vh-13rem)] min-h-[620px]"
          first={editor}
          second={<div className="h-full overflow-y-auto">{output}</div>}
        />
      </div>

      {/* Mobile / Tablet: tabbed layout with dvh-aware height */}
      <div
        className="flex flex-col lg:hidden editor-mobile-height overflow-hidden"
        data-testid="mobile-editor-container"
      >
        {/* Tab content panels */}
        <div className="flex-1 overflow-hidden">
          <div
            role="tabpanel"
            id={editorPanelId}
            aria-labelledby={editorTabId}
            className={`h-full overflow-auto ${activeTab === "editor" ? "block" : "hidden"}`}
          >
            {editor}
          </div>
          <div
            role="tabpanel"
            id={outputPanelId}
            aria-labelledby={outputTabId}
            className={`h-full overflow-auto ${activeTab === "output" ? "block" : "hidden"}`}
          >
            {output}
          </div>
        </div>

        {/*
         * Haptic quick-access key bar — only shown when:
         *   • the editor tab is active, AND
         *   • the virtual keyboard is open (or on a touch device generally)
         *
         * The bar sits above the tab strip so code symbols are reachable
         * without dismissing the keyboard.
         */}
        {activeTab === "editor" && (
          <HapticVirtualKeyboard
            onInsert={handleInsert}
            aria-label="Quick-access code symbols"
            data-testid="haptic-key-bar"
          />
        )}

        {/* Tab bar — mobile-bottom-bar adds safe-area padding for iOS home indicator */}
        <div
          className="flex shrink-0 border-t border-slate-800/60 bg-slate-950/90 backdrop-blur-md mobile-bottom-bar"
          role="tablist"
          aria-label="Editor sections"
          data-testid="mobile-tab-bar"
        >
          <button
            role="tab"
            id={editorTabId}
            aria-controls={editorPanelId}
            aria-selected={activeTab === "editor"}
            onClick={() => setActiveTab("editor")}
            className={`flex-1 flex items-center justify-center gap-2 min-h-[44px] text-xs font-semibold uppercase tracking-wider transition-colors ${
              activeTab === "editor"
                ? "text-teal-400 border-t-2 border-teal-400 bg-teal-500/5"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            <Code2 size={16} aria-hidden="true" />
            Editor
          </button>
          <button
            role="tab"
            id={outputTabId}
            aria-controls={outputPanelId}
            aria-selected={activeTab === "output"}
            onClick={() => setActiveTab("output")}
            className={`flex-1 flex items-center justify-center gap-2 min-h-[44px] text-xs font-semibold uppercase tracking-wider transition-colors ${
              activeTab === "output"
                ? "text-teal-400 border-t-2 border-teal-400 bg-teal-500/5"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            <Terminal size={16} aria-hidden="true" />
            Output
          </button>
        </div>
      </div>
    </>
  );
}
