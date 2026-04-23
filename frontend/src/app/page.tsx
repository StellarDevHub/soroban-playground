"use client";

import React, { useEffect, useState } from "react";
import {
  Activity,
  BookOpen,
  ChevronRight,
  Code2,
  Globe,
  LoaderCircle,
  Orbit,
  Server,
  Sparkles,
} from "lucide-react";
import Editor from "@/components/Editor";
import Console from "@/components/Console";
import DeployPanel from "@/components/DeployPanel";
import CallPanel from "@/components/CallPanel";
import StorageViewer from "@/components/StorageViewer";
import TransactionCallGraph from "@/components/TransactionCallGraph";
import {
  parseTransactionInvocationPayload,
  type TransactionCallGraph as TransactionCallGraphState,
  type LedgerState,
} from "@/utils/transactionGraph";
import { Sparkles, Code2, BookOpen } from "lucide-react";

const DEFAULT_CODE = `#![no_std]
use soroban_sdk::{contract, contractimpl, symbol_short, Env, Symbol};

#[contract]
pub struct HelloContract;

#[contractimpl]
impl HelloContract {
    pub fn hello(_env: Env, name: Symbol) -> Symbol {
        name
    }

    pub fn version(_env: Env) -> Symbol {
        symbol_short!("v1")
    }
}
`;

function shortId(contractId: string): string {
  return contractId.length > 14 ? `${contractId.slice(0, 8)}...${contractId.slice(-4)}` : contractId;
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
  const rootStorage = {
    ...baseStorage,
    last_function: funcName,
    last_args: serializedArgs,
    last_invoked_at: new Date(timestamp).toISOString(),
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
            route_count: String(Number(baseStorage.route_count ?? "0") + 1),
            last_route_target: tokenContract,
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
                checkpoint_count: String(Number(baseStorage.checkpoint_count ?? "0") + 1),
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
            audit_trail_size: String(Number(baseStorage.audit_trail_size ?? "0") + 1),
            last_audited_fn: funcName,
          },
          subInvocations: [],
        },
      ],
    },
  };
const DEFAULT_API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ||
  "http://localhost:5000";

type HealthState = "checking" | "online" | "offline";

type CompileResponse = {
  success: boolean;
  status: string;
  message: string;
  logs?: string[];
  artifact?: {
    name: string;
    sizeBytes: number;
    createdAt?: string;
  };
};

type ApiErrorPayload = {
  message?: string;
  statusCode?: number;
  details?: unknown;
};

function formatApiError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return "Something unexpected happened.";
}

function toStorageRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, String(entry)])
  );
}

export default function Home() {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [logs, setLogs] = useState<string[]>([]);

  // Status states
  const [logs, setLogs] = useState<string[]>([
    `Soroban Playground ready.`,
    `Frontend connected to ${DEFAULT_API_BASE_URL}`,
  ]);
  const [healthState, setHealthState] = useState<HealthState>("checking");
  const [healthMessage, setHealthMessage] = useState("Checking backend health...");

  const [isCompiling, setIsCompiling] = useState(false);
  const [hasCompiled, setHasCompiled] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [isInvoking, setIsInvoking] = useState(false);

  // Contract Data
  const [contractId, setContractId] = useState<string | undefined>(undefined);
  const [storage, setStorage] = useState<LedgerState>({});
  const [storageContextLabel, setStorageContextLabel] = useState<string>("Latest contract snapshot");
  const [transactionGraph, setTransactionGraph] = useState<TransactionCallGraphState>({
    nodes: [],
    edges: [],
  });
  const [selectedGraphNodeId, setSelectedGraphNodeId] = useState<string | undefined>(undefined);
  const [compileSummary, setCompileSummary] = useState<string>();
  const [compileError, setCompileError] = useState<string | null>(null);
  const [contractId, setContractId] = useState<string>();
  const [storage, setStorage] = useState<Record<string, string>>({});
  const [lastArtifactName, setLastArtifactName] = useState<string>("contract.wasm");
  const [lastDeployMessage, setLastDeployMessage] = useState<string>();

  const appendLog = (msg: string) => {
    setLogs((prev) => [...prev, msg]);
  };

  useEffect(() => {
    let cancelled = false;

    async function checkHealth() {
      setHealthState("checking");
      try {
        const response = await fetch(`${DEFAULT_API_BASE_URL}/api/health`, {
          method: "GET",
        });

        if (!response.ok) {
          throw new Error(`Health check failed with ${response.status}`);
        }

        const payload = await response.json();
        if (!cancelled) {
          setHealthState("online");
          setHealthMessage(
            `Backend online · ${payload?.data?.runtime?.node ?? "runtime unknown"}`
          );
        }
      } catch (error) {
        if (!cancelled) {
          setHealthState("offline");
          setHealthMessage(
            `Backend unavailable at ${DEFAULT_API_BASE_URL}. Start the backend server to compile and deploy.`
          );
          appendLog(`[warn] ${formatApiError(error)}`);
        }
      }
    }

    checkHealth();

    return () => {
      cancelled = true;
    };
  }, []);

  async function requestJson<T>(path: string, body: Record<string, unknown>) {
    const response = await fetch(`${DEFAULT_API_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const payload = (await response.json().catch(() => ({}))) as T & ApiErrorPayload;
    if (!response.ok) {
      const details =
        Array.isArray(payload.details)
          ? payload.details.join(", ")
          : typeof payload.details === "string"
            ? payload.details
            : "";
      throw new Error([payload.message, details].filter(Boolean).join(": "));
    }

    return payload;
  }

  const handleCompile = async () => {
    setIsCompiling(true);
    appendLog("Compiling contract...");

    // Simulate backend call
    setTimeout(() => {
      setIsCompiling(false);
    setCompileError(null);
    setCompileSummary(undefined);
    setHasCompiled(false);
    setContractId(undefined);
    setLastDeployMessage(undefined);
    setStorage({});
    appendLog("[compile] Sending source to backend...");

    try {
      const payload = await requestJson<CompileResponse>("/api/compile", { code });
      const compileLogs = payload.logs ?? [];

      setHasCompiled(true);
      setLastArtifactName(payload.artifact?.name ?? "contract.wasm");
      setCompileSummary(
        `${payload.message} · ${payload.artifact?.name ?? "artifact"} · ${
          payload.artifact?.sizeBytes
            ? `${(payload.artifact.sizeBytes / 1024).toFixed(1)} KB`
            : "size unavailable"
        }`
      );

      appendLog(`[compile] ${payload.message}`);
      compileLogs.forEach((log) => appendLog(`[cargo] ${log}`));
    } catch (error) {
      const message = formatApiError(error);
      setCompileError(message);
      appendLog(`[error] Compile failed: ${message}`);
    } finally {
      setIsCompiling(false);
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
        checkpoint_count: "0",
        route_count: "0",
        audit_trail_size: "0",
      };

      setStorage(deployedState);
      setStorageContextLabel("Latest contract snapshot");
    }, 2500);
    setLastDeployMessage(undefined);
    appendLog("[deploy] Requesting testnet deployment...");

    try {
      const payload = await requestJson<{
        success: boolean;
        status: string;
        contractId: string;
        contractName: string;
        network: string;
        wasmPath: string;
        deployedAt: string;
        message: string;
      }>("/api/deploy", {
        wasmPath: lastArtifactName,
        contractName: "hello_contract",
        network: "testnet",
      });

      setContractId(payload.contractId);
      setLastDeployMessage(payload.message);
      setStorage({
        contractName: payload.contractName,
        network: payload.network,
        wasmPath: payload.wasmPath,
        deployedAt: payload.deployedAt,
      });

      appendLog(`[deploy] ${payload.message}`);
      appendLog(`[deploy] Contract ID: ${payload.contractId}`);
    } catch (error) {
      appendLog(`[error] Deploy failed: ${formatApiError(error)}`);
    } finally {
      setIsDeploying(false);
    }
  };

  const handleGraphNodeSelect = (nodeId: string) => {
    setSelectedGraphNodeId(nodeId);
    const selectedNode = transactionGraph.nodes.find((node) => node.id === nodeId);

    if (!selectedNode) {
      return;
    }

    setStorage(selectedNode.ledgerState);
    setStorageContextLabel(`Snapshot at ${selectedNode.contractId}.${selectedNode.functionName}`);
    appendLog(`Inspecting call node: ${selectedNode.contractId} -> ${selectedNode.functionName}`);
  };

  const handleInvoke = async (funcName: string, args: Record<string, string>) => {
    if (!contractId) {
      appendLog("[warn] Deploy a contract before invoking a function.");
      return;
    }

    setIsInvoking(true);
    appendLog(`Invoking ${contractId} -> ${funcName}(${JSON.stringify(args)})`);

    // Simulate call result payload with nested contract invocations.
    setTimeout(() => {
      setIsInvoking(false);

      const invocationPayload = createMockInvocationPayload(contractId, funcName, args, storage);
      const parsedGraph = parseTransactionInvocationPayload(invocationPayload);
      setTransactionGraph(parsedGraph);

      if (parsedGraph.nodes.length === 0) {
        appendLog("⚠ No invocation graph could be derived from payload.");
        return;
      }

      const terminalNode = parsedGraph.nodes[parsedGraph.nodes.length - 1];
      setSelectedGraphNodeId(terminalNode.id);
      setStorage(terminalNode.ledgerState);
      setStorageContextLabel(`Snapshot at ${terminalNode.contractId}.${terminalNode.functionName}`);

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
            contractId={contractId}
          />
          <CallPanel onInvoke={handleInvoke} isInvoking={isInvoking} contractId={contractId} />
          <TransactionCallGraph
            graph={transactionGraph}
            selectedNodeId={selectedGraphNodeId}
            onNodeSelect={handleGraphNodeSelect}
          />
          <StorageViewer storage={storage} contextLabel={storageContextLabel} />

          <div className="mt-auto pt-4">
    appendLog(
      `[invoke] ${funcName}(${Object.keys(args).length ? JSON.stringify(args) : "{}"})`
    );

    try {
      const payload = await requestJson<{
        success: boolean;
        status: string;
        contractId: string;
        functionName: string;
        args: Record<string, string>;
        output: string;
        message: string;
        invokedAt: string;
      }>("/api/invoke", {
        contractId,
        functionName: funcName,
        args,
      });

      appendLog(`[invoke] ${payload.message}`);
      appendLog(`[invoke] Output: ${payload.output}`);
      setStorage((prev) => ({
        ...prev,
        lastFunction: payload.functionName,
        lastOutput: payload.output,
        invokedAt: payload.invokedAt,
        ...toStorageRecord(payload.args),
      }));
    } catch (error) {
      appendLog(`[error] Invoke failed: ${formatApiError(error)}`);
    } finally {
      setIsInvoking(false);
    }
  };

  return (
    <div className="min-h-screen px-4 py-4 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-[1600px] flex-col overflow-hidden rounded-[28px] border border-white/8 bg-slate-950/60 shadow-[0_30px_120px_rgba(2,8,23,0.7)] backdrop-blur">
        <header className="border-b border-white/8 bg-slate-950/70 px-6 py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-400 via-cyan-500 to-orange-500 text-slate-950 shadow-[0_18px_45px_rgba(45,212,191,0.25)]">
                <Orbit size={22} />
              </div>
              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200">
                  <Sparkles size={12} />
                  Soroban Browser Lab
                </div>
                <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                  Build, test, and ship Soroban contracts from one screen.
                </h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                  This frontend now talks to the backend routes directly, so compile,
                  deploy, and invoke actions reflect live API responses instead of
                  mocked timers.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3">
                <p className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                  <Server size={12} />
                  Backend
                </p>
                <p className="truncate font-mono text-xs text-slate-200">
                  {DEFAULT_API_BASE_URL}
                </p>
                <p
                  className={`mt-2 flex items-center gap-2 text-xs ${
                    healthState === "online"
                      ? "text-emerald-300"
                      : healthState === "offline"
                        ? "text-rose-300"
                        : "text-amber-300"
                  }`}
                >
                  {healthState === "checking" ? (
                    <LoaderCircle size={14} className="animate-spin" />
                  ) : (
                    <Activity size={14} />
                  )}
                  {healthMessage}
                </p>
              </div>

              <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3">
                <p className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                  <Globe size={12} />
                  Flow
                </p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-200">
                  <span>Write</span>
                  <ChevronRight size={12} className="text-slate-500" />
                  <span>Compile</span>
                  <ChevronRight size={12} className="text-slate-500" />
                  <span>Deploy</span>
                  <ChevronRight size={12} className="text-slate-500" />
                  <span>Invoke</span>
                </div>
                {lastDeployMessage ? (
                  <p className="mt-2 text-xs text-emerald-300">{lastDeployMessage}</p>
                ) : (
                  <p className="mt-2 text-xs text-slate-400">
                    Your current build artifact will be used for deployment.
                  </p>
                )}
              </div>
            </div>
          </div>
        </header>

        <main className="grid flex-1 gap-0 lg:grid-cols-[minmax(0,1fr)_440px]">
          <section className="flex min-h-[560px] flex-col border-b border-white/8 p-4 lg:border-b-0 lg:border-r">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-2">
              <div>
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                  <Code2 size={14} />
                  Contract Editor
                </p>
                <p className="mt-1 text-sm text-slate-300">
                  Edit `lib.rs`, then compile against the backend toolchain.
                </p>
              </div>
              <a
                href="https://developers.stellar.org/docs/build/smart-contracts/getting-started"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-cyan-400/40 hover:text-cyan-200"
              >
                <BookOpen size={14} />
                Soroban Docs
              </a>
            </div>
            <Editor code={code} setCode={setCode} />
          </section>

          <aside className="flex flex-col gap-4 bg-slate-950/40 p-4">
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
            <CallPanel
              onInvoke={handleInvoke}
              isInvoking={isInvoking}
              contractId={contractId}
            />
            <StorageViewer storage={storage} />
            <Console logs={logs} />
          </aside>
        </main>
      </div>
    </div>
  );
}
