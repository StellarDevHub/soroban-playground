"use client";

import React, { useState, useMemo } from "react";
import {
  Code2,
  Copy,
  Check,
  Search,
  Sparkles,
  ChevronRight,
  ChevronDown,
  FileCode,
  Zap,
  RefreshCw,
  Layers,
  ArrowRightLeft,
  Binary,
  Maximize2,
  Minimize2,
  Info,
} from "lucide-react";
import {
  XdrType,
  decodeXdrPayload,
  AstNode,
  HexDumpRow,
} from "@/lib/xdrDecoder";

export interface XdrDecoderInspectorProps {
  initialXdr?: string;
  onSelectXdr?: (xdrString: string) => void;
}

// Sample base64 XDRs for quick testing across all Soroban data structures
export const SAMPLE_XDRS = [
  {
    name: "ScVal (Symbol: 'hello')",
    type: "ScVal" as const,
    xdr: "AAAAEAAAAAVoZWxsbw==",
  },
  {
    name: "ScVal (U32: 100)",
    type: "ScVal" as const,
    xdr: "AAAAAwAAAAZkZWZhdWx0AAAAAA==",
  },
  {
    name: "ScVal (Vec of Symbols)",
    type: "ScVal" as const,
    xdr: "AAAAEAAAAAEAAAAQAAAAA3N1Yw==",
  },
  {
    name: "LedgerKey (Contract Data)",
    type: "LedgerKey" as const,
    xdr: "AAAAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAEAAAAEaW5pdAAAAA==",
  },
  {
    name: "TransactionEnvelope (Sample)",
    type: "TransactionEnvelope" as const,
    xdr: "AAAAAgAAAAA3+5nL9Xp2mN9bM7v10rG6s0000000000000000000AAAAZA==",
  },
];

export default function XdrDecoderInspector({
  initialXdr = "",
}: XdrDecoderInspectorProps) {
  const [xdrInput, setXdrInput] = useState<string>(initialXdr);
  const [selectedType, setSelectedType] = useState<XdrType>("Auto");
  const [filterQuery, setFilterQuery] = useState<string>("");
  const [copiedRaw, setCopiedRaw] = useState<boolean>(false);
  const [copiedJson, setCopiedJson] = useState<boolean>(false);
  const [copiedFieldId, setCopiedFieldId] = useState<string | null>(null);

  // AST collapse/expand state
  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({
    root: true,
  });

  // Dual-pane bidirectional highlighting states
  const [hoveredByteOffset, setHoveredByteOffset] = useState<number | null>(null);
  const [highlightedByteRange, setHighlightedByteRange] = useState<[number, number] | null>(null);
  const [hoveredAstId, setHoveredAstId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"dual" | "ast" | "hex">("dual");

  const decodeResult = useMemo(() => {
    return decodeXdrPayload(xdrInput, selectedType);
  }, [xdrInput, selectedType]);

  const handleCopy = (text: string, isJson: boolean) => {
    navigator.clipboard.writeText(text);
    if (isJson) {
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 2000);
    } else {
      setCopiedRaw(true);
      setTimeout(() => setCopiedRaw(false), 2000);
    }
  };

  const handleCopyFieldValue = (id: string, value: any) => {
    const textToCopy = typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
    navigator.clipboard.writeText(textToCopy);
    setCopiedFieldId(id);
    setTimeout(() => setCopiedFieldId(null), 1800);
  };

  const toggleExpand = (path: string) => {
    setExpandedKeys((prev) => ({
      ...prev,
      [path]: !prev[path],
    }));
  };

  const expandAll = () => {
    const newKeys: Record<string, boolean> = {};
    const traverse = (node?: AstNode) => {
      if (!node) return;
      newKeys[node.id] = true;
      node.children?.forEach(traverse);
    };
    traverse(decodeResult.astRoot);
    setExpandedKeys(newKeys);
  };

  const collapseAll = () => {
    setExpandedKeys({ root: true });
  };

  // Render collapsible AST Tree with copyable fields and type annotation tooltips
  const renderAstNode = (node: AstNode, depth = 0) => {
    const isExpanded = expandedKeys[node.id] ?? (depth < 2);
    const hasChildren = node.children && node.children.length > 0;
    const isHovered = hoveredAstId === node.id;
    const isByteHighlighted =
      hoveredByteOffset !== null &&
      node.byteRange &&
      hoveredByteOffset >= node.byteRange[0] &&
      hoveredByteOffset <= node.byteRange[1];

    const matchesFilter =
      !filterQuery ||
      node.key.toLowerCase().includes(filterQuery.toLowerCase()) ||
      (node.value !== undefined &&
        String(node.value).toLowerCase().includes(filterQuery.toLowerCase()));

    if (!matchesFilter && !hasChildren) return null;

    return (
      <div
        key={node.id}
        className={`group/ast py-1 px-2 rounded-lg transition-colors ${
          isHovered || isByteHighlighted
            ? "bg-cyan-950/60 ring-1 ring-cyan-500/50"
            : "hover:bg-slate-900/60"
        }`}
        onMouseEnter={() => {
          setHoveredAstId(node.id);
          if (node.byteRange) setHighlightedByteRange(node.byteRange);
        }}
        onMouseLeave={() => {
          setHoveredAstId(null);
          setHighlightedByteRange(null);
        }}
      >
        <div className="flex items-center gap-2 text-xs">
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggleExpand(node.id)}
              className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 font-mono focus:outline-none"
            >
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span className="font-semibold text-slate-200">{node.key}</span>
            </button>
          ) : (
            <span className="font-mono text-cyan-300 font-medium pl-4">{node.key}:</span>
          )}

          {/* Type annotation badge with tooltip */}
          <span
            title={node.typeTooltip || node.type}
            className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400 border border-slate-700/60 font-mono flex items-center gap-1 cursor-help"
          >
            <Info size={10} className="text-cyan-400" />
            {node.type}
          </span>

          {/* Value display */}
          {!hasChildren && node.value !== undefined && (
            <span
              className={`font-mono ${
                typeof node.value === "string"
                  ? "text-emerald-400"
                  : typeof node.value === "number" || typeof node.value === "bigint"
                  ? "text-amber-300"
                  : typeof node.value === "boolean"
                  ? "text-purple-400"
                  : "text-slate-300"
              }`}
            >
              {typeof node.value === "string" ? `"${node.value}"` : String(node.value)}
            </span>
          )}

          {/* Copyable field value button */}
          {!hasChildren && node.value !== undefined && (
            <button
              type="button"
              title="Copy field value"
              onClick={() => handleCopyFieldValue(node.id, node.value)}
              className="opacity-0 group-hover/ast:opacity-100 p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded transition ml-auto"
            >
              {copiedFieldId === node.id ? (
                <Check size={12} className="text-emerald-400" />
              ) : (
                <Copy size={12} />
              )}
            </button>
          )}
        </div>

        {/* Children AST nodes */}
        {hasChildren && isExpanded && (
          <div className="pl-4 ml-1.5 border-l border-cyan-900/30 my-1 space-y-1">
            {node.children!.map((child) => renderAstNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
      {/* Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 bg-slate-900/90 border-b border-slate-800 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gradient-to-tr from-cyan-600 to-teal-500 text-white shadow-lg shadow-cyan-500/20">
            <Code2 size={20} />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
              Soroban XDR Disassembler & Hex Inspector
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/20">
                Interactive AST
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              Interactive dual-pane disassembly, AST tree navigation, and bidirectional hex byte highlighting
            </p>
          </div>
        </div>

        {/* Dual-Pane View Toggles and XDR Type Switcher */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-slate-950/80 p-1 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => setActiveTab("dual")}
              className={`px-2.5 py-1 text-xs font-medium rounded-lg transition ${
                activeTab === "dual"
                  ? "bg-cyan-500 text-slate-950 font-semibold shadow"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Dual Pane
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("ast")}
              className={`px-2.5 py-1 text-xs font-medium rounded-lg transition ${
                activeTab === "ast"
                  ? "bg-cyan-500 text-slate-950 font-semibold shadow"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              AST Tree
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("hex")}
              className={`px-2.5 py-1 text-xs font-medium rounded-lg transition ${
                activeTab === "hex"
                  ? "bg-cyan-500 text-slate-950 font-semibold shadow"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Hex Dump
            </button>
          </div>

          <div className="flex items-center gap-2 bg-slate-950/80 p-1 rounded-xl border border-slate-800">
            <Layers size={14} className="text-slate-400 ml-2" />
            <span className="text-xs text-slate-400 mr-1">Type:</span>
            {(
              [
                "Auto",
                "TransactionEnvelope",
                "ScVal",
                "LedgerEntryData",
                "DiagnosticEvent",
              ] as XdrType[]
            ).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setSelectedType(t)}
                className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-all ${
                  selectedType === t
                    ? "bg-cyan-500 text-slate-950 font-semibold shadow-md shadow-cyan-500/30"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Dual-Pane Content Body */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-0 flex-1 divide-y lg:divide-y-0 lg:divide-x divide-slate-800 min-h-0 overflow-hidden">
        {/* Left Column: XDR Input & Hex Dump View (5 columns) */}
        <div
          className={`flex flex-col p-5 space-y-4 bg-slate-950 overflow-y-auto ${
            activeTab === "ast" ? "hidden" : activeTab === "hex" ? "lg:col-span-12" : "lg:col-span-5"
          }`}
        >
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2">
              <FileCode size={14} className="text-cyan-400" />
              Base64 XDR Payload
            </label>
            {xdrInput && (
              <button
                type="button"
                onClick={() => setXdrInput("")}
                className="text-xs text-slate-400 hover:text-slate-200 transition"
              >
                Clear
              </button>
            )}
          </div>

          <div className="relative min-h-[110px]">
            <textarea
              value={xdrInput}
              onChange={(e) => setXdrInput(e.target.value)}
              placeholder="Paste base64 XDR payload here (e.g. AAAAEAAAAAVoZWxsbw==)..."
              className="w-full h-28 p-3 font-mono text-xs bg-slate-900/70 text-cyan-200 border border-slate-800 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition resize-none"
            />
          </div>

          {/* Quick Presets */}
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-slate-400 mb-2">
              <Sparkles size={14} className="text-amber-400" />
              <span>Presets:</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {SAMPLE_XDRS.map((sample) => (
                <button
                  key={sample.name}
                  type="button"
                  onClick={() => {
                    setSelectedType(sample.type);
                    setXdrInput(sample.xdr);
                  }}
                  className="px-2.5 py-1 text-[11px] bg-slate-900 border border-slate-800 hover:border-cyan-500/50 text-slate-300 hover:text-cyan-300 rounded-lg transition-all flex items-center gap-1.5"
                >
                  <Zap size={11} className="text-cyan-400" />
                  {sample.name}
                </button>
              ))}
            </div>
          </div>

          {/* Dual-Pane Hex Dump Inspector */}
          <div className="flex-1 flex flex-col min-h-[220px] bg-slate-900/50 rounded-xl border border-slate-800 p-3 overflow-hidden">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800/80 mb-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <Binary size={14} className="text-teal-400" />
                <span>Hex Dump Inspector ({decodeResult.rawBytes.length} bytes)</span>
              </div>
              {hoveredByteOffset !== null && (
                <span className="text-[11px] font-mono text-cyan-400">
                  Byte Offset: 0x{hoveredByteOffset.toString(16).toUpperCase()} ({hoveredByteOffset})
                </span>
              )}
            </div>

            <div className="flex-1 overflow-x-auto overflow-y-auto font-mono text-[11px] space-y-1">
              {decodeResult.hexRows.length === 0 ? (
                <div className="h-full flex items-center justify-center text-slate-600 text-xs">
                  No binary bytes to display.
                </div>
              ) : (
                decodeResult.hexRows.map((row) => (
                  <div key={row.offset} className="flex items-center gap-3 hover:bg-slate-800/40 px-1 py-0.5 rounded">
                    <span className="text-slate-500 select-none">{row.offsetHex}</span>
                    <div className="flex items-center gap-1.5 flex-1">
                      {row.bytes.map((byte) => {
                        const isHovered = hoveredByteOffset === byte.offset;
                        const isRangeHighlighted =
                          highlightedByteRange &&
                          byte.offset >= highlightedByteRange[0] &&
                          byte.offset <= highlightedByteRange[1];

                        return (
                          <span
                            key={byte.offset}
                            onMouseEnter={() => setHoveredByteOffset(byte.offset)}
                            onMouseLeave={() => setHoveredByteOffset(null)}
                            className={`cursor-pointer px-1 rounded transition-colors ${
                              isHovered || isRangeHighlighted
                                ? "bg-cyan-500 text-slate-950 font-bold shadow-sm"
                                : "text-slate-300 hover:text-cyan-300"
                            }`}
                          >
                            {byte.hex}
                          </span>
                        );
                      })}
                    </div>
                    <span className="text-slate-500 select-none tracking-widest pl-2 border-l border-slate-800">
                      {row.ascii}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Interactive Collapsible AST Tree Inspector (7 columns) */}
        <div
          className={`flex flex-col p-5 bg-slate-900/40 overflow-hidden ${
            activeTab === "hex" ? "hidden" : activeTab === "ast" ? "lg:col-span-12" : "lg:col-span-7"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Interactive XDR AST View
              </span>
              {decodeResult.type && decodeResult.type !== "Empty" && (
                <span className="px-2 py-0.5 text-xs font-medium bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 rounded-full flex items-center gap-1">
                  <ArrowRightLeft size={12} />
                  {decodeResult.type}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {decodeResult.astRoot && (
                <>
                  <button
                    type="button"
                    onClick={expandAll}
                    className="px-2 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition flex items-center gap-1"
                  >
                    <Maximize2 size={11} /> Expand All
                  </button>
                  <button
                    type="button"
                    onClick={collapseAll}
                    className="px-2 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition flex items-center gap-1"
                  >
                    <Minimize2 size={11} /> Collapse
                  </button>
                </>
              )}
              {decodeResult.jsonString && (
                <button
                  type="button"
                  onClick={() => handleCopy(decodeResult.jsonString, true)}
                  className="px-2.5 py-1 text-xs bg-cyan-600 hover:bg-cyan-500 font-medium text-slate-950 rounded-lg transition shadow-md shadow-cyan-600/20 flex items-center gap-1"
                >
                  {copiedJson ? <Check size={12} className="text-slate-950" /> : <Copy size={12} />}
                  Copy JSON
                </button>
              )}
            </div>
          </div>

          {/* Search Filter for AST Fields and Values */}
          {decodeResult.nativeValue !== null && (
            <div className="relative mb-3">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
              />
              <input
                type="text"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder="Filter decoded AST fields, types, or values..."
                className="w-full pl-9 pr-4 py-1.5 text-xs bg-slate-950 text-slate-200 border border-slate-800 rounded-xl focus:outline-none focus:border-cyan-500 transition"
              />
            </div>
          )}

          {/* Decoded AST Container */}
          <div className="flex-1 bg-slate-950 p-4 rounded-xl border border-slate-800 overflow-y-auto">
            {decodeResult.error ? (
              <div className="p-4 bg-rose-950/40 border border-rose-800/50 rounded-xl text-rose-300 text-xs">
                <p className="font-semibold mb-1">Decoding Error</p>
                <p className="text-rose-400">{decodeResult.error}</p>
              </div>
            ) : decodeResult.nativeValue === null ? (
              <div className="flex flex-col items-center justify-center h-48 text-center text-slate-500">
                <RefreshCw size={24} className="mb-2 opacity-40 animate-pulse" />
                <p className="text-xs">
                  Enter or paste a base64 XDR payload to disassemble and inspect the AST hierarchy.
                </p>
              </div>
            ) : (
              <div className="font-mono text-xs">
                {decodeResult.astRoot && renderAstNode(decodeResult.astRoot)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
