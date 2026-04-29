"use client";

import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
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
import StorageTimeline from "@/components/StorageTimeline";
import PredictionMarketPanel, { MarketData } from "@/components/PredictionMarketPanel";
import WalletConnect from "@/components/WalletConnect";
import TransactionStatus from "@/components/TransactionStatus";
import VestingDashboard, { VestingScheduleData } from "@/components/VestingDashboard";
import IdentityPortal, { IdentityData } from "@/components/IdentityPortal";
import FreelancerIdentityDashboard, {
  type FreelancerIdentityAnalytics,
  type FreelancerProfileData,
} from "@/components/FreelancerIdentityDashboard";
import LendingDashboard from "@/components/LendingDashboard";
import FlashLoanPanel from "@/components/FlashLoanPanel";
import CloudStoragePanel from "@/components/CloudStoragePanel";
import MusicRoyaltyPanel from "@/components/MusicRoyaltyPanel";
import CarbonCreditDashboard, { type IssuerData, type CarbonAssetData } from "@/components/CarbonCreditDashboard";
import SocialFeedInterface, { type SocialProfile, type SocialPost } from "@/components/SocialFeedInterface";
import MultisigWalletDashboard, {
  type SignerData,
  type MultisigTx,
  type SignerRole,
} from "@/components/MultisigWalletDashboard";
import AmmPoolPanel, { type PoolData } from "@/components/AmmPoolPanel";
import GovernancePortal, {
  type GovernanceProposal,
  type VoteChoice as GovVoteChoice,
} from "@/components/GovernancePortal";
import SupplyChainPanel, { type ProductData as SupplyChainProduct, type ProductStatus as SupplyChainStatus, type QualityResult as SupplyChainQuality } from "@/components/SupplyChainPanel";
import { useFreighterWallet } from "@/hooks/useFreighterWallet";
import { useTransactionTracker } from "@/hooks/useTransactionTracker";
import {
  parseTransactionInvocationPayload,
  type TransactionCallGraph as TransactionCallGraphState,
  type LedgerState,
} from "@/utils/transactionGraph";
import {
  createInitialStorageTimelineState,
  storageTimelineReducer,
} from "@/state/storageTimeline";

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
  queueLength?: number;
  activeWorkers?: number;
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

function shortId(contractId: string): string {
  return contractId.length > 14
    ? `${contractId.slice(0, 8)}...${contractId.slice(-4)}`
    : contractId;
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
                checkpoint_count: String(
                  Number(baseStorage.checkpoint_count ?? "0") + 1,
                ),
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
            audit_trail_size: String(
              Number(baseStorage.audit_trail_size ?? "0") + 1,
            ),
            last_audited_fn: funcName,
          },
          subInvocations: [],
        },
      ],
    },
  };
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
  const [isIngestionPaused, setIsIngestionPaused] = useState(false);
  const [droppedMessages, setDroppedMessages] = useState(0);

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
  const [storage, setStorage] = useState<LedgerState>({});
  const [storageContextLabel, setStorageContextLabel] = useState<string>(
    "Latest contract snapshot",
  );
  const [storageTimeline, dispatchStorageTimeline] = useReducer(
    storageTimelineReducer,
    undefined,
    createInitialStorageTimelineState,
  );
  const [transactionGraph, setTransactionGraph] =
    useState<TransactionCallGraphState>({
      nodes: [],
      edges: [],
    });
  const [selectedGraphNodeId, setSelectedGraphNodeId] = useState<string>();
  const [lastArtifactName, setLastArtifactName] =
    useState<string>("contract.wasm");
  const [lastDeployMessage, setLastDeployMessage] = useState<string>();

  const activeSnapshot = useMemo(
    () =>
      storageTimeline.currentIndex >= 0
        ? storageTimeline.snapshots[storageTimeline.currentIndex]
        : undefined,
    [storageTimeline.currentIndex, storageTimeline.snapshots],
  );

  // Prediction market state
  const [markets, setMarkets] = useState<MarketData[]>([]);
  const [isPredictionLoading, setIsPredictionLoading] = useState(false);

  // Vesting state
  const [vestingSchedules, setVestingSchedules] = useState<VestingScheduleData[]>([]);
  const [isVestingLoading, setIsVestingLoading] = useState(false);

  // DID identity state
  const [identities, setIdentities] = useState<IdentityData[]>([]);
  const [isIdentityLoading, setIsIdentityLoading] = useState(false);

  // Freelancer identity state
  const [freelancerProfiles, setFreelancerProfiles] = useState<FreelancerProfileData[]>([]);
  const [freelancerAnalytics, setFreelancerAnalytics] = useState<FreelancerIdentityAnalytics>();
  const [isFreelancerIdentityLoading, setIsFreelancerIdentityLoading] = useState(false);

  // Carbon Credit state
  const [carbonIssuer, setCarbonIssuer] = useState<IssuerData>();
  const [carbonAssets, setCarbonAssets] = useState<CarbonAssetData>({ balance: 0, totalRetired: 0, totalOwned: 0 });
  const [isCarbonLoading, setIsCarbonLoading] = useState(false);
  // Social Media state
  const [socialProfile, setSocialProfile] = useState<SocialProfile>();
  const [socialPosts, setSocialPosts] = useState<SocialPost[]>([]);
  const [isSocialLoading, setIsSocialLoading] = useState(false);

  // Supply chain state
  const [supplyChainProducts, setSupplyChainProducts] = useState<SupplyChainProduct[]>([]);
  const [isSupplyChainLoading, setIsSupplyChainLoading] = useState(false);

  // Wallet + transaction tracking
  const wallet = useFreighterWallet();  const { transactions, addTx, updateTx, clearTx } = useTransactionTracker();

  // Multisig wallet state
  const [multisigSigners, setMultisigSigners] = useState<SignerData[]>([]);
  const [multisigTxs, setMultisigTxs] = useState<MultisigTx[]>([]);
  const [multisigThreshold, setMultisigThreshold] = useState(2);
  const [isMultisigLoading, setIsMultisigLoading] = useState(false);

  // AMM pool state
  const [ammPool, setAmmPool] = useState<PoolData | null>(null);
  const [ammLpBalance, setAmmLpBalance] = useState(0);
  const [isAmmLoading, setIsAmmLoading] = useState(false);

  // Governance state
  const [govProposals, setGovProposals] = useState<GovernanceProposal[]>([]);
  const [govVotingPower, setGovVotingPower] = useState(0);
  const [isGovLoading, setIsGovLoading] = useState(false);

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
          } else if (payload.type === "freelancer-identity") {
            void loadFreelancerIdentity();
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

  async function getJson<T>(path: string) {
    const response = await fetch(`${DEFAULT_API_BASE_URL}${path}`);
    const payload = (await response.json().catch(() => ({}))) as T & ApiErrorPayload;
    if (!response.ok) {
      throw new Error(payload.message || "Request failed");
    }
    return payload;
  }

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

  const loadFreelancerIdentity = async () => {
    setIsFreelancerIdentityLoading(true);
    try {
      const [profilesPayload, analyticsPayload] = await Promise.all([
        getJson<{ data: FreelancerProfileData[] }>("/api/freelancer-identity/profiles"),
        getJson<{ data: FreelancerIdentityAnalytics }>("/api/freelancer-identity/analytics"),
      ]);
      setFreelancerProfiles(profilesPayload.data ?? []);
      setFreelancerAnalytics(analyticsPayload.data);
    } catch (error) {
      appendLog(`[error] Freelancer identity refresh failed: ${formatApiError(error)}`);
    } finally {
      setIsFreelancerIdentityLoading(false);
    }
  };

  useEffect(() => {
    void loadFreelancerIdentity();
  }, []);

  const handleCreateFreelancerProfile = async (input: {
    owner: string;
    handle: string;
    bio: string;
    portfolioUrl: string;
    skills: string[];
  }) => {
    setIsFreelancerIdentityLoading(true);
    try {
      await requestJson("/api/freelancer-identity/profiles", input);
      await loadFreelancerIdentity();
      appendLog(`[identity] Freelancer profile created: ${input.handle}`);
    } catch (error) {
      appendLog(`[error] Create freelancer profile failed: ${formatApiError(error)}`);
    } finally {
      setIsFreelancerIdentityLoading(false);
    }
  };

  const handleVerifyFreelancerPortfolio = async (input: {
    owner: string;
    verifier: string;
    projectUrl: string;
    evidenceUrl: string;
    score: number;
  }) => {
    setIsFreelancerIdentityLoading(true);
    try {
      await requestJson("/api/freelancer-identity/portfolio-verifications", input);
      await loadFreelancerIdentity();
      appendLog(`[identity] Portfolio verified for ${input.owner.slice(0, 8)}...`);
    } catch (error) {
      appendLog(`[error] Portfolio verification failed: ${formatApiError(error)}`);
    } finally {
      setIsFreelancerIdentityLoading(false);
    }
  };

  const handleEndorseFreelancerSkill = async (input: {
    owner: string;
    endorser: string;
    skill: string;
    evidenceUrl: string;
    weight: number;
  }) => {
    setIsFreelancerIdentityLoading(true);
    try {
      await requestJson("/api/freelancer-identity/skill-endorsements", input);
      await loadFreelancerIdentity();
      appendLog(`[identity] Skill endorsed for ${input.owner.slice(0, 8)}...`);
    } catch (error) {
      appendLog(`[error] Skill endorsement failed: ${formatApiError(error)}`);
    } finally {
      setIsFreelancerIdentityLoading(false);
    }
  };

  const handleCompile = async () => {
    setIsCompiling(true);
    setCompileError(null);
    setCompileSummary(undefined);
    setHasCompiled(false);
    setContractId(undefined);
    setLastDeployMessage(undefined);
    setStorage({});
    setStorageContextLabel("Latest contract snapshot");
    setTransactionGraph({ nodes: [], edges: [] });
    setSelectedGraphNodeId(undefined);
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
      setStorageContextLabel("Latest contract snapshot");
      setTransactionGraph({ nodes: [], edges: [] });
      setSelectedGraphNodeId(undefined);
      dispatchStorageTimeline({
        type: "reset_with_deployment",
        contractId: payload.contractId,
        state: {
          contractName: payload.contractName,
          network: payload.network,
          wasmPath: payload.wasmPath,
          deployedAt: payload.deployedAt,
        },
        capturedAt: payload.deployedAt,
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
      const invocationPayload = createMockInvocationPayload(
        contractId,
        funcName,
        args,
        storage,
      );
      const parsedGraph = parseTransactionInvocationPayload(invocationPayload);
      setTransactionGraph(parsedGraph);

      if (parsedGraph.nodes.length > 0) {
        const terminalNode = parsedGraph.nodes[parsedGraph.nodes.length - 1];
        const uniqueContracts = new Set(
          parsedGraph.nodes.map((node) => node.contractId),
        ).size;
        dispatchStorageTimeline({
          type: "append_transaction_frames",
          nodes: parsedGraph.nodes,
          capturedAt: payload.invokedAt,
        });
        setSelectedGraphNodeId(terminalNode.id);
        setStorage(terminalNode.ledgerState);
        setStorageContextLabel(
          `Snapshot at ${terminalNode.contractId}.${terminalNode.functionName}`,
        );
        appendLog(
          `[invoke] Captured invocation tree: ${parsedGraph.nodes.length} calls across ${uniqueContracts} contracts.`,
        );
      } else {
        setStorage((prev) => ({
          ...prev,
          lastFunction: payload.functionName,
          lastOutput: JSON.stringify(payload.output),
          invokedAt: payload.invokedAt,
          ...toStorageRecord(payload.args),
        }));
        setStorageContextLabel("Latest contract snapshot");
      }
    } catch (error) {
      appendLog(`[error] Invoke failed: ${formatApiError(error)}`);
    } finally {
      setIsInvoking(false);
    }
  };

  const handleGraphNodeSelect = (nodeId: string) => {
    setSelectedGraphNodeId(nodeId);
    const selectedNode = transactionGraph.nodes.find((node) => node.id === nodeId);

    if (!selectedNode) {
      return;
    }

    setStorage(selectedNode.ledgerState);
    setStorageContextLabel(
      `Snapshot at ${selectedNode.contractId}.${selectedNode.functionName}`,
    );
    dispatchStorageTimeline({
      type: "select_snapshot_for_node",
      nodeId,
    });
    appendLog(
      `[graph] Inspecting ${selectedNode.contractId}.${selectedNode.functionName}`,
    );
  };

  const handleTimelineScrub = (index: number) => {
    const snapshot = storageTimeline.snapshots[index];
    if (!snapshot) {
      return;
    }

    dispatchStorageTimeline({
      type: "select_snapshot_index",
      index,
    });
    setStorage(snapshot.state);
    setStorageContextLabel(snapshot.contextLabel);
    if (snapshot.nodeId) {
      setSelectedGraphNodeId(snapshot.nodeId);
    }
  };

  // ── Prediction Market handlers ─────────────────────────────────────────────

  const handleCreateMarket = async (params: {
    question: string;
    marketType: number;
    deadline: number;
    oracle: string;
  }) => {
    if (!contractId) return;
    const txId = addTx(`Create market: "${params.question.slice(0, 30)}…"`);
    setIsPredictionLoading(true);
    appendLog(`[market] Creating market: ${params.question}`);
    try {
      const payload = await requestJson<{ output: string }>("/api/invoke", {
        contractId,
        functionName: "create_market",
        args: {
          question: params.question,
          market_type: String(params.marketType),
          resolution_deadline: String(params.deadline),
          oracle: params.oracle,
        },
      });
      const newId = markets.length + 1;
      setMarkets((prev) => [
        ...prev,
        {
          id: newId,
          question: params.question,
          marketType: params.marketType === 0 ? "Binary" : "Scalar",
          status: "Open",
          totalYesStake: 0,
          totalNoStake: 0,
          resolutionDeadline: params.deadline,
        },
      ]);
      updateTx(txId, { status: "success", hash: payload.output });
      appendLog(`[market] Market #${newId} created`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
      appendLog(`[error] Create market failed: ${formatApiError(error)}`);
    } finally {
      setIsPredictionLoading(false);
    }
  };

  const handlePlaceBet = async (marketId: number, outcome: number, stake: number) => {
    if (!contractId) return;
    const label = `Bet ${stake} XLM on ${outcome === 1 ? "YES" : "NO"} (market #${marketId})`;
    const txId = addTx(label);
    setIsPredictionLoading(true);
    appendLog(`[market] ${label}`);
    try {
      await requestJson("/api/invoke", {
        contractId,
        functionName: "place_bet",
        args: {
          market_id: String(marketId),
          outcome: String(outcome),
          stake: String(stake),
        },
      });
      setMarkets((prev) =>
        prev.map((m) =>
          m.id === marketId
            ? {
                ...m,
                totalYesStake: outcome === 1 ? m.totalYesStake + stake : m.totalYesStake,
                totalNoStake: outcome === 0 ? m.totalNoStake + stake : m.totalNoStake,
              }
            : m
        )
      );
      updateTx(txId, { status: "success" });
      appendLog(`[market] Bet placed`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
      appendLog(`[error] Place bet failed: ${formatApiError(error)}`);
    } finally {
      setIsPredictionLoading(false);
    }
  };

  const handleResolveMarket = async (marketId: number, outcome: number) => {
    if (!contractId) return;
    const txId = addTx(`Resolve market #${marketId} → ${outcome === 1 ? "YES" : "NO"}`);
    setIsPredictionLoading(true);
    try {
      await requestJson("/api/invoke", {
        contractId,
        functionName: "resolve_market",
        args: { market_id: String(marketId), winning_outcome: String(outcome) },
      });
      setMarkets((prev) =>
        prev.map((m) =>
          m.id === marketId
            ? { ...m, status: "Resolved", winningOutcome: outcome === 1 ? "YES" : "NO" }
            : m
        )
      );
      updateTx(txId, { status: "success" });
      appendLog(`[market] Market #${marketId} resolved`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
      appendLog(`[error] Resolve failed: ${formatApiError(error)}`);
    } finally {
      setIsPredictionLoading(false);
    }
  };

  const handleCancelMarket = async (marketId: number) => {
    if (!contractId) return;
    const txId = addTx(`Cancel market #${marketId}`);
    setIsPredictionLoading(true);
    try {
      await requestJson("/api/invoke", {
        contractId,
        functionName: "cancel_market",
        args: { market_id: String(marketId) },
      });
      setMarkets((prev) =>
        prev.map((m) => (m.id === marketId ? { ...m, status: "Cancelled" } : m))
      );
      updateTx(txId, { status: "success" });
      appendLog(`[market] Market #${marketId} cancelled`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
      appendLog(`[error] Cancel failed: ${formatApiError(error)}`);
    } finally {
      setIsPredictionLoading(false);
    }
  };

  const handleCalculatePayout = async (marketId: number): Promise<number> => {
    if (!contractId || !wallet.address) return 0;
    try {
      const payload = await requestJson<{ output: string }>("/api/invoke", {
        contractId,
        functionName: "calculate_payout",
        args: { market_id: String(marketId), trader: wallet.address },
      });
      return parseInt(payload.output ?? "0");
    } catch {
      return 0;
    }
  };

  // ── Vesting handlers ───────────────────────────────────────────────────────

  const handleCreateLinear = async (params: {
    beneficiary: string; token: string; amount: number;
    cliff: number; start: number; end: number;
  }) => {
    if (!contractId) return;
    const txId = addTx(`Create linear vesting for ${params.beneficiary.slice(0, 8)}…`);
    setIsVestingLoading(true);
    try {
      await requestJson("/api/invoke", {
        contractId,
        functionName: "create_linear_schedule",
        args: {
          beneficiary: params.beneficiary,
          token: params.token,
          total_amount: String(params.amount),
          cliff_timestamp: String(params.cliff),
          start_timestamp: String(params.start),
          end_timestamp: String(params.end),
        },
      });
      const id = vestingSchedules.length + 1;
      setVestingSchedules((prev) => [
        ...prev,
        {
          id,
          beneficiary: params.beneficiary,
          token: params.token,
          totalAmount: params.amount,
          releasedAmount: 0,
          cliffTimestamp: params.cliff,
          startTimestamp: params.start,
          endTimestamp: params.end,
          vestingType: "Linear",
          milestones: [],
          revoked: false,
        },
      ]);
      updateTx(txId, { status: "success" });
      appendLog(`[vesting] Linear schedule #${id} created`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
      appendLog(`[error] Create linear failed: ${formatApiError(error)}`);
    } finally {
      setIsVestingLoading(false);
    }
  };

  const handleCreateMilestone = async (params: {
    beneficiary: string; token: string; amount: number;
    cliff: number; hashes: number[]; bps: number[];
  }) => {
    if (!contractId) return;
    const txId = addTx(`Create milestone vesting for ${params.beneficiary.slice(0, 8)}…`);
    setIsVestingLoading(true);
    try {
      await requestJson("/api/invoke", {
        contractId,
        functionName: "create_milestone_schedule",
        args: {
          beneficiary: params.beneficiary,
          token: params.token,
          total_amount: String(params.amount),
          cliff_timestamp: String(params.cliff),
          milestone_hashes: JSON.stringify(params.hashes),
          milestone_bps: JSON.stringify(params.bps),
        },
      });
      const id = vestingSchedules.length + 1;
      setVestingSchedules((prev) => [
        ...prev,
        {
          id,
          beneficiary: params.beneficiary,
          token: params.token,
          totalAmount: params.amount,
          releasedAmount: 0,
          cliffTimestamp: params.cliff,
          startTimestamp: params.cliff,
          endTimestamp: params.cliff,
          vestingType: "Milestone",
          milestones: params.hashes.map((h, i) => ({
            index: i,
            descriptionHash: h,
            pctBps: params.bps[i],
            approved: false,
          })),
          revoked: false,
        },
      ]);
      updateTx(txId, { status: "success" });
      appendLog(`[vesting] Milestone schedule #${id} created`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
      appendLog(`[error] Create milestone failed: ${formatApiError(error)}`);
    } finally {
      setIsVestingLoading(false);
    }
  };

  const handleVestingRelease = async (scheduleId: number) => {
    if (!contractId) return;
    const txId = addTx(`Release vesting schedule #${scheduleId}`);
    setIsVestingLoading(true);
    try {
      const payload = await requestJson<{ output: string }>("/api/invoke", {
        contractId,
        functionName: "release",
        args: { schedule_id: String(scheduleId) },
      });
      const released = parseInt(payload.output ?? "0");
      setVestingSchedules((prev) =>
        prev.map((s) =>
          s.id === scheduleId ? { ...s, releasedAmount: s.releasedAmount + released } : s
        )
      );
      updateTx(txId, { status: "success" });
      appendLog(`[vesting] Released ${released} tokens from schedule #${scheduleId}`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
      appendLog(`[error] Release failed: ${formatApiError(error)}`);
    } finally {
      setIsVestingLoading(false);
    }
  };

  const handleVestingRevoke = async (scheduleId: number) => {
    if (!contractId) return;
    const txId = addTx(`Revoke vesting schedule #${scheduleId}`);
    setIsVestingLoading(true);
    try {
      await requestJson("/api/invoke", {
        contractId,
        functionName: "revoke",
        args: { schedule_id: String(scheduleId) },
      });
      setVestingSchedules((prev) =>
        prev.map((s) => (s.id === scheduleId ? { ...s, revoked: true } : s))
      );
      updateTx(txId, { status: "success" });
      appendLog(`[vesting] Schedule #${scheduleId} revoked`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
      appendLog(`[error] Revoke failed: ${formatApiError(error)}`);
    } finally {
      setIsVestingLoading(false);
    }
  };

  const handleApproveMilestone = async (scheduleId: number, milestoneIndex: number) => {
    if (!contractId) return;
    const txId = addTx(`Approve milestone ${milestoneIndex} on schedule #${scheduleId}`);
    setIsVestingLoading(true);
    try {
      await requestJson("/api/invoke", {
        contractId,
        functionName: "approve_milestone",
        args: { schedule_id: String(scheduleId), milestone_index: String(milestoneIndex) },
      });
      setVestingSchedules((prev) =>
        prev.map((s) =>
          s.id === scheduleId
            ? {
                ...s,
                milestones: s.milestones.map((m) =>
                  m.index === milestoneIndex ? { ...m, approved: true } : m
                ),
              }
            : s
        )
      );
      updateTx(txId, { status: "success" });
      appendLog(`[vesting] Milestone ${milestoneIndex} approved on schedule #${scheduleId}`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
      appendLog(`[error] Approve milestone failed: ${formatApiError(error)}`);
    } finally {
      setIsVestingLoading(false);
    }
  };

  // ── DID Identity handlers ──────────────────────────────────────────────────

  const handleRegisterIdentity = async (did: string, metadataHash: number) => {
    if (!contractId || !wallet.address) return;
    const txId = addTx(`Register DID: ${did.slice(0, 24)}…`);
    setIsIdentityLoading(true);
    try {
      await requestJson("/api/invoke", {
        contractId,
        functionName: "register_identity",
        args: { did, metadata_hash: String(metadataHash) },
      });
      setIdentities((prev) => [
        ...prev,
        {
          owner: wallet.address!,
          did,
          metadataHash,
          reputation: 0,
          active: true,
          credentials: [],
        },
      ]);
      updateTx(txId, { status: "success" });
      appendLog(`[did] Identity registered: ${did}`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
      appendLog(`[error] Register identity failed: ${formatApiError(error)}`);
    } finally {
      setIsIdentityLoading(false);
    }
  };

  const handleUpdateMetadata = async (owner: string, metadataHash: number) => {
    if (!contractId) return;
    const txId = addTx(`Update metadata for ${owner.slice(0, 8)}…`);
    setIsIdentityLoading(true);
    try {
      await requestJson("/api/invoke", {
        contractId,
        functionName: "update_metadata",
        args: { owner, metadata_hash: String(metadataHash) },
      });
      setIdentities((prev) =>
        prev.map((id) => (id.owner === owner ? { ...id, metadataHash } : id))
      );
      updateTx(txId, { status: "success" });
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
      appendLog(`[error] Update metadata failed: ${formatApiError(error)}`);
    } finally {
      setIsIdentityLoading(false);
    }
  };

  const handleDeactivateIdentity = async (owner: string) => {
    if (!contractId) return;
    const txId = addTx(`Deactivate identity ${owner.slice(0, 8)}…`);
    setIsIdentityLoading(true);
    try {
      await requestJson("/api/invoke", {
        contractId,
        functionName: "deactivate_identity",
        args: { owner },
      });
      setIdentities((prev) =>
        prev.map((id) => (id.owner === owner ? { ...id, active: false } : id))
      );
      updateTx(txId, { status: "success" });
      appendLog(`[did] Identity deactivated: ${owner}`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
      appendLog(`[error] Deactivate failed: ${formatApiError(error)}`);
    } finally {
      setIsIdentityLoading(false);
    }
  };

  const handleIssueCredential = async (params: {
    issuer: string; subject: string; schemaHash: number;
    dataHash: number; expiresAt: number;
  }) => {
    if (!contractId) return;
    const txId = addTx(`Issue credential from ${params.issuer.slice(0, 8)}… to ${params.subject.slice(0, 8)}…`);
    setIsIdentityLoading(true);
    try {
      const payload = await requestJson<{ output: string }>("/api/invoke", {
        contractId,
        functionName: "issue_credential",
        args: {
          issuer: params.issuer,
          subject: params.subject,
          schema_hash: String(params.schemaHash),
          data_hash: String(params.dataHash),
          expires_at: String(params.expiresAt),
        },
      });
      const credId = parseInt(payload.output ?? "0");
      setIdentities((prev) =>
        prev.map((id) =>
          id.owner === params.subject
            ? {
                ...id,
                credentials: [
                  ...id.credentials,
                  {
                    id: credId,
                    subject: params.subject,
                    issuer: params.issuer,
                    schemaHash: params.schemaHash,
                    dataHash: params.dataHash,
                    status: "Active" as const,
                    issuedAt: Math.floor(Date.now() / 1000),
                    expiresAt: params.expiresAt,
                  },
                ],
              }
            : id
        )
      );
      updateTx(txId, { status: "success" });
      appendLog(`[did] Credential #${credId} issued`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
      appendLog(`[error] Issue credential failed: ${formatApiError(error)}`);
    } finally {
      setIsIdentityLoading(false);
    }
  };

  const handleRevokeCredential = async (credentialId: number) => {
    if (!contractId) return;
    const txId = addTx(`Revoke credential #${credentialId}`);
    setIsIdentityLoading(true);
    try {
      await requestJson("/api/invoke", {
        contractId,
        functionName: "revoke_credential",
        args: { credential_id: String(credentialId) },
      });
      setIdentities((prev) =>
        prev.map((id) => ({
          ...id,
          credentials: id.credentials.map((c) =>
            c.id === credentialId ? { ...c, status: "Revoked" as const } : c
          ),
        }))
      );
      updateTx(txId, { status: "success" });
      appendLog(`[did] Credential #${credentialId} revoked`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
      appendLog(`[error] Revoke credential failed: ${formatApiError(error)}`);
    } finally {
      setIsIdentityLoading(false);
    }
  };

  const handleAdjustReputation = async (subject: string, delta: number) => {
    if (!contractId) return;
    const txId = addTx(`Adjust reputation for ${subject.slice(0, 8)}… (${delta > 0 ? "+" : ""}${delta})`);
    setIsIdentityLoading(true);
    try {
      const payload = await requestJson<{ output: string }>("/api/invoke", {
        contractId,
        functionName: "adjust_reputation",
        args: { subject, delta: String(delta) },
      });
      const newScore = parseInt(payload.output ?? "0");
      setIdentities((prev) =>
        prev.map((id) => (id.owner === subject ? { ...id, reputation: newScore } : id))
      );
      updateTx(txId, { status: "success" });
      appendLog(`[did] Reputation updated: ${subject} → ${newScore}`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
      appendLog(`[error] Adjust reputation failed: ${formatApiError(error)}`);
    } finally {
      setIsIdentityLoading(false);
    }
  };

  // ── Multisig wallet handlers ───────────────────────────────────────────────

  const handleMultisigAddSigner = async (address: string, role: SignerRole) => {
    if (!contractId) return;
    const txId = addTx(`Add signer ${address.slice(0, 8)}… as ${role}`);
    setIsMultisigLoading(true);
    try {
      await requestJson("/api/invoke", {
        contractId,
        functionName: "add_signer",
        args: { caller: walletAddress ?? address, new_signer: address, role },
      });
      setMultisigSigners((prev) => [...prev, { address, role }]);
      updateTx(txId, { status: "success" });
      appendLog(`[multisig] Signer added: ${address} (${role})`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
      appendLog(`[error] Add signer failed: ${formatApiError(error)}`);
    } finally {
      setIsMultisigLoading(false);
    }
  };

  const handleMultisigRemoveSigner = async (address: string) => {
    if (!contractId) return;
    const txId = addTx(`Remove signer ${address.slice(0, 8)}…`);
    setIsMultisigLoading(true);
    try {
      await requestJson("/api/invoke", {
        contractId,
        functionName: "remove_signer",
        args: { caller: walletAddress ?? address, target: address },
      });
      setMultisigSigners((prev) => prev.filter((s) => s.address !== address));
      updateTx(txId, { status: "success" });
      appendLog(`[multisig] Signer removed: ${address}`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
      appendLog(`[error] Remove signer failed: ${formatApiError(error)}`);
    } finally {
      setIsMultisigLoading(false);
    }
  };

  const handleMultisigChangeThreshold = async (t: number) => {
    if (!contractId) return;
    const txId = addTx(`Change threshold to ${t}`);
    setIsMultisigLoading(true);
    try {
      await requestJson("/api/invoke", {
        contractId,
        functionName: "change_threshold",
        args: { caller: walletAddress ?? "", new_threshold: String(t) },
      });
      setMultisigThreshold(t);
      updateTx(txId, { status: "success" });
      appendLog(`[multisig] Threshold changed to ${t}`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
      appendLog(`[error] Change threshold failed: ${formatApiError(error)}`);
    } finally {
      setIsMultisigLoading(false);
    }
  };

  const handleMultisigPropose = async (description: string, amount: number, recipient?: string) => {
    if (!contractId) return;
    const txId = addTx(`Propose: "${description.slice(0, 30)}"`);
    setIsMultisigLoading(true);
    try {
      const payload = await requestJson<{ output: string }>("/api/invoke", {
        contractId,
        functionName: "propose",
        args: {
          proposer: walletAddress ?? "",
          description,
          amount: String(amount),
          ...(recipient ? { recipient } : {}),
        },
      });
      const newId = parseInt(payload.output ?? String(multisigTxs.length));
      const now = Math.floor(Date.now() / 1000);
      setMultisigTxs((prev) => [
        ...prev,
        {
          id: newId,
          proposer: walletAddress ?? "unknown",
          description,
          amount,
          recipient,
          status: "Pending",
          approvals: 0,
          threshold: multisigThreshold,
          createdAt: now,
          executeAfter: now + 86400,
        },
      ]);
      updateTx(txId, { status: "success" });
      appendLog(`[multisig] Transaction #${newId} proposed`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
      appendLog(`[error] Propose failed: ${formatApiError(error)}`);
    } finally {
      setIsMultisigLoading(false);
    }
  };

  const handleTransferCredits = async (to: string, amount: number) => {
    if (!contractId || !wallet.address) return;
    const txId = addTx(`Transfer ${amount} Carbon Credits to ${to.slice(0, 8)}…`);
    setIsCarbonLoading(true);
    try {
      await requestJson("/api/invoke", {
        contractId,
        functionName: "transfer",
        args: { from: wallet.address, to, amount: String(amount) },
      });
      setCarbonAssets(prev => ({ ...prev, balance: prev.balance - amount }));
      updateTx(txId, { status: "success" });
      appendLog(`[carbon] ${amount} credits transferred to ${to}`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
    } finally {
      setIsCarbonLoading(false);
    }
  };

  // ── Social Media handlers ──────────────────────────────────────────────────

  const handleRegisterSocialProfile = async (nickname: string, bio: string) => {
    if (!contractId || !wallet.address) return;
    const txId = addTx(`Create Social Profile: ${nickname}`);
    setIsSocialLoading(true);
    try {
      await requestJson("/api/invoke", {
        contractId,
        functionName: "create_profile",
        args: { user: wallet.address, nickname, bio },
      });
      setSocialProfile({
        address: wallet.address,
        nickname,
        bio,
        followers: 0,
      });
      updateTx(txId, { status: "success" });
      appendLog(`[social] Profile created: ${nickname}`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
    } finally {
      setIsSocialLoading(false);
    }
  };

  const handleCreatePost = async (content: string) => {
    if (!contractId || !wallet.address) return;
    const txId = addTx(`Post: "${content.slice(0, 20)}..."`);
    setIsSocialLoading(true);
    try {
      const payload = await requestJson<{ output: string }>("/api/invoke", {
        contractId,
        functionName: "create_post",
        args: { author: wallet.address, content },
      });
      const id = payload.output ?? String(Date.now());
      setSocialPosts((prev) => [
        { id, author: wallet.address!, content, likes: 0, tips: 0, timestamp: Math.floor(Date.now() / 1000) },
        ...prev,
      ]);
      updateTx(txId, { status: "success" });
      appendLog(`[social] Post created`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
    } finally {
      setIsSocialLoading(false);
    }
  };

  const handleLikePost = async (postId: string) => {
    if (!contractId || !wallet.address) return;
    const txId = addTx(`Like post ${postId}`);
    setIsSocialLoading(true);
    try {
      await requestJson("/api/invoke", {
        contractId,
        functionName: "like_post",
        args: { user: wallet.address, post_id: postId },
      });
      setSocialPosts((prev) => prev.map((p) => p.id === postId ? { ...p, likes: p.likes + 1 } : p));
      updateTx(txId, { status: "success" });
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
    } finally {
      setIsSocialLoading(false);
    }
  };

  const handleTipPost = async (postId: string, amount: number) => {
    if (!contractId || !wallet.address) return;
    const txId = addTx(`Tip post ${postId}: ${amount} XLM`);
    setIsSocialLoading(true);
    try {
      await requestJson("/api/invoke", {
        contractId,
        functionName: "tip_post",
        args: { tipper: wallet.address, post_id: postId, amount: String(amount) },
      });
      setSocialPosts((prev) => prev.map((p) => p.id === postId ? { ...p, tips: p.tips + amount } : p));
      updateTx(txId, { status: "success" });
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
    } finally {
      setIsSocialLoading(false);
    }
  };

  // ── Carbon Credit handlers ─────────────────────────────────────────────────

  const handleRegisterIssuer = async (name: string) => {
    if (!contractId || !wallet.address) return;
    const txId = addTx(`Register carbon issuer: ${name}`);
    setIsCarbonLoading(true);
    try {
      await requestJson("/api/invoke", {
        contractId,
        functionName: "register_issuer",
        args: { address: wallet.address, name },
      });
      setCarbonIssuer({ address: wallet.address!, name, verified: false, totalMinted: 0 });
      updateTx(txId, { status: "success" });
      appendLog(`[carbon] Issuer registered: ${name}`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
    } finally {
      setIsCarbonLoading(false);
    }
  };

  const handleVerifyIssuer = async (address: string) => {
    if (!contractId) return;
    const txId = addTx(`Verify issuer ${address.slice(0, 8)}…`);
    setIsCarbonLoading(true);
    try {
      await requestJson("/api/invoke", {
        contractId,
        functionName: "verify_issuer",
        args: { address },
      });
      setCarbonIssuer((prev) => prev ? { ...prev, verified: true } : prev);
      updateTx(txId, { status: "success" });
      appendLog(`[carbon] Issuer verified: ${address}`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
    } finally {
      setIsCarbonLoading(false);
    }
  };

  const handleMintCredits = async (to: string, amount: number) => {
    if (!contractId) return;
    const txId = addTx(`Mint ${amount} Carbon Credits to ${to.slice(0, 8)}…`);
    setIsCarbonLoading(true);
    try {
      await requestJson("/api/invoke", {
        contractId,
        functionName: "mint",
        args: { to, amount: String(amount) },
      });
      setCarbonAssets((prev) => ({ ...prev, balance: prev.balance + amount, totalOwned: prev.totalOwned + amount }));
      updateTx(txId, { status: "success" });
      appendLog(`[carbon] Minted ${amount} credits to ${to}`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
    } finally {
      setIsCarbonLoading(false);
    }
  };

  const handleRetireCredits = async (amount: number) => {
    if (!contractId || !wallet.address) return;
    const txId = addTx(`Retire ${amount} Carbon Credits`);
    setIsCarbonLoading(true);
    try {
      await requestJson("/api/invoke", {
        contractId,
        functionName: "retire",
        args: { owner: wallet.address, amount: String(amount) },
      });
      setCarbonAssets((prev) => ({ ...prev, balance: prev.balance - amount, totalRetired: prev.totalRetired + amount }));
      updateTx(txId, { status: "success" });
      appendLog(`[carbon] Retired ${amount} credits`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
    } finally {
      setIsCarbonLoading(false);
    }
  };

  const handleMultisigApprove = async (msigTxId: number) => {
    if (!contractId) return;
    const txId = addTx(`Approve tx #${msigTxId}`);
    setIsMultisigLoading(true);
    try {
      await requestJson("/api/invoke", {
        contractId,
        functionName: "approve",
        args: { signer: walletAddress ?? "", tx_id: String(msigTxId) },
      });
      setMultisigTxs((prev) =>
        prev.map((t) => {
          if (t.id !== msigTxId) return t;
          const newApprovals = t.approvals + 1;
          return {
            ...t,
            approvals: newApprovals,
            status: newApprovals >= t.threshold ? "Queued" : "Pending",
          };
        })
      );
      updateTx(txId, { status: "success" });
      appendLog(`[multisig] Tx #${msigTxId} approved`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
      appendLog(`[error] Approve failed: ${formatApiError(error)}`);
    } finally {
      setIsMultisigLoading(false);
    }
  };

  const handleMultisigExecute = async (msigTxId: number) => {
    if (!contractId) return;
    const txId = addTx(`Execute tx #${msigTxId}`);
    setIsMultisigLoading(true);
    try {
      await requestJson("/api/invoke", {
        contractId,
        functionName: "execute",
        args: { caller: walletAddress ?? "", tx_id: String(msigTxId) },
      });
      setMultisigTxs((prev) =>
        prev.map((t) => (t.id === msigTxId ? { ...t, status: "Executed" } : t))
      );
      updateTx(txId, { status: "success" });
      appendLog(`[multisig] Tx #${msigTxId} executed`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
      appendLog(`[error] Execute failed: ${formatApiError(error)}`);
    } finally {
      setIsMultisigLoading(false);
    }
  };

  const handleMultisigCancel = async (msigTxId: number) => {
    if (!contractId) return;
    const txId = addTx(`Cancel tx #${msigTxId}`);
    setIsMultisigLoading(true);
    try {
      await requestJson("/api/invoke", {
        contractId,
        functionName: "cancel",
        args: { caller: walletAddress ?? "", tx_id: String(msigTxId) },
      });
      setMultisigTxs((prev) =>
        prev.map((t) => (t.id === msigTxId ? { ...t, status: "Cancelled" } : t))
      );
      updateTx(txId, { status: "success" });
      appendLog(`[multisig] Tx #${msigTxId} cancelled`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
      appendLog(`[error] Cancel failed: ${formatApiError(error)}`);
    } finally {
      setIsMultisigLoading(false);
    }
  };

  // ── AMM pool handlers ──────────────────────────────────────────────────────

  const handleAmmSwap = async (tokenIn: "A" | "B", amountIn: number, minOut: number) => {
    if (!contractId) return;
    const txId = addTx(`Swap ${amountIn} Token${tokenIn}`);
    setIsAmmLoading(true);
    try {
      const payload = await requestJson<{ output: string }>("/api/invoke", {
        contractId,
        functionName: "swap",
        args: {
          trader: walletAddress ?? "",
          token_in: tokenIn === "A" ? "token_a" : "token_b",
          amount_in: String(amountIn),
          min_out: String(minOut),
        },
      });
      const out = parseInt(payload.output ?? "0");
      setAmmPool((prev) => {
        if (!prev) return prev;
        const [newRA, newRB] = tokenIn === "A"
          ? [prev.reserveA + amountIn, prev.reserveB - out]
          : [prev.reserveA - out, prev.reserveB + amountIn];
        return { ...prev, reserveA: newRA, reserveB: newRB };
      });
      updateTx(txId, { status: "success", hash: payload.output });
      appendLog(`[amm] Swapped ${amountIn} Token${tokenIn} → ${out}`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
      appendLog(`[error] Swap failed: ${formatApiError(error)}`);
    } finally {
      setIsAmmLoading(false);
    }
  };

  const handleAmmAddLiquidity = async (amountA: number, amountB: number, minLp: number) => {
    if (!contractId) return;
    const txId = addTx(`Add liquidity ${amountA}/${amountB}`);
    setIsAmmLoading(true);
    try {
      const payload = await requestJson<{ output: string }>("/api/invoke", {
        contractId,
        functionName: "add_liquidity",
        args: {
          provider: walletAddress ?? "",
          amount_a: String(amountA),
          amount_b: String(amountB),
          min_lp: String(minLp),
        },
      });
      const lp = parseInt(payload.output ?? "0");
      setAmmPool((prev) =>
        prev
          ? { ...prev, reserveA: prev.reserveA + amountA, reserveB: prev.reserveB + amountB, totalLp: prev.totalLp + lp }
          : { reserveA: amountA, reserveB: amountB, totalLp: lp, tokenALabel: "TKA", tokenBLabel: "TKB", feeBps: 30, priceACum: 0, priceBCum: 0 }
      );
      setAmmLpBalance((prev) => prev + lp);
      updateTx(txId, { status: "success" });
      appendLog(`[amm] Added liquidity, minted ${lp} LP`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
      appendLog(`[error] Add liquidity failed: ${formatApiError(error)}`);
    } finally {
      setIsAmmLoading(false);
    }
  };

  const handleAmmRemoveLiquidity = async (lpAmount: number, minA: number, minB: number) => {
    if (!contractId) return;
    const txId = addTx(`Remove ${lpAmount} LP`);
    setIsAmmLoading(true);
    try {
      const payload = await requestJson<{ output: string }>("/api/invoke", {
        contractId,
        functionName: "remove_liquidity",
        args: {
          provider: walletAddress ?? "",
          lp_amount: String(lpAmount),
          min_a: String(minA),
          min_b: String(minB),
        },
      });
      const [outA, outB] = (payload.output ?? "0,0").split(",").map(Number);
      setAmmPool((prev) =>
        prev
          ? { ...prev, reserveA: prev.reserveA - outA, reserveB: prev.reserveB - outB, totalLp: prev.totalLp - lpAmount }
          : prev
      );
      setAmmLpBalance((prev) => Math.max(0, prev - lpAmount));
      updateTx(txId, { status: "success" });
      appendLog(`[amm] Removed liquidity: ${outA} TKA + ${outB} TKB`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
      appendLog(`[error] Remove liquidity failed: ${formatApiError(error)}`);
    } finally {
      setIsAmmLoading(false);
    }
  };

  // ── Governance handlers ────────────────────────────────────────────────────

  const handleGovPropose = async (title: string, description: string) => {
    if (!contractId) return;
    const txId = addTx(`Propose: "${title.slice(0, 30)}"`);
    setIsGovLoading(true);
    try {
      const payload = await requestJson<{ output: string }>("/api/invoke", {
        contractId,
        functionName: "propose",
        args: { proposer: walletAddress ?? "", title, description, deposit: "0" },
      });
      const id = parseInt(payload.output ?? String(govProposals.length));
      const now = Math.floor(Date.now() / 1000);
      setGovProposals((prev) => [
        ...prev,
        {
          id,
          proposer: walletAddress ?? "unknown",
          title,
          description,
          status: "Active",
          votesFor: 0,
          votesAgainst: 0,
          votesAbstain: 0,
          totalSupplySnapshot: govVotingPower,
          quorumBps: 400,
          voteEnd: now + 604_800,
          executeAfter: now + 604_800 + 172_800,
        },
      ]);
      updateTx(txId, { status: "success" });
      appendLog(`[gov] Proposal #${id} created`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
      appendLog(`[error] Propose failed: ${formatApiError(error)}`);
    } finally {
      setIsGovLoading(false);
    }
  };

  const handleGovVote = async (proposalId: number, choice: GovVoteChoice) => {
    if (!contractId) return;
    const txId = addTx(`Vote ${choice} on proposal #${proposalId}`);
    setIsGovLoading(true);
    try {
      await requestJson("/api/invoke", {
        contractId,
        functionName: "vote",
        args: { voter: walletAddress ?? "", proposal_id: String(proposalId), choice },
      });
      setGovProposals((prev) =>
        prev.map((p) => {
          if (p.id !== proposalId) return p;
          return {
            ...p,
            votesFor: choice === "For" ? p.votesFor + govVotingPower : p.votesFor,
            votesAgainst: choice === "Against" ? p.votesAgainst + govVotingPower : p.votesAgainst,
            votesAbstain: choice === "Abstain" ? p.votesAbstain + govVotingPower : p.votesAbstain,
          };
        })
      );
      updateTx(txId, { status: "success" });
      appendLog(`[gov] Voted ${choice} on #${proposalId}`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
      appendLog(`[error] Vote failed: ${formatApiError(error)}`);
    } finally {
      setIsGovLoading(false);
    }
  };

  const handleGovFinalise = async (proposalId: number) => {
    if (!contractId) return;
    const txId = addTx(`Finalise proposal #${proposalId}`);
    setIsGovLoading(true);
    try {
      const payload = await requestJson<{ output: string }>("/api/invoke", {
        contractId,
        functionName: "finalise",
        args: { proposal_id: String(proposalId) },
      });
      const status = payload.output === "2" ? "Passed" : "Defeated";
      setGovProposals((prev) =>
        prev.map((p) => (p.id === proposalId ? { ...p, status: status as GovernanceProposal["status"] } : p))
      );
      updateTx(txId, { status: "success" });
      appendLog(`[gov] Proposal #${proposalId} ${status}`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
      appendLog(`[error] Finalise failed: ${formatApiError(error)}`);
    } finally {
      setIsGovLoading(false);
    }
  };

  const handleGovExecute = async (proposalId: number) => {
    if (!contractId) return;
    const txId = addTx(`Execute proposal #${proposalId}`);
    setIsGovLoading(true);
    try {
      await requestJson("/api/invoke", {
        contractId,
        functionName: "execute",
        args: { caller: walletAddress ?? "", proposal_id: String(proposalId) },
      });
      setGovProposals((prev) =>
        prev.map((p) => (p.id === proposalId ? { ...p, status: "Executed" } : p))
      );
      updateTx(txId, { status: "success" });
      appendLog(`[gov] Proposal #${proposalId} executed`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
      appendLog(`[error] Execute failed: ${formatApiError(error)}`);
    } finally {
      setIsGovLoading(false);
    }
  };

  const handleGovDelegate = async (to: string | null) => {
    if (!contractId) return;
    const txId = addTx(to ? `Delegate to ${to.slice(0, 8)}…` : "Revoke delegation");
    setIsGovLoading(true);
    try {
      await requestJson("/api/invoke", {
        contractId,
        functionName: "delegate",
        args: { from: walletAddress ?? "", ...(to ? { to } : {}) },
      });
      updateTx(txId, { status: "success" });
      appendLog(`[gov] ${to ? `Delegated to ${to}` : "Delegation revoked"}`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
      appendLog(`[error] Delegate failed: ${formatApiError(error)}`);
    } finally {
      setIsGovLoading(false);
    }
  };

  const walletAddress = wallet.address ?? undefined;

  const handleRegisterProduct = async (name: string, metadataHash: number) => {
    if (!contractId || !wallet.address) return;
    const txId = addTx(`Register product: "${name}"`);
    setIsSupplyChainLoading(true);
    try {
      const payload = await requestJson<{ output: string }>("/api/invoke", {
        contractId,
        functionName: "register_product",
        args: { owner: wallet.address, name, metadata_hash: String(metadataHash) },
      });
      const id = parseInt(payload.output ?? String(supplyChainProducts.length + 1));
      setSupplyChainProducts((prev) => [
        ...prev,
        {
          id,
          owner: wallet.address!,
          name,
          metadataHash,
          status: "Registered" as SupplyChainStatus,
          createdAt: Math.floor(Date.now() / 1000),
          checkpointCount: 0,
        },
      ]);
      updateTx(txId, { status: "success" });
      appendLog(`[supply-chain] Product #${id} registered`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
      appendLog(`[error] Register product failed: ${formatApiError(error)}`);
    } finally {
      setIsSupplyChainLoading(false);
    }
  };

  const handleAddCheckpoint = async (productId: number, locationHash: number, notesHash: number) => {
    if (!contractId || !wallet.address) return;
    const txId = addTx(`Checkpoint for product #${productId}`);
    setIsSupplyChainLoading(true);
    try {
      await requestJson("/api/invoke", {
        contractId,
        functionName: "add_checkpoint",
        args: {
          handler: wallet.address,
          product_id: String(productId),
          location_hash: String(locationHash),
          notes_hash: String(notesHash),
        },
      });
      setSupplyChainProducts((prev) =>
        prev.map((p) =>
          p.id === productId
            ? { ...p, status: "InTransit" as SupplyChainStatus, checkpointCount: p.checkpointCount + 1 }
            : p
        )
      );
      updateTx(txId, { status: "success" });
      appendLog(`[supply-chain] Checkpoint added for product #${productId}`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
      appendLog(`[error] Add checkpoint failed: ${formatApiError(error)}`);
    } finally {
      setIsSupplyChainLoading(false);
    }
  };

  const handleSubmitQualityReport = async (productId: number, result: SupplyChainQuality, reportHash: number) => {
    if (!contractId || !wallet.address) return;
    const txId = addTx(`QA report for product #${productId}: ${result}`);
    setIsSupplyChainLoading(true);
    try {
      await requestJson("/api/invoke", {
        contractId,
        functionName: "submit_quality_report",
        args: {
          inspector: wallet.address,
          product_id: String(productId),
          result,
          report_hash: String(reportHash),
        },
      });
      const newStatus: SupplyChainStatus =
        result === "Pass" ? "Approved" : result === "Fail" ? "Rejected" : "QualityCheck";
      setSupplyChainProducts((prev) =>
        prev.map((p) => (p.id === productId ? { ...p, status: newStatus } : p))
      );
      updateTx(txId, { status: "success" });
      appendLog(`[supply-chain] QA report submitted for product #${productId}: ${result}`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
      appendLog(`[error] QA report failed: ${formatApiError(error)}`);
    } finally {
      setIsSupplyChainLoading(false);
    }
  };

  const handleRecallProduct = async (productId: number) => {
    if (!contractId || !wallet.address) return;
    const txId = addTx(`Recall product #${productId}`);
    setIsSupplyChainLoading(true);
    try {
      await requestJson("/api/invoke", {
        contractId,
        functionName: "recall_product",
        args: { caller: wallet.address, product_id: String(productId) },
      });
      setSupplyChainProducts((prev) =>
        prev.map((p) => (p.id === productId ? { ...p, status: "Recalled" as SupplyChainStatus } : p))
      );
      updateTx(txId, { status: "success" });
      appendLog(`[supply-chain] Product #${productId} recalled`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
      appendLog(`[error] Recall failed: ${formatApiError(error)}`);
    } finally {
      setIsSupplyChainLoading(false);
    }
  };

  const handleUpdateSupplyChainStatus = async (productId: number, status: SupplyChainStatus) => {
    if (!contractId || !wallet.address) return;
    const txId = addTx(`Update product #${productId} → ${status}`);
    setIsSupplyChainLoading(true);
    try {
      await requestJson("/api/invoke", {
        contractId,
        functionName: "update_status",
        args: { caller: wallet.address, product_id: String(productId), new_status: status },
      });
      setSupplyChainProducts((prev) =>
        prev.map((p) => (p.id === productId ? { ...p, status } : p))
      );
      updateTx(txId, { status: "success" });
      appendLog(`[supply-chain] Product #${productId} status → ${status}`);
    } catch (error) {
      updateTx(txId, { status: "error", error: formatApiError(error) });
      appendLog(`[error] Update status failed: ${formatApiError(error)}`);
    } finally {
      setIsSupplyChainLoading(false);
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
            <TransactionCallGraph
              graph={transactionGraph}
              selectedNodeId={selectedGraphNodeId}
              onNodeSelect={handleGraphNodeSelect}
            />
            <StorageTimeline
              totalFrames={storageTimeline.snapshots.length}
              currentFrame={Math.max(storageTimeline.currentIndex, 0)}
              contextLabel={activeSnapshot?.contextLabel ?? storageContextLabel}
              capturedAt={activeSnapshot?.capturedAt}
              onScrub={handleTimelineScrub}
            />
            <StorageViewer
              storage={storage}
              contextLabel={storageContextLabel}
              totalFrames={storageTimeline.snapshots.length}
              currentFrame={Math.max(storageTimeline.currentIndex, 0)}
              capturedAt={activeSnapshot?.capturedAt}
              onScrubTimeline={handleTimelineScrub}
            />
            <WalletConnect wallet={wallet} />
            <PredictionMarketPanel
              contractId={contractId}
              walletAddress={wallet.address ?? undefined}
              onCreateMarket={handleCreateMarket}
              onPlaceBet={handlePlaceBet}
              onResolveMarket={handleResolveMarket}
              onCancelMarket={handleCancelMarket}
              onCalculatePayout={handleCalculatePayout}
              markets={markets}
              isLoading={isPredictionLoading}
            />
            <VestingDashboard
              contractId={contractId}
              walletAddress={wallet.address ?? undefined}
              schedules={vestingSchedules}
              isLoading={isVestingLoading}
              onCreateLinear={handleCreateLinear}
              onCreateMilestone={handleCreateMilestone}
              onRelease={handleVestingRelease}
              onRevoke={handleVestingRevoke}
              onApproveMilestone={handleApproveMilestone}
            />
            <IdentityPortal
              contractId={contractId}
              walletAddress={wallet.address ?? undefined}
              identities={identities}
              isLoading={isIdentityLoading}
              onRegister={handleRegisterIdentity}
              onUpdateMetadata={handleUpdateMetadata}
              onDeactivate={handleDeactivateIdentity}
              onIssueCredential={handleIssueCredential}
              onRevokeCredential={handleRevokeCredential}
              onAdjustReputation={handleAdjustReputation}
            />
            <FreelancerIdentityDashboard
              profiles={freelancerProfiles}
              analytics={freelancerAnalytics}
              isLoading={isFreelancerIdentityLoading}
              onRefresh={loadFreelancerIdentity}
              onCreateProfile={handleCreateFreelancerProfile}
              onVerifyPortfolio={handleVerifyFreelancerPortfolio}
              onEndorseSkill={handleEndorseFreelancerSkill}
            />
            <CarbonCreditDashboard
              isLoading={isCarbonLoading}
              issuer={carbonIssuer}
              assets={carbonAssets}
              onRegisterIssuer={handleRegisterIssuer}
              onVerifyIssuer={handleVerifyIssuer}
              onMint={handleMintCredits}
              onTransfer={handleTransferCredits}
              onRetire={handleRetireCredits}
            />
            <SocialFeedInterface
              isLoading={isSocialLoading}
              profile={socialProfile}
              posts={socialPosts}
              onRegisterProfile={handleRegisterSocialProfile}
              onCreatePost={handleCreatePost}
              onLikePost={handleLikePost}
              onTipPost={handleTipPost}
            />
            <LendingDashboard />
            <FlashLoanPanel />
            <CloudStoragePanel />
            <MusicRoyaltyPanel />
            <MultisigWalletDashboard
              contractId={contractId}
              walletAddress={walletAddress}
              signers={multisigSigners}
              transactions={multisigTxs}
              threshold={multisigThreshold}
              isLoading={isMultisigLoading}
              onAddSigner={handleMultisigAddSigner}
              onRemoveSigner={handleMultisigRemoveSigner}
              onChangeThreshold={handleMultisigChangeThreshold}
              onPropose={handleMultisigPropose}
              onApprove={handleMultisigApprove}
              onExecute={handleMultisigExecute}
              onCancel={handleMultisigCancel}
            />
            <AmmPoolPanel
              contractId={contractId}
              walletAddress={walletAddress}
              pool={ammPool}
              lpBalance={ammLpBalance}
              isLoading={isAmmLoading}
              onSwap={handleAmmSwap}
              onAddLiquidity={handleAmmAddLiquidity}
              onRemoveLiquidity={handleAmmRemoveLiquidity}
            />
            <GovernancePortal
              contractId={contractId}
              walletAddress={walletAddress}
              proposals={govProposals}
              votingPower={govVotingPower}
              isLoading={isGovLoading}
              onPropose={handleGovPropose}
              onVote={handleGovVote}
              onFinalise={handleGovFinalise}
              onExecute={handleGovExecute}
              onDelegate={handleGovDelegate}
            />
            <SupplyChainPanel
              contractId={contractId}
              walletAddress={wallet.address ?? undefined}
              products={supplyChainProducts}
              isLoading={isSupplyChainLoading}
              onRegisterProduct={handleRegisterProduct}
              onAddCheckpoint={handleAddCheckpoint}
              onSubmitQualityReport={handleSubmitQualityReport}
              onRecallProduct={handleRecallProduct}
              onUpdateStatus={handleUpdateSupplyChainStatus}
            />
            <TransactionStatus transactions={transactions} onClear={clearTx} />
            <Console 
              logs={logs} 
              baseLineNumber={0} 
              droppedMessages={droppedMessages} 
              isIngestionPaused={isIngestionPaused} 
              onIngestionPauseChange={setIsIngestionPaused} 
            />
          </aside>
        </main>
      </div>
    </div>
  );
}
