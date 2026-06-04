"use client";

import React, { useState } from "react";
import { Code2, Terminal } from "lucide-react";

interface MobileEditorProps {
  editor: React.ReactNode;
  output: React.ReactNode;
}

export default function MobileEditor({ editor, output }: MobileEditorProps) {
  const [activeTab, setActiveTab] = useState<"editor" | "output">("editor");

  const editorTabId = "mobile-editor-tab";
  const outputTabId = "mobile-output-tab";
  const editorPanelId = "mobile-editor-panel";
  const outputPanelId = "mobile-output-panel";

  return (
    <>
      {/* Desktop: render children in the existing grid layout */}
      <div className="hidden lg:contents">
        {editor}
        {output}
      </div>

      {/* Mobile / Tablet: tabbed layout */}
      <div className="flex flex-col lg:hidden h-[calc(100vh-4rem)] overflow-hidden">
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

        {/* Tab bar at bottom */}
        <div
          className="flex shrink-0 border-t border-slate-800/60 bg-slate-950/90 backdrop-blur-md"
          role="tablist"
          aria-label="Editor sections"
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
            <Code2 size={16} />
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
            <Terminal size={16} />
            Output
          </button>
        </div>
      </div>
    </>
  );
}
