"use client";

import React, { useState } from "react";
import { X, Copy, Check, Code2, Database, Clock, Layers } from "lucide-react";
import type { StorageBrowserEntry } from "@/types/storageBrowser";
import TtlBadge from "./TtlBadge";

interface StorageEntryDetailModalProps {
  entry: StorageBrowserEntry | null;
  onClose: () => void;
  onBumpClick?: (entry: StorageBrowserEntry) => void;
}

export const StorageEntryDetailModal: React.FC<StorageEntryDetailModalProps> = ({
  entry,
  onClose,
  onBumpClick,
}) => {
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedVal, setCopiedVal] = useState(false);

  if (!entry) return null;

  const copyToClipboard = (text: string, type: "key" | "val") => {
    navigator.clipboard.writeText(text);
    if (type === "key") {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } else {
      setCopiedVal(true);
      setTimeout(() => setCopiedVal(false), 2000);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="entry-detail-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-2xl bg-gray-900 border border-gray-800 rounded-xl shadow-2xl overflow-hidden text-gray-100 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-950">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-cyan-400" />
            <div>
              <h2 id="entry-detail-title" className="text-base font-semibold">
                Storage Entry Inspector
              </h2>
              <p className="text-xs text-gray-400 font-mono truncate max-w-md">
                Contract: {entry.contractId}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close details"
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {/* Metadata Bar */}
          <div className="grid grid-cols-3 gap-3 p-3 bg-gray-950 border border-gray-800 rounded-lg text-xs">
            <div>
              <span className="text-gray-400 block text-[11px] mb-1">Durability</span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-purple-950/60 text-purple-300 border border-purple-800/40">
                {entry.durability}
              </span>
            </div>
            <div>
              <span className="text-gray-400 block text-[11px] mb-1">TTL Status</span>
              <TtlBadge ttl={entry.ttl} showDetails={false} />
            </div>
            <div>
              <span className="text-gray-400 block text-[11px] mb-1">Diff Tracking</span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono capitalize bg-gray-800 text-gray-300 border border-gray-700">
                {entry.diff}
              </span>
            </div>
          </div>

          {/* Key Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-300">Storage Key</span>
                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-cyan-950 text-cyan-300 border border-cyan-800/40">
                  {entry.keyDecoded.type}
                </span>
              </div>
              <button
                onClick={() => copyToClipboard(entry.keyRaw, "key")}
                className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-cyan-400 transition-colors"
              >
                {copiedKey ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedKey ? "Copied XDR" : "Copy Key XDR"}</span>
              </button>
            </div>

            {/* Decoded Key Display */}
            <div className="p-3 bg-gray-950 border border-gray-800 rounded-lg font-mono text-xs text-cyan-200">
              <pre className="whitespace-pre-wrap break-all">{entry.keyDecoded.displayValue}</pre>
            </div>

            {entry.keyDecoded.structFields && entry.keyDecoded.structFields.length > 0 && (
              <div className="p-2.5 bg-gray-950/60 border border-gray-800/80 rounded-lg space-y-1.5">
                <span className="text-[11px] text-gray-400 font-medium block">Struct Key Fields:</span>
                {entry.keyDecoded.structFields.map((field) => (
                  <div key={field.name} className="flex items-baseline justify-between text-xs font-mono">
                    <span className="text-cyan-400/80">{field.name}:</span>
                    <span className="text-gray-300 truncate max-w-[320px]">{String(field.value)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Value Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-300">Storage Value</span>
                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-indigo-950 text-indigo-300 border border-indigo-800/40">
                  {entry.valDecoded.type}
                </span>
              </div>
              <button
                onClick={() => copyToClipboard(entry.valRaw, "val")}
                className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-cyan-400 transition-colors"
              >
                {copiedVal ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedVal ? "Copied XDR" : "Copy Value XDR"}</span>
              </button>
            </div>

            {/* Decoded Value Display */}
            <div className="p-3 bg-gray-950 border border-gray-800 rounded-lg font-mono text-xs text-emerald-200">
              <pre className="whitespace-pre-wrap break-all">{entry.valDecoded.displayValue}</pre>
            </div>

            {entry.valDecoded.structFields && entry.valDecoded.structFields.length > 0 && (
              <div className="p-2.5 bg-gray-950/60 border border-gray-800/80 rounded-lg space-y-1.5">
                <span className="text-[11px] text-gray-400 font-medium block">Struct Value Fields:</span>
                {entry.valDecoded.structFields.map((field) => (
                  <div key={field.name} className="flex items-baseline justify-between text-xs font-mono">
                    <span className="text-indigo-400/80">{field.name}:</span>
                    <span className="text-gray-300 truncate max-w-[320px]">{String(field.value)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-800 bg-gray-950">
          <span className="text-xs text-gray-500 font-mono">
            Last Modified: Ledger #{entry.lastModifiedLedgerSeq?.toLocaleString() || "N/A"}
          </span>
          <div className="flex items-center gap-2">
            {entry.ttl?.canBump && onBumpClick && (
              <button
                onClick={() => {
                  onClose();
                  onBumpClick(entry);
                }}
                className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5"
              >
                <span>Bump TTL</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StorageEntryDetailModal;
