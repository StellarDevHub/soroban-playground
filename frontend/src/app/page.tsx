"use client";

import React, { useEffect, useRef, useState } from "react";
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

const DEFAULT_API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ||
  "http://localhost:5000";

type HealthState = "checking" | "online" | "offline";

type CompileResponse = {
  success: boolean;
  status: string;
  message: string;
  cached?: boolean;
  durationMs?: number;
  hash?: string;
  logs?: string[];
  artifact?: {
    name: string;
    sizeBytes: number;
    createdAt?: string;
  };
};

type CompileStats = {
  activeWorkers: number;
  maxWorkers: number;
  queueLength: number;
  estimatedWaitTimeMs: number;
  cacheHitRate: number;
  totalCompiles: number;
  cacheHits: number;
  slowCompiles: number;
  memoryPeakBytes: number;
  cacheBytes: number;
  artifacts: number;
};

type ApiErrorPayload = {
  message?: string;
  statusCode?: number;
  details?: unknown;
};

type InvokeProgressEvent = {
  type: string;
  requestId?: string;
  contractId?: string;
  functionName?: string;
  status?: string;
  detail?: string;
  timestamp?: string;
};

type DeployProgressEvent = InvokeProgressEvent & {
  batchId?: string;
  contractName?: string;
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
    Object.entries(value).map(([key, entry]) => [key, String(entry)]),
  );
}

export default function Home() {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [logs, setLogs] = useState<string[]>([
    `Soroban Playground ready.`,
    `Frontend connected to ${DEFAULT_API_BASE_URL}`,
  ]);
  const [healthState, setHealthState] = useState<HealthState>("checking");
  const [healthMessage, setHealthMessage] = useState(
    "Checking backend health...",
  );

  const [isCompiling, setIsCompiling] = useState(false);
  const [hasCompiled, setHasCompiled] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [isInvoking, setIsInvoking] = useState(false);
  const [invokeProgress, setInvokeProgress] = useState<InvokeProgressEvent[]>(
    [],
  );
  const [deployProgress, setDeployProgress] = useState<DeployProgressEvent[]>(
    [],
  );
  const [batchContractsRaw, setBatchContractsRaw] = useState(
    JSON.stringify(
      [
        { id: "core", contractName: "core", wasmPath: "core.wasm" },
        {
          id: "api",
          contractName: "api",
          wasmPath: "api.wasm",
          dependencies: ["core"],
        },
      ],
      null,
      2,
    ),
  );
  const [batchCompileRaw, setBatchCompileRaw] = useState(
    JSON.stringify(
      [
        { code: DEFAULT_CODE, dependencies: {} },
        { code: DEFAULT_CODE.replace("v1", "v2"), dependencies: {} },
      ],
      null,
      2,
    ),
  );
  const [batchResults, setBatchResults] = useState<
    Array<Record<string, unknown>>
  >([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef(0);

  const [compileSummary, setCompileSummary] = useState<string>();
  const [compileError, setCompileError] = useState<string | null>(null);
  const [compileStats, setCompileStats] = useState<CompileStats>({
    activeWorkers: 0,
    maxWorkers: 4,
    queueLength: 0,
    estimatedWaitTimeMs: 0,
    cacheHitRate: 0,
    totalCompiles: 0,
    cacheHits: 0,
    slowCompiles: 0,
    memoryPeakBytes: 0,
    cacheBytes: 0,
    artifacts: 0,
  });
  const [contractId, setContractId] = useState<string>();
  const [storage, setStorage] = useState<Record<string, string>>({});
  const [lastArtifactName, setLastArtifactName] =
    useState<string>("contract.wasm");
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
            `Backend online · ${payload?.data?.runtime?.node ?? "runtime unknown"}`,
          );
        }
      } catch (error) {
        if (!cancelled) {
          setHealthState("offline");
          setHealthMessage(
            `Backend unavailable at ${DEFAULT_API_BASE_URL}. Start the backend server to compile and deploy.`,
          );
          appendLog(`[warn] ${formatApiError(error)}`);
        }
      }
    }

    checkHealth();
    (async () => {
      try {
        const response = await fetch(
          `${DEFAULT_API_BASE_URL}/api/compile/stats`,
        );
        if (response.ok) {
          const payload = (await response.json()) as { stats?: CompileStats };
          if (!cancelled && payload.stats) {
            setCompileStats((prev) => ({ ...prev, ...payload.stats }));
          }
        }
      } catch {
        // stats are best-effort on first load
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;

      const wsUrl = DEFAULT_API_BASE_URL.replace(/^http/, "ws");
      const socket = new WebSocket(`${wsUrl}/ws`);
      wsRef.current = socket;

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as InvokeProgressEvent;
          if (payload.type === "invoke-progress") {
            setInvokeProgress((prev) => [...prev.slice(-19), payload]);
            appendLog(
              `[ws:${payload.status ?? "update"}] ${payload.detail ?? "progress"}`,
            );
          } else if (payload.type === "deploy-progress") {
            setDeployProgress((prev) => [...prev.slice(-29), payload]);
            appendLog(
              `[deploy:${payload.status ?? "update"}] ${payload.detail ?? "progress"}`,
            );
          } else if (payload.type === "compile-progress") {
            setCompileStats((prev) => ({
              ...prev,
              queueLength: payload.queueLength ?? prev.queueLength,
              activeWorkers: payload.activeWorkers ?? prev.activeWorkers,
            }));
            appendLog(
              `[compile:${payload.status ?? "update"}] queue=${payload.queueLength ?? 0} workers=${payload.activeWorkers ?? 0}`,
            );
          }
        } catch {
          appendLog("[warn] Received malformed websocket payload.");
        }
      };

      socket.onclose = () => {
        if (cancelled) return;
        const delay = Math.min(1000 * 2 ** reconnectRef.current, 15000);
        reconnectRef.current += 1;
        window.setTimeout(connect, delay);
      };

      socket.onerror = () => {
        socket.close();
      };
    };

    connect();

    return () => {
      cancelled = true;
      wsRef.current?.close();
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

    const payload = (await response.json().catch(() => ({}))) as T &
      ApiErrorPayload;
    if (!response.ok) {
      const details = Array.isArray(payload.details)
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
    setCompileError(null);
    setCompileSummary(undefined);
    setHasCompiled(false);
    setContractId(undefined);
    setLastDeployMessage(undefined);
    setStorage({});
    appendLog("[compile] Sending source to backend...");

    try {
      const payload = await requestJson<CompileResponse>("/api/compile", {
        code,
      });
      const compileLogs = payload.logs ?? [];

      setHasCompiled(true);
      setLastArtifactName(payload.artifact?.name ?? "contract.wasm");
      setCompileSummary(
        `${payload.message} · ${payload.artifact?.name ?? "artifact"} · ${
          payload.artifact?.sizeBytes
            ? `${(payload.artifact.sizeBytes / 1024).toFixed(1)} KB`
            : "size unavailable"
        } · ${payload.cached ? "cache hit" : "fresh build"}`,
      );
      setCompileStats((prev) => ({
        ...prev,
        cacheHitRate: payload.cached
          ? Math.min(100, prev.cacheHitRate + 10)
          : Math.max(0, prev.cacheHitRate - 5),
        activeWorkers: Math.max(prev.activeWorkers, 1),
      }));

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

  const handleBatchDeploy = async () => {
    let contracts: Array<Record<string, unknown>>;
    try {
      contracts = JSON.parse(batchContractsRaw);
    } catch {
      appendLog("[error] Batch contracts must be valid JSON.");
      return;
    }

    appendLog(
      `[deploy] Starting batch deploy for ${contracts.length} contracts`,
    );
    try {
      const payload = await requestJson<{
        success: boolean;
        status: string;
        batchId: string;
      }>("/api/deploy/batch", {
        contracts,
      });
      appendLog(
        `[deploy] Batch ${payload.batchId} finished with ${payload.status}`,
      );
    } catch (error) {
      appendLog(`[error] Batch deploy failed: ${formatApiError(error)}`);
    }
  };

  const handleBatchCompile = async () => {
    let contracts: Array<Record<string, unknown>>;
    try {
      contracts = JSON.parse(batchCompileRaw);
    } catch {
      appendLog("[error] Batch compile payload must be valid JSON.");
      return;
    }

    appendLog(
      `[compile] Starting batch compile for ${contracts.length} contracts`,
    );
    setBatchResults([]);
    try {
      const payload = await requestJson<{
        success: boolean;
        results: Array<{
          status: string;
          value?: Record<string, unknown>;
          reason?: unknown;
        }>;
      }>("/api/compile/batch", {
        contracts,
      });
      setBatchResults(payload.results as Array<Record<string, unknown>>);
      appendLog(
        `[compile] Batch compile completed with ${payload.results.length} results`,
      );
    } catch (error) {
      appendLog(`[error] Batch compile failed: ${formatApiError(error)}`);
    }
  };

  const handleInvoke = async (
    funcName: string,
    args: Record<string, string>,
  ) => {
    if (!contractId) {
      appendLog("[warn] Deploy a contract before invoking a function.");
      return;
    }

    setIsInvoking(true);
    appendLog(
      `[invoke] ${funcName}(${Object.keys(args).length ? JSON.stringify(args) : "{}"})`,
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
      appendLog(`[invoke] Output: ${JSON.stringify(payload.output)}`);
      setStorage((prev) => ({
        ...prev,
        lastFunction: payload.functionName,
        lastOutput: JSON.stringify(payload.output),
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
                  This frontend now talks to the backend routes directly, so
                  compile, deploy, and invoke actions reflect live API responses
                  instead of mocked timers.
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
                  <p className="mt-2 text-xs text-emerald-300">
                    {lastDeployMessage}
                  </p>
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
            <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                  Compile Metrics
                </p>
                <p className="text-xs text-slate-500">
                  {compileStats.activeWorkers}/{compileStats.maxWorkers} workers
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs text-slate-300">
                <div className="rounded-xl border border-white/8 bg-slate-950/50 p-3">
                  <p className="text-slate-500">Hit Rate</p>
                  <p className="mt-1 text-lg font-semibold text-emerald-300">
                    {compileStats.cacheHitRate}%
                  </p>
                </div>
                <div className="rounded-xl border border-white/8 bg-slate-950/50 p-3">
                  <p className="text-slate-500">Queue</p>
                  <p className="mt-1 text-lg font-semibold text-cyan-300">
                    {compileStats.queueLength}
                  </p>
                </div>
                <div className="rounded-xl border border-white/8 bg-slate-950/50 p-3">
                  <p className="text-slate-500">Workers</p>
                  <p className="mt-1 text-lg font-semibold text-orange-300">
                    {compileStats.activeWorkers}
                  </p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-300">
                <div className="rounded-xl border border-white/8 bg-slate-950/50 p-3">
                  <p className="text-slate-500">ETA</p>
                  <p className="mt-1 text-base font-semibold text-slate-100">
                    {(compileStats.estimatedWaitTimeMs / 1000).toFixed(1)}s
                  </p>
                </div>
                <div className="rounded-xl border border-white/8 bg-slate-950/50 p-3">
                  <p className="text-slate-500">Slow Builds</p>
                  <p className="mt-1 text-base font-semibold text-rose-300">
                    {compileStats.slowCompiles}
                  </p>
                </div>
              </div>
            </div>
            <CallPanel
              onInvoke={handleInvoke}
              isInvoking={isInvoking}
              contractId={contractId}
            />
            <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                  Batch Compile
                </p>
                <button
                  onClick={handleBatchCompile}
                  className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-200 transition hover:bg-emerald-400/20"
                >
                  Compile Batch
                </button>
              </div>
              <textarea
                value={batchCompileRaw}
                onChange={(e) => setBatchCompileRaw(e.target.value)}
                className="h-44 w-full rounded-xl border border-white/10 bg-slate-950/70 p-3 font-mono text-[11px] text-slate-200 outline-none"
              />
              <div className="mt-3 space-y-2">
                {batchResults.map((result, index) => (
                  <div
                    key={`${index}-${String(result.status)}`}
                    className="rounded-xl border border-white/8 bg-slate-950/50 px-3 py-2 text-xs text-slate-300"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-emerald-300">
                        Contract {index + 1}
                      </span>
                      <span className="text-slate-500">
                        {String(result.status)}
                      </span>
                    </div>
                    <p className="mt-1 text-slate-400">
                      {result.value
                        ? JSON.stringify(result.value)
                        : String(result.reason ?? "pending")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                  Batch Deploy
                </p>
                <button
                  onClick={handleBatchDeploy}
                  className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-200 transition hover:bg-cyan-400/20"
                >
                  Deploy All
                </button>
              </div>
              <textarea
                value={batchContractsRaw}
                onChange={(e) => setBatchContractsRaw(e.target.value)}
                className="h-44 w-full rounded-xl border border-white/10 bg-slate-950/70 p-3 font-mono text-[11px] text-slate-200 outline-none"
              />
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                  Pipeline Tracker
                </p>
                <p className="text-xs text-slate-500">
                  {
                    deployProgress.filter(
                      (event) => event.status === "deployed",
                    ).length
                  }
                  /{deployProgress.length}
                </p>
              </div>
              <div className="space-y-2">
                {deployProgress.slice(-6).map((event, index) => (
                  <div
                    key={`${event.timestamp ?? "deploy"}-${index}`}
                    className="rounded-xl border border-white/8 bg-slate-950/50 px-3 py-2 text-xs text-slate-300"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-cyan-300">
                        {event.contractName ?? event.batchId ?? "batch"}
                      </span>
                      <span className="text-slate-500">{event.status}</span>
                    </div>
                    <p className="mt-1 text-slate-400">{event.detail}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                  Live Invocation
                </p>
                <p className="text-xs text-slate-500">
                  {invokeProgress.length} events
                </p>
              </div>
              <div className="space-y-2">
                {invokeProgress.slice(-5).map((event, index) => (
                  <div
                    key={`${event.timestamp ?? "event"}-${index}`}
                    className="rounded-xl border border-white/8 bg-slate-950/50 px-3 py-2 font-mono text-[11px] text-slate-300"
                  >
                    <span className="text-cyan-300">
                      {event.status ?? event.type}
                    </span>
                    <span className="ml-2 text-slate-500">
                      {event.timestamp ?? ""}
                    </span>
                    <div className="mt-1 whitespace-pre-wrap">
                      {event.detail ?? "connected"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <StorageViewer storage={storage} />
            <Console logs={logs} />
          </aside>
        </main>
      </div>
    </div>
  );
}
