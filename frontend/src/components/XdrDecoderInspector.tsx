"use client";

import React, { useState, useMemo, useCallback } from "react";
import { xdr, scValToNative } from "@stellar/stellar-sdk";
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
  ArrowRightLeft
} from "lucide-react";

export interface XdrDecoderInspectorProps {
  initialXdr?: string;
  onSelectXdr?: (xdrString: string) => void;
}

type XdrType =
  | "Auto"
  | "ScVal"
  | "TransactionEnvelope"
  | "TransactionResult"
  | "DiagnosticEvent"
  | "ContractEvent"
  | "LedgerKey";

interface DecodeResult {
  type: string;
  nativeValue: any;
  rawXdrObject: any;
  jsonString: string;
  error?: string;
}

// Sample base64 XDRs for quick testing
const SAMPLE_XDRS = [
  {
    name: "ScVal (Symbol: 'hello')",
    type: "ScVal" as const,
    xdr: "AAAAEAAAAAVoZWxsbw=="
  },
  {
    name: "ScVal (U32: 100)",
    type: "ScVal" as const,
    xdr: "AAAAAwAAAAZkZWZhdWx0AAAAAA=="
  },
  {
    name: "ScVal (Vec of Symbols)",
    type: "ScVal" as const,
    xdr: "AAAAEAAAAAEAAAAQAAAAA3N1Yw=="
  },
  {
    name: "LedgerKey (Contract Data)",
    type: "LedgerKey" as const,
    xdr: "AAAAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAEAAAAEaW5pdAAAAA=="
  }
];

function safeReplacer(_key: string, value: any) {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return Buffer.from(value).toString("hex");
  }
  return value;
}

export default function XdrDecoderInspector({
  initialXdr = "",
}: XdrDecoderInspectorProps) {
  const [xdrInput, setXdrInput] = useState<string>(initialXdr);
  const [selectedType, setSelectedType] = useState<XdrType>("Auto");
  const [filterQuery, setFilterQuery] = useState<string>("");
  const [copiedRaw, setCopiedRaw] = useState<boolean>(false);
  const [copiedJson, setCopiedJson] = useState<boolean>(false);
  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({
    root: true,
  });

  const decodeXdr = useCallback(
    (inputStr: string, targetType: XdrType): DecodeResult => {
      const cleanInput = inputStr.trim();
      if (!cleanInput) {
        return {
          type: "Empty",
          nativeValue: null,
          rawXdrObject: null,
          jsonString: "",
        };
      }

      const typesToTry: Exclude<XdrType, "Auto">[] =
        targetType === "Auto"
          ? [
              "ScVal",
              "TransactionEnvelope",
              "TransactionResult",
              "DiagnosticEvent",
              "ContractEvent",
              "LedgerKey",
            ]
          : [targetType];

      for (const t of typesToTry) {
        try {
          let decodedObj: any = null;
          let nativeVal: any = null;

          switch (t) {
            case "ScVal": {
              const scval = xdr.ScVal.fromXDR(cleanInput, "base64");
              decodedObj = scval;
              try {
                nativeVal = scValToNative(scval);
              } catch {
                nativeVal = { arm: scval.switch().name };
              }
              break;
            }
            case "TransactionEnvelope": {
              decodedObj = xdr.TransactionEnvelope.fromXDR(cleanInput, "base64");
              nativeVal = decodedObj.toJSON();
              break;
            }
            case "TransactionResult": {
              decodedObj = xdr.TransactionResult.fromXDR(cleanInput, "base64");
              nativeVal = decodedObj.toJSON();
              break;
            }
            case "DiagnosticEvent": {
              decodedObj = xdr.DiagnosticEvent.fromXDR(cleanInput, "base64");
              nativeVal = {
                inSuccessfulContractCall: decodedObj.inSuccessfulContractCall(),
                event: decodedObj.event().toJSON(),
              };
              break;
            }
            case "ContractEvent": {
              decodedObj = xdr.ContractEvent.fromXDR(cleanInput, "base64");
              nativeVal = decodedObj.toJSON();
              break;
            }
            case "LedgerKey": {
              decodedObj = xdr.LedgerKey.fromXDR(cleanInput, "base64");
              nativeVal = decodedObj.toJSON();
              break;
            }
          }

          const jsonString = JSON.stringify(nativeVal, safeReplacer, 2);
          return {
            type: t,
            nativeValue: nativeVal,
            rawXdrObject: decodedObj,
            jsonString,
          };
        } catch {
          // continue to next type if Auto
        }
      }

      return {
        type: "Unknown",
        nativeValue: null,
        rawXdrObject: null,
        jsonString: "",
        error: "Failed to decode base64 XDR string. Please verify input and selected type.",
      };
    },
    []
  );

  const decodeResult = useMemo(() => {
    return decodeXdr(xdrInput, selectedType);
  }, [xdrInput, selectedType, decodeXdr]);

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

  const toggleExpand = (path: string) => {
    setExpandedKeys((prev) => ({
      ...prev,
      [path]: !prev[path],
    }));
  };

  const renderJsonTree = (data: any, path = "root", depth = 0) => {
    if (data === null) {
      return <span className="text-gray-500 italic">null</span>;
    }
    if (data === undefined) {
      return <span className="text-gray-500 italic">undefined</span>;
    }
    if (typeof data === "boolean") {
      return <span className="text-purple-400 font-semibold">{data ? "true" : "false"}</span>;
    }
    if (typeof data === "number" || typeof data === "bigint") {
      return <span className="text-amber-300 font-mono">{String(data)}</span>;
    }
    if (typeof data === "string") {
      if (filterQuery && data.toLowerCase().includes(filterQuery.toLowerCase())) {
        return (
          <span className="text-emerald-300 bg-emerald-950/80 px-1 rounded font-mono">
            &quot;{data}&quot;
          </span>
        );
      }
      return <span className="text-emerald-400 font-mono">&quot;{data}&quot;</span>;
    }

    if (Array.isArray(data)) {
      if (data.length === 0) return <span className="text-gray-400">[]</span>;
      const isExpanded = expandedKeys[path] ?? (depth < 2);

      return (
        <div className="inline-block w-full">
          <button
            type="button"
            onClick={() => toggleExpand(path)}
            className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 font-mono text-xs cursor-pointer focus:outline-none"
          >
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span className="text-gray-400">Array({data.length})</span>
          </button>

          {isExpanded && (
            <div className="pl-4 border-l border-cyan-900/40 my-1 space-y-1">
              {data.map((item, idx) => (
                <div key={`${path}-${idx}`} className="flex items-start gap-2">
                  <span className="text-slate-500 text-xs font-mono">{idx}:</span>
                  {renderJsonTree(item, `${path}[${idx}]`, depth + 1)}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    if (typeof data === "object") {
      const keys = Object.keys(data);
      if (keys.length === 0) return <span className="text-gray-400">{"{}"}</span>;
      const isExpanded = expandedKeys[path] ?? (depth < 2);

      return (
        <div className="inline-block w-full">
          <button
            type="button"
            onClick={() => toggleExpand(path)}
            className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 font-mono text-xs cursor-pointer focus:outline-none"
          >
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span className="text-slate-300 font-medium">Object</span>
            <span className="text-slate-500 text-[11px]">({keys.length} keys)</span>
          </button>

          {isExpanded && (
            <div className="pl-4 border-l border-cyan-900/40 my-1 space-y-1">
              {keys.map((key) => {
                const subPath = `${path}.${key}`;
                const keyMatches =
                  filterQuery && key.toLowerCase().includes(filterQuery.toLowerCase());

                return (
                  <div key={subPath} className="flex items-start gap-2 text-xs">
                    <span
                      className={`font-mono ${
                        keyMatches
                          ? "text-amber-300 bg-amber-950/80 px-1 rounded font-semibold"
                          : "text-cyan-300"
                      }`}
                    >
                      {key}:
                    </span>
                    <div className="flex-1">{renderJsonTree(data[key], subPath, depth + 1)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    return <span>{String(data)}</span>;
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 bg-slate-900/90 border-b border-slate-800 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gradient-to-tr from-cyan-600 to-teal-500 text-white shadow-lg shadow-cyan-500/20">
            <Code2 size={20} />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
              Soroban XDR Inspector
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/20">
                Interactive Decoder
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              Decode base64 XDR return values, diagnostic events, and ledger keys in real time
            </p>
          </div>
        </div>

        {/* Decoder Type Switcher */}
        <div className="flex items-center gap-2 bg-slate-950/80 p-1 rounded-xl border border-slate-800">
          <Layers size={14} className="text-slate-400 ml-2" />
          <span className="text-xs text-slate-400 mr-1">Type:</span>
          {(
            [
              "Auto",
              "ScVal",
              "TransactionEnvelope",
              "TransactionResult",
              "DiagnosticEvent",
              "LedgerKey",
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

      {/* Main Content Body */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 flex-1 divide-y lg:divide-y-0 lg:divide-x divide-slate-800">
        {/* Left Side: XDR Input & Presets */}
        <div className="flex flex-col p-6 space-y-5 bg-slate-950">
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

          <div className="relative flex-1 min-h-[160px]">
            <textarea
              value={xdrInput}
              onChange={(e) => setXdrInput(e.target.value)}
              placeholder="Paste base64 XDR payload here (e.g. AAAAEAAAAAVoZWxsbw==)..."
              className="w-full h-full p-4 font-mono text-xs bg-slate-900/70 text-cyan-200 border border-slate-800 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition resize-none"
            />
          </div>

          {/* Sample Presets */}
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-slate-400 mb-2">
              <Sparkles size={14} className="text-amber-400" />
              <span>Quick Sample Presets:</span>
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
                  className="px-3 py-1.5 text-xs bg-slate-900 border border-slate-800 hover:border-cyan-500/50 text-slate-300 hover:text-cyan-300 rounded-lg transition-all flex items-center gap-1.5"
                >
                  <Zap size={12} className="text-cyan-400" />
                  {sample.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right Side: Decoded JSON Tree & Visual Inspection */}
        <div className="flex flex-col p-6 bg-slate-900/40">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Decoded Inspection
              </span>
              {decodeResult.type && decodeResult.type !== "Empty" && (
                <span className="px-2 py-0.5 text-xs font-medium bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 rounded-full flex items-center gap-1">
                  <ArrowRightLeft size={12} />
                  {decodeResult.type}
                </span>
              )}
            </div>

            {decodeResult.jsonString && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleCopy(xdrInput, false)}
                  className="px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition flex items-center gap-1"
                >
                  {copiedRaw ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                  Copy XDR
                </button>
                <button
                  type="button"
                  onClick={() => handleCopy(decodeResult.jsonString, true)}
                  className="px-2.5 py-1 text-xs bg-cyan-600 hover:bg-cyan-500 font-medium text-slate-950 rounded-lg transition shadow-md shadow-cyan-600/20 flex items-center gap-1"
                >
                  {copiedJson ? <Check size={12} className="text-slate-950" /> : <Copy size={12} />}
                  Copy JSON
                </button>
              </div>
            )}
          </div>

          {/* Search Filter for Decoded JSON */}
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
                placeholder="Filter decoded fields or values..."
                className="w-full pl-9 pr-4 py-1.5 text-xs bg-slate-950 text-slate-200 border border-slate-800 rounded-xl focus:outline-none focus:border-cyan-500 transition"
              />
            </div>
          )}

          {/* Decoded Content Viewer */}
          <div className="flex-1 bg-slate-950 p-4 rounded-xl border border-slate-800 overflow-y-auto max-h-[380px]">
            {decodeResult.error ? (
              <div className="p-4 bg-rose-950/40 border border-rose-800/50 rounded-xl text-rose-300 text-xs">
                <p className="font-semibold mb-1">Decoding Error</p>
                <p className="text-rose-400">{decodeResult.error}</p>
              </div>
            ) : decodeResult.nativeValue === null ? (
              <div className="flex flex-col items-center justify-center h-48 text-center text-slate-500">
                <RefreshCw size={24} className="mb-2 opacity-40 animate-pulse" />
                <p className="text-xs">Enter or paste a base64 XDR string on the left to inspect decoded details.</p>
              </div>
            ) : (
              <div className="font-mono text-xs">
                {renderJsonTree(decodeResult.nativeValue, "root")}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
