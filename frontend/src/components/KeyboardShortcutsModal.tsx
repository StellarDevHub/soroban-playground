// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Interactive Keyboard Shortcut Customizer Modal.
 *
 * Implements Issue #2077:
 *  - Interactive keyboard shortcut customizer modal allowing users to remap hotkeys and persist settings
 *  - Keymap presets selection (VSCode, Vim, Sublime Text)
 *  - One-click Monaco Vim mode toggle
 *  - Conflict detection and validation
 *  - Dark theme Tailwind styling and full accessibility
 */

"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Command,
  Edit2,
  Keyboard,
  RotateCcw,
  Search,
  Terminal,
  X,
} from "lucide-react";
import type { KeymapPreset, ShortcutCategory, ShortcutItem } from "@/types/shortcuts";
import {
  eventToShortcutString,
  formatShortcut,
  isApplePlatform,
  MODIFIER_KEYS,
} from "@/lib/shortcuts/platform";
import { PRESET_LABELS } from "@/lib/shortcuts/presets";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

export interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Optional deterministic platform override for testing */
  isMacOverride?: boolean;
}

const CATEGORIES: { id: "all" | ShortcutCategory; label: string }[] = [
  { id: "all", label: "All Shortcuts" },
  { id: "editor", label: "Editor" },
  { id: "navigation", label: "Navigation" },
  { id: "build", label: "Build & Deploy" },
  { id: "general", label: "General" },
];

export function KeyboardShortcutsModal({
  isOpen,
  onClose,
  isMacOverride,
}: KeyboardShortcutsModalProps) {
  const {
    preset,
    setPreset,
    vimModeEnabled,
    toggleVimMode,
    shortcuts,
    updateShortcut,
    resetShortcut,
    resetAllShortcuts,
    findConflict,
    isMac: hookIsMac,
  } = useKeyboardShortcuts({ isMacOverride });

  const isMac = useMemo(
    () => (typeof isMacOverride === "boolean" ? isMacOverride : hookIsMac),
    [hookIsMac, isMacOverride],
  );

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<"all" | ShortcutCategory>("all");
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Focus search input when opening
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
      setRecordingId(null);
      setConflictWarning(null);
      setSuccessNotice(null);
    }
  }, [isOpen]);

  // Handle keydown while recording or closing with Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Escape key cancels recording or closes modal
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (recordingId) {
          setRecordingId(null);
          setConflictWarning(null);
        } else {
          onClose();
        }
        return;
      }

      // If currently recording a new shortcut for an action
      if (recordingId) {
        event.preventDefault();
        event.stopPropagation();

        // Ignore modifier-only presses
        if (MODIFIER_KEYS.has(event.key)) {
          return;
        }

        const newBinding = eventToShortcutString(event, isMac);
        if (!newBinding) return;

        // Check for conflicts
        const conflict = findConflict(newBinding, recordingId);
        if (conflict) {
          setConflictWarning(
            `"${formatShortcut(newBinding, isMac)}" is already mapped to "${conflict.existingShortcut.label}". Replaced previous binding.`,
          );
        } else {
          setConflictWarning(null);
        }

        updateShortcut(recordingId, newBinding);
        setSuccessNotice(`Remapped to ${formatShortcut(newBinding, isMac)}`);
        setRecordingId(null);

        setTimeout(() => {
          setSuccessNotice(null);
        }, 3000);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [findConflict, isMac, isOpen, onClose, recordingId, updateShortcut]);

  // Filter shortcuts
  const filteredShortcuts = useMemo(() => {
    return shortcuts.filter((item) => {
      const matchesCategory =
        selectedCategory === "all" || item.category === selectedCategory;

      if (!matchesCategory) return false;

      if (!searchQuery.trim()) return true;

      const q = searchQuery.toLowerCase().trim();
      const currentKey = (item.customKey || item.defaultKey).toLowerCase();
      const formattedKey = formatShortcut(item.customKey || item.defaultKey, isMac).toLowerCase();

      return (
        item.label.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        currentKey.includes(q) ||
        formattedKey.includes(q)
      );
    });
  }, [isMac, searchQuery, selectedCategory, shortcuts]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-modal-title"
      aria-describedby="shortcuts-modal-desc"
    >
      <div
        ref={modalRef}
        className="w-full max-w-4xl max-h-[85vh] flex flex-col rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl shadow-black/80 overflow-hidden text-slate-100"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/80">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-teal-500/10 border border-teal-500/20 text-teal-400">
              <Keyboard size={20} />
            </div>
            <div>
              <h2
                id="shortcuts-modal-title"
                className="text-lg font-semibold tracking-wide text-white flex items-center gap-2"
              >
                Keyboard Shortcuts
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-teal-400 border border-teal-500/20 font-mono">
                  {isMac ? "macOS (⌘ Cmd)" : "Windows/Linux (Ctrl)"}
                </span>
              </h2>
              <p id="shortcuts-modal-desc" className="text-xs text-slate-400">
                Configure keymap presets, remap hotkeys, and toggle Vim editing
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close shortcuts modal"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Preset & Vim Controls Bar */}
        <div className="px-6 py-3.5 border-b border-slate-800 bg-slate-950/40 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-400">Keymap Preset:</span>
            <div
              className="inline-flex rounded-xl border border-slate-800 bg-slate-900 p-1"
              role="radiogroup"
              aria-label="Keymap Preset"
            >
              {(["vscode", "vim", "sublime"] as KeymapPreset[]).map((p) => {
                const isActive = preset === p;
                return (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    onClick={() => setPreset(p)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      isActive
                        ? "bg-teal-500 text-slate-950 font-semibold shadow-sm"
                        : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                    }`}
                  >
                    {PRESET_LABELS[p].name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Monaco Vim Mode One-Click Toggle */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Terminal size={14} className={vimModeEnabled ? "text-teal-400" : "text-slate-500"} />
              <span className="text-xs font-medium text-slate-300">Monaco Vim Mode:</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={vimModeEnabled}
              onClick={toggleVimMode}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 focus:ring-offset-slate-900 ${
                vimModeEnabled ? "bg-teal-500" : "bg-slate-800"
              }`}
            >
              <span className="sr-only">Toggle Monaco Vim Mode</span>
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                  vimModeEnabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
            <span
              className={`text-[11px] font-mono px-2 py-0.5 rounded-md ${
                vimModeEnabled
                  ? "bg-teal-500/10 text-teal-300 border border-teal-500/30"
                  : "bg-slate-800 text-slate-400"
              }`}
            >
              {vimModeEnabled ? "Enabled" : "Off"}
            </span>
          </div>
        </div>

        {/* Filter and Category Row */}
        <div className="px-6 py-3 border-b border-slate-800 bg-slate-900 flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
            />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search shortcuts..."
              className="w-full pl-9 pr-4 py-1.5 rounded-xl text-xs bg-slate-950/70 border border-slate-800 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs"
              >
                Clear
              </button>
            )}
          </div>

          {/* Categories */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
            {CATEGORIES.map((cat) => {
              const isSelected = selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs transition-colors shrink-0 ${
                    isSelected
                      ? "bg-slate-800 text-teal-400 font-semibold"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                  }`}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Feedback / Notifications */}
        {conflictWarning && (
          <div
            role="alert"
            className="px-6 py-2 bg-amber-500/10 border-b border-amber-500/20 text-amber-300 text-xs flex items-center gap-2"
          >
            <AlertTriangle size={14} className="shrink-0 text-amber-400" />
            <span>{conflictWarning}</span>
          </div>
        )}
        {successNotice && (
          <div
            role="status"
            className="px-6 py-2 bg-emerald-500/10 border-b border-emerald-500/20 text-emerald-300 text-xs flex items-center gap-2 animate-in fade-in"
          >
            <Check size={14} className="shrink-0 text-emerald-400" />
            <span>{successNotice}</span>
          </div>
        )}

        {/* Shortcut Items List */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2.5 divide-y divide-slate-800/40">
          {filteredShortcuts.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-xs">
              No keyboard shortcuts found matching &quot;{searchQuery}&quot;.
            </div>
          ) : (
            filteredShortcuts.map((item) => {
              const isRecording = recordingId === item.id;
              const hasOverride = Boolean(item.customKey);
              const bindingKey = item.customKey || item.defaultKey;
              const formattedKey = formatShortcut(bindingKey, isMac);

              return (
                <div
                  key={item.id}
                  data-testid={`shortcut-row-${item.id}`}
                  className={`pt-2.5 first:pt-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-2 rounded-xl transition-colors ${
                    isRecording
                      ? "bg-teal-500/10 border border-teal-500/30"
                      : "hover:bg-slate-800/30"
                  }`}
                >
                  <div className="space-y-0.5 flex-1 min-w-0 pr-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-xs text-white">
                        {item.label}
                      </span>
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 uppercase">
                        {item.category}
                      </span>
                      {hasOverride && (
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-teal-500/20 text-teal-300">
                          Customized
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 truncate">
                      {item.description}
                    </p>
                  </div>

                  {/* Hotkey Display and Action Buttons */}
                  <div className="flex items-center gap-3 shrink-0">
                    {isRecording ? (
                      <div className="flex items-center gap-2">
                        <span className="animate-pulse text-xs text-teal-400 font-mono px-3 py-1 rounded-lg bg-teal-500/20 border border-teal-500/40">
                          Press new shortcut... (Esc to cancel)
                        </span>
                      </div>
                    ) : (
                      <kbd className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-700/80 text-xs font-mono font-semibold text-slate-200 shadow-inner">
                        {formattedKey}
                      </kbd>
                    )}

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          if (isRecording) {
                            setRecordingId(null);
                          } else {
                            setRecordingId(item.id);
                            setConflictWarning(null);
                          }
                        }}
                        className={`p-1.5 rounded-lg text-xs transition-colors ${
                          isRecording
                            ? "bg-slate-700 text-white"
                            : "text-slate-400 hover:text-white hover:bg-slate-800"
                        }`}
                        title={isRecording ? "Cancel recording" : "Remap shortcut"}
                        aria-label={`Remap ${item.label}`}
                      >
                        <Edit2 size={13} />
                      </button>

                      {hasOverride && (
                        <button
                          type="button"
                          onClick={() => resetShortcut(item.id)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-slate-800 transition-colors"
                          title="Reset to preset default"
                          aria-label={`Reset ${item.label} to default`}
                        >
                          <RotateCcw size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-950/60 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={resetAllShortcuts}
              className="text-xs text-slate-400 hover:text-amber-300 transition-colors flex items-center gap-1.5"
            >
              <RotateCcw size={12} />
              <span>Reset all shortcuts to defaults</span>
            </button>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-slate-500 hidden sm:inline">
              Tip: Press Esc or click outside to dismiss
            </span>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium text-xs transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default KeyboardShortcutsModal;
