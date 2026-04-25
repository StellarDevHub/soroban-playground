"use client";

import React, { useMemo, useReducer, useState } from "react";
import Editor from "@/components/Editor";
import Console from "@/components/Console";
import DeployPanel from "@/components/DeployPanel";
import CallPanel from "@/components/CallPanel";
import WasmArtifactPanel from "@/components/WasmArtifactPanel";
import StorageViewer from "@/components/StorageViewer";
import TransactionCallGraph from "@/components/TransactionCallGraph";
import {
  parseTransactionInvocationPayload,
  type TransactionCallGraph as TransactionCallGraphState,
  type LedgerState,
} from "@/utils/transactionGraph";
import { parseWasmArtifact, type WasmArtifactAnalysis } from "@/utils/wasmInspector";
import {
  createInitialStorageTimelineState,
  storageTimelineReducer,
} from "@/state/storageTimeline";
import { useConsoleStream } from "@/hooks/useConsoleStream";
import { Sparkles, Code2, BookOpen } from "lucide-react";

const DEFAULT_CODE = `#![no_std]
use soroban_sdk::{contract, contractimpl, Env, Symbol};

#[contract]
pub struct HelloContract;

#[contractimpl]
impl HelloContract {
    pub fn hello(env: Env, name: Symbol) -> Symbol {
        name
    }
}
`;

const API_BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:5000";

interface CompileArtifactPayload {
  name?: string;
  sizeBytes?: number;
  createdAt?: string;
}

interface CompileSuccessPayload {
  success?: boolean;
  message?: string;
  logs?: unknown;
  artifact?: CompileArtifactPayload;
  wasmBase64?: string;
}

function shortId(contractId: string): string {
  return contractId.length > 14 ? `${contractId.slice(0, 8)}...${contractId.slice(-4)}` : contractId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asLedgerNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function formatByteSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function extractCompileFailureMessage(payload: unknown): string {
  if (!isRecord(payload)) {
    return "Compilation failed";
  }

  const summary = typeof payload.message === "string" ? payload.message : "Compilation failed";
  const details = payload.details;

  if (typeof details === "string" && details.trim()) {
    return `${summary}: ${details}`;
  }

  if (isRecord(details) && typeof details.details === "string" && details.details.trim()) {
    return `${summary}: ${details.details}`;
  }

  return summary;
}

function buildHexPayload(seed: number): string {
  const base = seed.toString(16).padStart(16, "0");
  const repeated = `${base}a1b2c3d4e5f6`.repeat(5);
  return `0x${repeated}`;
}

function createMockInvocationPayload(
  contractId: string,
  funcName: string,
  args: Record<string, string>,
  baseStorage: LedgerState,
): unknown {
  const timestamp = Date.now();
  const serializedArgs = JSON.stringify(args);
  const userName = args.name ?? "anonymous";
  const transactionCount = asLedgerNumber(baseStorage.tx_sequence) + 1;
  const existingCheckpoints = isRecord(baseStorage.checkpoints) ? baseStorage.checkpoints : {};
  const checkpointKey = `tx:${timestamp}`;

  const rootStorage = {
    ...baseStorage,
    last_function: funcName,
    last_args: serializedArgs,
    last_invoked_at: new Date(timestamp).toISOString(),
    tx_sequence: transactionCount,
    ledger_meta: {
      actor: userName,
      function: funcName,
      arg_keys: Object.keys(args),
    },
    last_event_hex: buildHexPayload(timestamp),
  };

  const routerContract = `ROUTER_${shortId(contractId)}`;
  const tokenContract = `TOKEN_${shortId(contractId)}`;
  const auditContract = `AUDIT_${shortId(contractId)}`;

  return {
    txHash: `0x${Math.random().toString(16).slice(2).padEnd(64, "0")}`,
    invocationTree: {
      id: `root-${timestamp}`,
      contractId,
      function: funcName,
      args,
      result: funcName === "hello" ? userName : "ok",
      ledgerState: rootStorage,
      children: [
        {
          id: `router-${timestamp}`,
          contract: routerContract,
          fn: "route_call",
          args: {
            target: tokenContract,
            original_method: funcName,
          },
          result: "forwarded",
          ledgerState: {
            route_count: asLedgerNumber(baseStorage.route_count) + 1,
            last_route_target: tokenContract,
            route_stats: {
              total_routes: asLedgerNumber(baseStorage.route_count) + 1,
              last_success: true,
              depth_seen: [0, 1],
            },
          },
          children: [
            {
              id: `token-${timestamp}`,
              contractId: tokenContract,
              method: "write_checkpoint",
              arguments: {
                checkpoint_key: `tx:${timestamp}`,
                greeting: userName,
              },
              output: "checkpoint_written",
              storage: {
                last_greeting: userName,
                checkpoint_count: asLedgerNumber(baseStorage.checkpoint_count) + 1,
                checkpoints: {
                  ...existingCheckpoints,
                  [checkpointKey]: {
                    greeting: userName,
                    args,
                    recorded_at: new Date(timestamp).toISOString(),
                    digest: buildHexPayload(timestamp + 7),
                  },
                },
              },
              children: [],
            },
          ],
        },
        {
          id: `audit-${timestamp}`,
          contract_id: auditContract,
          entrypoint: "audit_event",
          params: {
            caller_contract: contractId,
            invoked_function: funcName,
          },
          returnValue: "audit_ok",
          state: {
            audit_trail_size: asLedgerNumber(baseStorage.audit_trail_size) + 1,
            last_audited_fn: funcName,
            audit_meta: {
              tx_tag: `AUDIT-${timestamp}`,
              observed_contracts: [contractId, routerContract, tokenContract],
            },
          },
          subInvocations: [],
        },
      ],
    },
  };
}

export default function Home() {
  const [code, setCode] = useState(DEFAULT_CODE);
  const {
    logs,
    baseLineNumber,
    droppedMessages,
    isIngestionPaused,
    setIngestionPaused,
    appendLog,
    appendLogs,
    clearLogs,
  } = useConsoleStream();

  // Status states
  const [isCompiling, setIsCompiling] = useState(false);
  const [hasCompiled, setHasCompiled] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [isInvoking, setIsInvoking] = useState(false);
  const [isAnalyzingWasm, setIsAnalyzingWasm] = useState(false);
  const [compileSummary, setCompileSummary] = useState<string | undefined>(undefined);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [wasmParseError, setWasmParseError] = useState<string | null>(null);
  const [wasmAnalysis, setWasmAnalysis] = useState<WasmArtifactAnalysis | null>(null);
  const [compiledArtifact, setCompiledArtifact] = useState<CompileArtifactPayload | null>(null);

  // Contract Data
  const [contractId, setContractId] = useState<string | undefined>(undefined);
  const [storageTimeline, dispatchStorageTimeline] = useReducer(
    storageTimelineReducer,
    undefined,
    createInitialStorageTimelineState,
  );
  const [transactionGraph, setTransactionGraph] = useState<TransactionCallGraphState>({
    nodes: [],
    edges: [],
  });
  const [selectedGraphNodeId, setSelectedGraphNodeId] = useState<string | undefined>(undefined);

  const activeSnapshot =
    storageTimeline.currentIndex >= 0 ? storageTimeline.snapshots[storageTimeline.currentIndex] : undefined;
  const previousSnapshot =
    storageTimeline.currentIndex > 0 ? storageTimeline.snapshots[storageTimeline.currentIndex - 1] : undefined;
  const activeStorage = useMemo(() => activeSnapshot?.state ?? {}, [activeSnapshot]);
  const storageContextLabel = activeSnapshot?.contextLabel ?? "Latest contract snapshot";

  const handleCompile = async () => {
    setIsCompiling(true);
    clearLogs();
    setHasCompiled(false);
    setCompileSummary(undefined);
    setCompileError(null);
    setWasmParseError(null);
    setWasmAnalysis(null);
    setCompiledArtifact(null);
    appendLog("Compiling contract...");

    try {
      const response = await fetch(`${API_BASE_URL}/api/compile`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code }),
      });

      const payload = (await response.json().catch(() => null)) as unknown;

      if (!response.ok) {
        throw new Error(extractCompileFailureMessage(payload));
      }

      if (!isRecord(payload)) {
        throw new Error("Compilation failed: invalid server response");
      }

      const compilePayload = payload as CompileSuccessPayload;
      const compileLogs = Array.isArray(compilePayload.logs)
        ? compilePayload.logs.filter((item): item is string => typeof item === "string")
        : [];
      const artifact = isRecord(compilePayload.artifact)
        ? {
            name: typeof compilePayload.artifact.name === "string" ? compilePayload.artifact.name : undefined,
            sizeBytes:
              typeof compilePayload.artifact.sizeBytes === "number" ? compilePayload.artifact.sizeBytes : undefined,
            createdAt: typeof compilePayload.artifact.createdAt === "string" ? compilePayload.artifact.createdAt : undefined,
          }
        : null;

      appendLogs(compileLogs);
      setIsCompiling(false);
      setHasCompiled(true);
      appendLog("✓ Compilation successful");

      if (artifact?.sizeBytes !== undefined) {
        appendLog(`WASM size: ${formatByteSize(artifact.sizeBytes)} (${artifact.sizeBytes} bytes)`);
      }

      setCompiledArtifact(artifact);
      setCompileSummary(
        artifact?.sizeBytes !== undefined
          ? `Compilation successful (${artifact.name ?? "artifact"} • ${formatByteSize(artifact.sizeBytes)})`
          : "Compilation successful",
      );

      if (!compilePayload.wasmBase64) {
        const missingPayloadMessage = "Compiled artifact did not include wasm bytes for browser-side analysis.";
        setWasmParseError(missingPayloadMessage);
        appendLog(`⚠ ${missingPayloadMessage}`);
        return;
      }

      setIsAnalyzingWasm(true);
      appendLog("Analyzing wasm artifact in browser...");
      try {
        const parsedWasm = await parseWasmArtifact(compilePayload.wasmBase64);
        setWasmAnalysis(parsedWasm);
        appendLog(
          `✓ Wasm analysis complete: ${parsedWasm.exportFunctions.length} function exports, ${parsedWasm.watLines.length.toLocaleString()} WAT lines.`,
        );
      } catch (analysisError) {
        const message = analysisError instanceof Error ? analysisError.message : "Failed to parse compiled wasm artifact";
        setWasmParseError(message);
        appendLog(`⚠ Wasm analysis failed: ${message}`);
      } finally {
        setIsAnalyzingWasm(false);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Compilation failed";
      setCompileError(message);
      setIsCompiling(false);
      appendLog(`✗ ${message}`);
    }
  };

  const handleDeploy = async () => {
    setIsDeploying(true);
    appendLog("Deploying to Stellar Testnet...");

    // Simulate deployment
    setTimeout(() => {
      setIsDeploying(false);
      const newContractId = "C" + Math.random().toString(36).substring(2, 34).toUpperCase();
      setContractId(newContractId);
      setTransactionGraph({ nodes: [], edges: [] });
      setSelectedGraphNodeId(undefined);

      appendLog("✓ Contract deployed successfully");
      appendLog(`Contract ID: ${newContractId}`);

      const deployedState = {
        admin: "G" + Math.random().toString(36).substring(2, 34).toUpperCase(),
        checkpoint_count: 0,
        route_count: 0,
        audit_trail_size: 0,
        tx_sequence: 0,
      };

      dispatchStorageTimeline({
        type: "reset_with_deployment",
        contractId: newContractId,
        state: deployedState,
      });
    }, 2500);
  };

  const handleGraphNodeSelect = (nodeId: string) => {
    setSelectedGraphNodeId(nodeId);
    const selectedNode = transactionGraph.nodes.find((node) => node.id === nodeId);

    if (!selectedNode) {
      return;
    }

    dispatchStorageTimeline({
      type: "select_snapshot_for_node",
      nodeId,
    });
    appendLog(`Inspecting call node: ${selectedNode.contractId} -> ${selectedNode.functionName}`);
  };

  const handleTimelineScrub = (index: number) => {
    const snapshot = storageTimeline.snapshots[index];
    setSelectedGraphNodeId(snapshot?.nodeId);
    dispatchStorageTimeline({
      type: "select_snapshot_index",
      index,
    });
  };

  const handleInvoke = async (funcName: string, args: Record<string, string>) => {
    if (!contractId) {
      return;
    }

    setIsInvoking(true);
    appendLog(`Invoking ${contractId} -> ${funcName}(${JSON.stringify(args)})`);

    // Simulate call result payload with nested contract invocations.
    setTimeout(() => {
      setIsInvoking(false);

      const invocationPayload = createMockInvocationPayload(contractId, funcName, args, activeStorage);
      const parsedGraph = parseTransactionInvocationPayload(invocationPayload);
      setTransactionGraph(parsedGraph);

      if (parsedGraph.nodes.length === 0) {
        appendLog("⚠ No invocation graph could be derived from payload.");
        return;
      }

      dispatchStorageTimeline({
        type: "append_transaction_frames",
        nodes: parsedGraph.nodes,
        txHash: parsedGraph.txHash,
      });

      const terminalNode = parsedGraph.nodes[parsedGraph.nodes.length - 1];
      setSelectedGraphNodeId(terminalNode.id);

      const uniqueContracts = new Set(parsedGraph.nodes.map((node) => node.contractId)).size;
      appendLog(`✓ Captured invocation tree: ${parsedGraph.nodes.length} calls across ${uniqueContracts} contracts.`);

      if (funcName === "hello" && args.name) {
        appendLog(`✓ Return value: "${args.name}"`);
      } else {
        appendLog("✓ Call completed successfully. Click graph nodes to inspect intermediate ledger snapshots.");
      }
    }, 1400);
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#0A0A0A]">
      {/* Navbar */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-950">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-600 to-blue-500 flex items-center justify-center shadow-[0_0_15px_rgba(8,145,178,0.4)]">
            <Sparkles size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-300 to-blue-400">
              Soroban Playground
            </h1>
            <p className="text-xs text-gray-500 tracking-wider">Browser-based Stellar IDE</p>
          </div>
        </div>
        <div className="flex items-center space-x-4">
          <a href="#" className="flex items-center text-sm text-gray-400 hover:text-gray-200 transition">
            <BookOpen size={16} className="mr-2" /> Docs
          </a>
          <button className="flex items-center px-4 py-2 bg-gray-800 hover:bg-gray-700 text-sm font-medium rounded-lg transition border border-gray-700">
            <Code2 size={16} className="mr-2" /> Load Template
          </button>
        </div>
      </header>

      {/* Main Layout */}
      <main className="flex-1 flex overflow-hidden">
        {/* Left pane: Editor */}
        <section className="flex-1 flex flex-col p-4 border-r border-gray-800">
          <div className="flex items-center justify-between mb-3 px-2">
            <span className="text-sm font-semibold text-gray-400 tracking-wider uppercase flex items-center">
              <Code2 size={16} className="mr-2" /> Contract Code
            </span>
            <span className="text-xs text-gray-600">lib.rs</span>
          </div>
          <Editor code={code} setCode={setCode} />
        </section>

        {/* Right pane: Controls & Terminal */}
        <section className="w-[520px] min-w-[380px] flex flex-col p-4 overflow-y-auto space-y-4 bg-[#0F0F0F]">
          <DeployPanel
            onCompile={handleCompile}
            onDeploy={handleDeploy}
            isCompiling={isCompiling}
            isDeploying={isDeploying}
            hasCompiled={hasCompiled}
            compileSummary={compileSummary}
            compileError={compileError}
            contractId={contractId}
          />
          <WasmArtifactPanel
            analysis={wasmAnalysis}
            artifactName={compiledArtifact?.name}
            artifactCreatedAt={compiledArtifact?.createdAt}
            isAnalyzing={isAnalyzingWasm}
            parseError={wasmParseError}
          />
          <CallPanel onInvoke={handleInvoke} isInvoking={isInvoking} contractId={contractId} />
          <TransactionCallGraph
            graph={transactionGraph}
            selectedNodeId={selectedGraphNodeId}
            onNodeSelect={handleGraphNodeSelect}
          />
          <StorageViewer
            storage={activeStorage}
            previousStorage={previousSnapshot?.state}
            contextLabel={storageContextLabel}
            totalFrames={storageTimeline.snapshots.length}
            currentFrame={Math.max(storageTimeline.currentIndex, 0)}
            capturedAt={activeSnapshot?.capturedAt}
            onScrubTimeline={handleTimelineScrub}
          />

          <div className="mt-auto pt-4">
            <Console
              logs={logs}
              baseLineNumber={baseLineNumber}
              droppedMessages={droppedMessages}
              isIngestionPaused={isIngestionPaused}
              onIngestionPauseChange={setIngestionPaused}
            />
          </div>
        </section>
      </main>
    </div>
  );
}
