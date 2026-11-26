"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  AlertTriangle,
  FolderPlus,
  RefreshCw,
  Shield,
  X,
  Star,
  GitFork,
  ArrowRight,
  Layers,
  CheckCircle2,
} from "lucide-react";
import {
  forkTemplate,
  ForkTemplateOptions,
  ForkTemplateResult,
} from "@/services/templateService";
import type { Template } from "@/lib/templates";

export interface TemplateForkModalProps {
  template: Template | null;
  isOpen: boolean;
  onClose: () => void;
  onForkComplete?: (result: ForkTemplateResult) => void;
}

export default function TemplateForkModal({
  template,
  isOpen,
  onClose,
  onForkComplete,
}: TemplateForkModalProps) {
  const [forkMode, setForkMode] = useState<"new_project" | "replace_current">(
    "new_project"
  );
  const [projectName, setProjectName] = useState("");
  const [autoBackup, setAutoBackup] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const modalRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (template) {
      setProjectName(`${template.id}-sandbox`);
      setForkMode("new_project");
      setAutoBackup(true);
    }
  }, [template]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    closeBtnRef.current?.focus();
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !template) return null;

  const handleConfirmFork = () => {
    setIsSubmitting(true);
    try {
      const options: ForkTemplateOptions = {
        template: {
          id: template.id,
          name: template.name,
          code: template.code,
        },
        target: forkMode,
        newProjectName: projectName.trim(),
        autoBackup: autoBackup,
      };

      const result = forkTemplate(options);
      onForkComplete?.(result);

      if (typeof window !== "undefined") {
        window.location.href = result.targetUrl;
      }
    } finally {
      setIsSubmitting(false);
      onClose();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="fork-modal-title"
      data-testid="template-fork-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        className="w-full max-w-xl bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10 bg-slate-950/50">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
              <GitFork size={20} />
            </div>
            <div>
              <h2
                id="fork-modal-title"
                className="text-base font-bold text-white tracking-tight"
              >
                Fork Template: {template.name}
              </h2>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-400">
                <span className="flex items-center gap-1">
                  <Layers size={12} className="text-violet-400" />
                  {template.category}
                </span>
                <span>•</span>
                <span className="text-emerald-400 font-medium">
                  {template.difficulty}
                </span>
                {template.communityRating && (
                  <>
                    <span>•</span>
                    <span className="flex items-center gap-1 text-amber-300">
                      <Star size={12} className="fill-amber-300" />
                      {template.communityRating} ({template.ratingCount || 0})
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <button
            ref={closeBtnRef}
            type="button"
            data-testid="close-fork-modal"
            aria-label="Close template fork modal"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5">
          {/* Active Workspace Overwrite Warning */}
          <div
            data-testid="workspace-warning-alert"
            className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-200 flex items-start gap-3"
          >
            <AlertTriangle size={20} className="text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <h3 className="font-bold text-amber-300">
                Workspace Replacement Notice
              </h3>
              <p className="leading-relaxed opacity-90">
                Opening this template in your active workspace will replace the current
                smart contract buffer in the code editor. Choose your preferred target
                destination below to prevent accidental loss of uncommitted work.
              </p>
            </div>
          </div>

          {/* Fork Destination Selection */}
          <div className="space-y-3">
            <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">
              Choose Destination
            </label>

            <div className="space-y-2.5">
              {/* Option 1: New Project Namespace (Recommended) */}
              <div
                onClick={() => setForkMode("new_project")}
                data-testid="option-new-project"
                className={`p-4 rounded-xl border cursor-pointer transition-all ${
                  forkMode === "new_project"
                    ? "bg-violet-500/10 border-violet-500/40 shadow-sm"
                    : "bg-slate-950/40 border-white/5 hover:border-white/10"
                }`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="radio"
                    name="fork_destination"
                    id="fork-destination-new"
                    checked={forkMode === "new_project"}
                    onChange={() => setForkMode("new_project")}
                    className="mt-1 text-violet-600 focus:ring-violet-500"
                  />
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center justify-between">
                      <label
                        htmlFor="fork-destination-new"
                        className="text-xs font-bold text-white flex items-center gap-2 cursor-pointer"
                      >
                        <FolderPlus size={14} className="text-violet-400" />
                        Fork into New Project Namespace
                      </label>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        Recommended · Safe
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Creates an isolated workspace namespace with its own storage key.
                      Your current contract and active editor buffers remain completely untouched.
                    </p>

                    {forkMode === "new_project" && (
                      <div className="pt-2">
                        <label
                          htmlFor="project-name-input"
                          className="block text-[10px] font-bold text-slate-400 uppercase mb-1"
                        >
                          Project Name
                        </label>
                        <input
                          id="project-name-input"
                          type="text"
                          data-testid="project-name-input"
                          value={projectName}
                          onChange={(e) => setProjectName(e.target.value)}
                          placeholder="e.g. my-awesome-contract"
                          className="w-full bg-slate-950 rounded-lg border border-white/10 px-3 py-2 text-xs font-mono text-slate-200 outline-none focus:border-violet-500 transition"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Option 2: Replace Active Workspace */}
              <div
                onClick={() => setForkMode("replace_current")}
                data-testid="option-replace-current"
                className={`p-4 rounded-xl border cursor-pointer transition-all ${
                  forkMode === "replace_current"
                    ? "bg-rose-500/10 border-rose-500/40 shadow-sm"
                    : "bg-slate-950/40 border-white/5 hover:border-white/10"
                }`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="radio"
                    name="fork_destination"
                    id="fork-destination-replace"
                    checked={forkMode === "replace_current"}
                    onChange={() => setForkMode("replace_current")}
                    className="mt-1 text-rose-600 focus:ring-rose-500"
                  />
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center justify-between">
                      <label
                        htmlFor="fork-destination-replace"
                        className="text-xs font-bold text-white flex items-center gap-2 cursor-pointer"
                      >
                        <RefreshCw size={14} className="text-rose-400" />
                        Replace Current Workspace Code
                      </label>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30">
                        Overwrites Editor
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Directly loads template code into the active editor buffer, replacing
                      any existing code.
                    </p>

                    {forkMode === "replace_current" && (
                      <div className="pt-2 flex items-center gap-2">
                        <input
                          id="auto-backup-checkbox"
                          type="checkbox"
                          data-testid="auto-backup-checkbox"
                          checked={autoBackup}
                          onChange={(e) => setAutoBackup(e.target.checked)}
                          className="rounded text-violet-600 focus:ring-violet-500"
                        />
                        <label
                          htmlFor="auto-backup-checkbox"
                          className="text-[11px] text-slate-300 cursor-pointer flex items-center gap-1.5"
                        >
                          <Shield size={12} className="text-emerald-400" />
                          Automatically snapshot current code to Workspace Backups
                        </label>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/10 bg-slate-950/60 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-white/10 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="confirm-fork-button"
            disabled={isSubmitting || (forkMode === "new_project" && !projectName.trim())}
            onClick={handleConfirmFork}
            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold transition disabled:opacity-50"
          >
            <span>Confirm & Open in IDE</span>
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
