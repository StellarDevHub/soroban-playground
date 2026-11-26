/// <reference lib="webworker" />

import { parseSorobanMetadata } from "../utils/sorobanMetadata";
import { loadBinaryen } from "./loadBinaryen";
import {
  optimiseWasm,
  type BytecodeProfile,
  type WasmOptPasses,
  type WasmOptPassResult,
} from "./wasmOptCore";

export type {
  WasmOptPasses,
  WasmOptPassResult,
  WasmSectionEntry,
  WasmSectionProfile,
  BytecodeProfile,
} from "./wasmOptCore";

export interface WasmOptRequest {
  type: "optimize";
  id: number;
  bytes: Uint8Array;
  passes: WasmOptPasses;
}

export interface WasmOptProgress {
  type: "progress";
  id: number;
  stage: string;
  percent: number;
}

export interface WasmOptSuccess {
  type: "success";
  id: number;
  originalBytes: number;
  optimizedBytes: number;
  reductionBytes: number;
  reductionPct: number;
  passResults: WasmOptPassResult[];
  optimized: Uint8Array;
  sorobanSections: string[];
  specIdentifiers: string[];
  profile: BytecodeProfile;
}

export interface WasmOptError {
  type: "error";
  id: number;
  message: string;
}

export type WasmOptResponse = WasmOptProgress | WasmOptSuccess | WasmOptError;

type IncomingMessage = WasmOptRequest;

const scope = self as unknown as DedicatedWorkerGlobalScope;

function reply(message: WasmOptResponse, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer);
}

scope.onmessage = async (event: MessageEvent<IncomingMessage>) => {
  const msg = event.data;
  if (!msg || msg.type !== "optimize") return;

  const { id, bytes, passes } = msg;

  try {
    reply({ type: "progress", id, stage: "Preparing optimiser", percent: 8 });
    const binaryen = await loadBinaryen().catch(() => null);

    const result = await optimiseWasm(
      bytes,
      passes,
      (stage, percent) => reply({ type: "progress", id, stage, percent }),
      binaryen,
    );

    const originalBytes = bytes.byteLength;
    const optimizedBytes = result.output.byteLength;
    const reductionBytes = originalBytes - optimizedBytes;
    const reductionPct =
      originalBytes > 0
        ? Number(((reductionBytes / originalBytes) * 100).toFixed(1))
        : 0;

    const outputMeta = parseSorobanMetadata(result.output);
    const response: WasmOptSuccess = {
      type: "success",
      id,
      originalBytes,
      optimizedBytes,
      reductionBytes,
      reductionPct,
      passResults: result.passResults,
      optimized: result.output,
      sorobanSections: outputMeta.sorobanSectionNames,
      specIdentifiers: outputMeta.specIdentifiers,
      profile: result.profile,
    };

    reply(response, [result.output.buffer as ArrayBuffer]);
  } catch (error) {
    reply({
      type: "error",
      id,
      message: error instanceof Error ? error.message : "Unknown optimiser error",
    });
  }
};

export {};
