/// <reference lib="webworker" />

/**
 * wasmDisassembly.worker.ts — [FRONTEND-298]
 *
 * Runs WebAssembly bytecode to WAT (WebAssembly Text) disassembly entirely
 * off the main UI thread using wabt.js to eliminate browser lockups on large binaries (>100KB).
 */

import wabtFactory from "wabt";
import {
  parseSorobanMetadata,
  type SorobanMetadataReport,
} from "@/utils/sorobanMetadata";

export interface WasmDisassemblyRequest {
  type: "disassemble";
  id: number;
  bytes: Uint8Array;
  options?: {
    readDebugNames?: boolean;
    foldExprs?: boolean;
    inlineExport?: boolean;
  };
}

export interface WasmExportSummary {
  name: string;
  kind: "function" | "table" | "memory" | "global" | string;
}

export interface WasmImportSummary {
  module: string;
  name: string;
  kind: "function" | "table" | "memory" | "global" | string;
}

export interface WasmDisassemblySummary {
  byteSize: number;
  watLineCount: number;
  exports: WasmExportSummary[];
  imports: WasmImportSummary[];
  functionCount: number;
  memoryCount: number;
  tableCount: number;
  globalCount: number;
  sorobanMetadata?: SorobanMetadataReport;
}

export interface WasmDisassemblySuccess {
  type: "success";
  id: number;
  wat: string;
  summary: WasmDisassemblySummary;
}

export interface WasmDisassemblyError {
  type: "error";
  id: number;
  message: string;
}

export type WasmDisassemblyResponse =
  | WasmDisassemblySuccess
  | WasmDisassemblyError;

let wabtPromise: ReturnType<typeof wabtFactory> | null = null;

async function getWabtInstance() {
  if (!wabtPromise) {
    wabtPromise = wabtFactory();
  }
  return wabtPromise;
}

// Extract basic module exports/imports safely from binary
function extractModuleStructure(bytes: Uint8Array): {
  exports: WasmExportSummary[];
  imports: WasmImportSummary[];
} {
  const exportsList: WasmExportSummary[] = [];
  const importsList: WasmImportSummary[] = [];

  try {
    if (typeof WebAssembly !== "undefined" && WebAssembly.compile) {
      // synchronous validation or sync module extraction if available
    }
  } catch {
    // Graceful fallback
  }

  return { exports: exportsList, imports: importsList };
}

(self as DedicatedWorkerGlobalScope).onmessage = async (
  event: MessageEvent<WasmDisassemblyRequest>,
) => {
  const msg = event.data;
  if (!msg || msg.type !== "disassemble") return;

  const { id, bytes, options = {} } = msg;

  try {
    if (!bytes || bytes.length === 0) {
      throw new Error("Empty WASM binary received");
    }

    // Verify WASM magic header: \0asm
    if (
      bytes.length < 4 ||
      bytes[0] !== 0x00 ||
      bytes[1] !== 0x61 ||
      bytes[2] !== 0x73 ||
      bytes[3] !== 0x6d
    ) {
      throw new Error("Invalid WebAssembly binary: Missing magic header (\\0asm)");
    }

    const wabt = await getWabtInstance();

    const parsed = wabt.readWasm(bytes, {
      readDebugNames: options.readDebugNames ?? true,
      exceptions: true,
      mutable_globals: true,
      sat_float_to_int: true,
      sign_extension: true,
      simd: true,
      threads: true,
      function_references: true,
      multi_value: true,
      tail_call: true,
      bulk_memory: true,
      reference_types: true,
      annotations: true,
      code_metadata: true,
      gc: true,
      memory64: true,
      extended_const: true,
      relaxed_simd: true,
    });

    try {
      parsed.generateNames();
      parsed.applyNames();
    } catch {
      // Optional naming
    }

    const wat = parsed.toText({
      foldExprs: options.foldExprs ?? false,
      inlineExport: options.inlineExport ?? false,
    });

    // Parse exports & imports from WAT structure or module reflection
    const lines = wat.split("\n");
    const exports: WasmExportSummary[] = [];
    const imports: WasmImportSummary[] = [];
    let functionCount = 0;
    let memoryCount = 0;
    let tableCount = 0;
    let globalCount = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("(export ")) {
        const match = trimmed.match(/^\(export\s+"([^"]+)"\s*\((func|memory|table|global)/);
        if (match) {
          exports.push({
            name: match[1],
            kind: match[2] as WasmExportSummary["kind"],
          });
        }
      } else if (trimmed.startsWith("(import ")) {
        const match = trimmed.match(/^\(import\s+"([^"]+)"\s+"([^"]+)"\s*\((func|memory|table|global)/);
        if (match) {
          imports.push({
            module: match[1],
            name: match[2],
            kind: match[3] as WasmImportSummary["kind"],
          });
        }
      } else if (trimmed.startsWith("(func ")) {
        functionCount++;
      } else if (trimmed.startsWith("(memory ")) {
        memoryCount++;
      } else if (trimmed.startsWith("(table ")) {
        tableCount++;
      } else if (trimmed.startsWith("(global ")) {
        globalCount++;
      }
    }

    // Soroban custom sections metadata
    let sorobanMetadata: SorobanMetadataReport | undefined;
    try {
      sorobanMetadata = parseSorobanMetadata(bytes);
    } catch {
      // Soroban metadata optional
    }

    const summary: WasmDisassemblySummary = {
      byteSize: bytes.byteLength,
      watLineCount: lines.length,
      exports,
      imports,
      functionCount,
      memoryCount,
      tableCount,
      globalCount,
      sorobanMetadata,
    };

    const response: WasmDisassemblySuccess = {
      type: "success",
      id,
      wat,
      summary,
    };

    (self as DedicatedWorkerGlobalScope).postMessage(response);
  } catch (err) {
    const errorResponse: WasmDisassemblyError = {
      type: "error",
      id,
      message: err instanceof Error ? err.message : "Failed to disassemble WebAssembly binary",
    };
    (self as DedicatedWorkerGlobalScope).postMessage(errorResponse);
  }
};

export {};
