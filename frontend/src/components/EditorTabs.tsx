"use client";

import React, { useEffect, useCallback, useRef } from "react";
import { Plus, X, Undo2, Redo2, AlertCircle, FileCode } from "lucide-react";
import { useWorkspaceEditorStore } from "@/state/workspaceStore";

interface EditorTabsProps {
  className?: string;
  onTabChange?: (tabId: string) => void;
  onTabClose?: (tabId: string) => void;
  onNewTab?: () => void;
}

export const EditorTabs: React.FC<EditorTabsProps> = ({
  className = "",
  onTabChange,
  onTabClose,
  onNewTab,
}) => {
  const {
    tabs,
    activeTabId,
    setActiveTab,
    closeTab,
    openTab,
    undo,
    redo,
    isEmergencyDumpAvailable,
    emergencyDumpToLocalStorage,
    restoreFromEmergencyDump,
    clearEmergencyDump,
    checkEmergencyDumpAvailability,
  } = useWorkspaceEditorStore();

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Check for existing emergency recovery dump on mount
  useEffect(() => {
    checkEmergencyDumpAvailability();
  }, [checkEmergencyDumpAvailability]);

  // Debounce emergency dump to localStorage whenever tabs or content change
  useEffect(() => {
    const hasDirtyTabs = tabs.some((t) => t.isDirty);
    if (!hasDirtyTabs) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      emergencyDumpToLocalStorage();
    }, 1200);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [tabs, emergencyDumpToLocalStorage]);

  // Save emergency snapshot on window unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      const hasDirtyTabs = useWorkspaceEditorStore.getState().tabs.some((t) => t.isDirty);
      if (hasDirtyTabs) {
        useWorkspaceEditorStore.getState().emergencyDumpToLocalStorage();
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  const handleSelectTab = useCallback(
    (tabId: string) => {
      setActiveTab(tabId);
      onTabChange?.(tabId);
    },
    [setActiveTab, onTabChange]
  );

  const handleCloseTab = useCallback(
    (e: React.MouseEvent, tabId: string) => {
      e.stopPropagation();
      closeTab(tabId);
      onTabClose?.(tabId);
    },
    [closeTab, onTabClose]
  );

  const handleCreateNewTab = useCallback(() => {
    if (onNewTab) {
      onNewTab();
      return;
    }
    const tabIndex = tabs.length + 1;
    const newId = `src/contract_${tabIndex}.rs`;
    openTab({
      id: newId,
      filename: `contract_${tabIndex}.rs`,
      language: "rust",
      content: `//! Soroban Contract Module ${tabIndex}\n#![no_std]\nuse soroban_sdk::{contract, contractimpl, Env};\n\n#[contract]\npub struct Contract${tabIndex};\n\n#[contractimpl]\nimpl Contract${tabIndex} {\n    pub fn hello(env: Env) -> u32 {\n        42\n    }\n}\n`,
    });
  }, [tabs.length, openTab, onNewTab]);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const canUndo = Boolean(activeTab?.undoStack && activeTab.undoStack.length > 0);
  const canRedo = Boolean(activeTab?.redoStack && activeTab.redoStack.length > 0);

  return (
    <div className={`flex flex-col w-full bg-gray-900 border-b border-gray-800 ${className}`}>
      {/* Emergency Snapshot Restoration Notice */}
      {isEmergencyDumpAvailable && (
        <div
          data-testid="emergency-dump-banner"
          className="flex items-center justify-between px-3 py-1.5 text-xs bg-amber-950/60 border-b border-amber-800/80 text-amber-200 animate-fadeIn"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>Unsaved emergency editor session detected from previous local session.</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              data-testid="restore-emergency-dump-btn"
              onClick={() => restoreFromEmergencyDump()}
              className="px-2 py-0.5 rounded bg-amber-500 hover:bg-amber-400 text-gray-950 font-semibold text-[11px] transition-colors"
            >
              Restore
            </button>
            <button
              data-testid="dismiss-emergency-dump-btn"
              onClick={() => clearEmergencyDump()}
              className="px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 text-[11px] transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Main Tab Strip */}
      <div className="flex items-center justify-between h-9 px-1 overflow-x-auto select-none no-scrollbar">
        <div role="tablist" aria-label="Editor tabs" className="flex items-center gap-1 h-full">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                role="tab"
                tabIndex={0}
                aria-selected={isActive}
                data-testid={`editor-tab-${tab.id}`}
                onClick={() => handleSelectTab(tab.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleSelectTab(tab.id);
                  }
                }}
                className={`group flex items-center gap-2 h-7 px-2.5 rounded-t text-xs font-mono transition-colors cursor-pointer border-t-2 ${
                  isActive
                    ? "bg-[#1e1e1e] text-teal-300 border-teal-500 font-medium shadow-sm"
                    : "bg-gray-900 text-gray-400 hover:text-gray-200 hover:bg-gray-800/60 border-transparent"
                }`}
              >
                <FileCode className={`w-3.5 h-3.5 ${isActive ? "text-teal-400" : "text-gray-500 group-hover:text-gray-400"}`} />
                <span className="truncate max-w-[140px]" title={tab.id}>
                  {tab.filename}
                </span>

                {/* Dirty Indicator */}
                {tab.isDirty && (
                  <span
                    data-testid={`dirty-indicator-${tab.id}`}
                    className="w-1.5 h-1.5 rounded-full bg-teal-400 shrink-0"
                    title="Unsaved changes"
                  />
                )}

                {/* Tab Close Button */}
                {tabs.length > 1 && (
                  <button
                    data-testid={`close-tab-${tab.id}`}
                    aria-label={`Close tab ${tab.filename}`}
                    onClick={(e) => handleCloseTab(e, tab.id)}
                    className="p-0.5 ml-1 rounded hover:bg-gray-700/60 text-gray-500 hover:text-gray-300 opacity-60 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}

          {/* New Tab Button */}
          <button
            data-testid="new-tab-btn"
            aria-label="Create new contract tab"
            onClick={handleCreateNewTab}
            className="flex items-center justify-center h-7 w-7 rounded hover:bg-gray-800 text-gray-400 hover:text-teal-400 transition-colors ml-0.5"
            title="New File"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* History Controls (Undo / Redo / Emergency Save) */}
        <div className="flex items-center gap-1 px-2 border-l border-gray-800">
          <button
            data-testid="tab-undo-btn"
            aria-label="Undo tab edit"
            disabled={!canUndo || !activeTabId}
            onClick={() => activeTabId && undo(activeTabId)}
            className={`p-1 rounded transition-colors ${
              canUndo && activeTabId
                ? "text-gray-300 hover:text-teal-300 hover:bg-gray-800"
                : "text-gray-600 cursor-not-allowed opacity-40"
            }`}
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            data-testid="tab-redo-btn"
            aria-label="Redo tab edit"
            disabled={!canRedo || !activeTabId}
            onClick={() => activeTabId && redo(activeTabId)}
            className={`p-1 rounded transition-colors ${
              canRedo && activeTabId
                ? "text-gray-300 hover:text-teal-300 hover:bg-gray-800"
                : "text-gray-600 cursor-not-allowed opacity-40"
            }`}
            title="Redo (Ctrl+Y)"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default EditorTabs;
