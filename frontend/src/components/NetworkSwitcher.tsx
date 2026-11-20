"use client";

import React, { useEffect, useState, useCallback, useRef, useContext, startTransition } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, RefreshCw, Server } from "lucide-react";
import { WalletContext } from "./providers/WalletProvider";

export type NetworkId = "mainnet" | "testnet" | "futurenet" | "local";

export interface NetworkConfig {
  id: NetworkId;
  name: string;
  rpcUrl: string;
  passphrase: string;
}

export const NETWORKS: Record<NetworkId, NetworkConfig> = {
  mainnet: {
    id: "mainnet",
    name: "Mainnet",
    rpcUrl: "https://soroban-rpc.mainnet.stellar.org",
    passphrase: "Public Global Stellar Network ; September 2015",
  },
  testnet: {
    id: "testnet",
    name: "Testnet",
    rpcUrl: "https://soroban-testnet.stellar.org",
    passphrase: "Test SDF Network ; September 2015",
  },
  futurenet: {
    id: "futurenet",
    name: "Futurenet",
    rpcUrl: "https://rpc-futurenet.stellar.org",
    passphrase: "Test SDF Future Network ; October 2022",
  },
  local: {
    id: "local",
    name: "Local Standalone",
    rpcUrl: "http://localhost:8000/soroban/rpc",
    passphrase: "Standalone Network ; February 2022",
  },
};

export const CONTRACT_REGISTERS_KEY_PREFIX = "soroban_contract_register_";
export const ACTIVE_CONTRACT_KEY = "soroban_active_contract_id";

export interface NetworkHealth {
  status: "healthy" | "degraded" | "offline" | "checking";
  latencyMs: number | null;
  lastChecked: number | null;
  error?: string;
}

export interface NetworkSwitcherProps {
  /** Optional override for connected wallet network (e.g. for testing) */
  walletNetwork?: string | null;
  /** Optional override for wallet connected state (e.g. for testing) */
  isWalletConnected?: boolean;
}

/**
 * Normalizes network identifiers / passphrases for equality checks.
 */
export function normalizeNetwork(net: string | null | undefined): NetworkId | null {
  if (!net) return null;
  const lower = net.trim().toLowerCase();
  if (lower.includes("main") || lower.includes("public")) return "mainnet";
  if (lower.includes("test")) return "testnet";
  if (lower.includes("future")) return "futurenet";
  if (lower.includes("local") || lower.includes("standalone")) return "local";
  return null;
}

/**
 * Automatically clear active contract address caches and reload deployed
 * contract registers corresponding to the newly selected network.
 */
export function clearAndReloadContractRegisters(newNetworkId: NetworkId): string[] {
  if (typeof window === "undefined") return [];

  try {
    // 1. Invalidate active contract address register to prevent cross-network invocations
    window.localStorage.removeItem(ACTIVE_CONTRACT_KEY);
    window.localStorage.removeItem("soroban_contract_id");

    // 2. Reload deployed contract address register for this network
    const networkKey = `${CONTRACT_REGISTERS_KEY_PREFIX}${newNetworkId}`;
    const raw = window.localStorage.getItem(networkKey);
    let reloadedContracts: string[] = [];

    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          reloadedContracts = parsed.filter(
            (item): item is string => typeof item === "string",
          );
        }
      } catch {
        reloadedContracts = [];
      }
    }

    // 3. Dispatch contract cache invalidation events to synchronize registers across the dApp
    window.dispatchEvent(
      new CustomEvent("soroban-contract-cache-invalidation", {
        detail: {
          network: newNetworkId,
          reloadedContracts,
        },
      }),
    );

    window.dispatchEvent(
      new CustomEvent("soroban-contracts-invalidated", {
        detail: {
          network: newNetworkId,
          reloadedContracts,
        },
      }),
    );

    return reloadedContracts;
  } catch {
    return [];
  }
}

export default function NetworkSwitcher({
  walletNetwork: propWalletNetwork,
  isWalletConnected: propIsWalletConnected,
}: NetworkSwitcherProps = {}) {
  const walletContext = useContext(WalletContext);

  const isConnected =
    propIsWalletConnected ??
    (walletContext?.status === "connected" || Boolean(walletContext?.activeAccount));

  const connectedWalletNetRaw =
    propWalletNetwork ??
    walletContext?.network ??
    walletContext?.networkPassphrase;

  const connectedWalletNetwork = normalizeNetwork(connectedWalletNetRaw);

  const [selectedNetwork, setSelectedNetwork] = useState<NetworkId>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("soroban_playground_network");
      if (saved && saved in NETWORKS) {
        return saved as NetworkId;
      }
    }
    return "testnet";
  });

  const [healthMap, setHealthMap] = useState<Record<NetworkId, NetworkHealth>>({
    mainnet: { status: "checking", latencyMs: null, lastChecked: null },
    testnet: { status: "checking", latencyMs: null, lastChecked: null },
    futurenet: { status: "checking", latencyMs: null, lastChecked: null },
    local: { status: "checking", latencyMs: null, lastChecked: null },
  });

  const [isOpen, setIsOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isMountedRef = useRef(true);
  const activeControllersRef = useRef<Set<AbortController>>(new Set());
  const prevNetworkRef = useRef<NetworkId>(selectedNetwork);

  // Warning when connected wallet network diverges from the playground network
  const hasNetworkMismatch = Boolean(
    isConnected &&
      connectedWalletNetwork &&
      connectedWalletNetwork !== selectedNetwork,
  );

  const checkNetworkLatency = useCallback(async (netId: NetworkId) => {
    const net = NETWORKS[netId];
    const start = performance.now();
    const controller = new AbortController();
    activeControllersRef.current.add(controller);

    try {
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const res = await fetch(net.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getHealth",
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const end = performance.now();
      const latency = Math.round(end - start);

      if (!isMountedRef.current) return;

      if (res.ok) {
        const data = await res.json();
        const isHealthy =
          data.result?.status === "healthy" || Boolean(data.result);
        const status = !isHealthy
          ? "offline"
          : latency < 300
            ? "healthy"
            : "degraded";

        startTransition(() => {
          setHealthMap((prev) => ({
            ...prev,
            [netId]: {
              status,
              latencyMs: latency,
              lastChecked: Date.now(),
              error: !isHealthy ? "Unhealthy response" : undefined,
            },
          }));
        });
      } else {
        startTransition(() => {
          setHealthMap((prev) => ({
            ...prev,
            [netId]: {
              status: "offline",
              latencyMs: latency,
              lastChecked: Date.now(),
              error: `HTTP ${res.status}`,
            },
          }));
        });
      }
    } catch (err) {
      if (!isMountedRef.current) return;
      let errorMessage = "Network Error";
      if (err instanceof Error) {
        if (err.name === "AbortError") {
          errorMessage = "Timeout";
        } else {
          errorMessage = err.message;
        }
      }
      startTransition(() => {
        setHealthMap((prev) => ({
          ...prev,
          [netId]: {
            status: "offline",
            latencyMs: null,
            lastChecked: Date.now(),
            error: errorMessage,
          },
        }));
      });
    } finally {
      activeControllersRef.current.delete(controller);
    }
  }, []);

  const pingAllNetworks = useCallback(
    async (showRefreshingSpinner = false) => {
      if (showRefreshingSpinner && isMountedRef.current) {
        setIsRefreshing(true);
      }
      try {
        await Promise.all(
          (Object.keys(NETWORKS) as NetworkId[]).map((id) =>
            checkNetworkLatency(id),
          ),
        );
      } finally {
        if (showRefreshingSpinner && isMountedRef.current) {
          setIsRefreshing(false);
        }
      }
    },
    [checkNetworkLatency],
  );

  // Ping active RPC endpoints on mount and periodically every 15 seconds
  useEffect(() => {
    isMountedRef.current = true;
    const activeControllers = activeControllersRef.current;
    void pingAllNetworks(false);

    const interval = setInterval(() => {
      void pingAllNetworks(false);
    }, 15000);

    return () => {
      isMountedRef.current = false;
      clearInterval(interval);
      activeControllers.forEach((c) => c.abort());
      activeControllers.clear();
    };
  }, [pingAllNetworks]);

  // Synchronize network changes, invalidate/reload contract registers, and dispatch events
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("soroban_playground_network", selectedNetwork);
      if (prevNetworkRef.current !== selectedNetwork) {
        clearAndReloadContractRegisters(selectedNetwork);
        prevNetworkRef.current = selectedNetwork;
      }
      window.dispatchEvent(
        new CustomEvent("soroban-network-change", {
          detail: { network: selectedNetwork },
        }),
      );
    }
  }, [selectedNetwork]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelectNetwork = useCallback(
    (netId: NetworkId) => {
      setSelectedNetwork(netId);
      setIsOpen(false);
      if (typeof window !== "undefined") {
        localStorage.setItem("soroban_playground_network", netId);
        clearAndReloadContractRegisters(netId);
        prevNetworkRef.current = netId;
        window.dispatchEvent(
          new CustomEvent("soroban-network-change", {
            detail: { network: netId },
          }),
        );
      }
      void checkNetworkLatency(netId);
    },
    [checkNetworkLatency],
  );

  const currentNet = NETWORKS[selectedNetwork];
  const currentHealth = healthMap[selectedNetwork];

  const getStatusDot = (status: NetworkHealth["status"]) => {
    switch (status) {
      case "healthy":
        return "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]";
      case "degraded":
        return "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]";
      case "offline":
        return "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]";
      default:
        return "bg-slate-400 animate-pulse";
    }
  };

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 border ${
          hasNetworkMismatch
            ? "border-amber-500/70 text-amber-200 hover:border-amber-400"
            : "border-slate-700/60 hover:border-slate-600 text-slate-200"
        } text-xs font-medium transition-all shadow-sm group`}
        aria-label="Select Network"
        aria-expanded={isOpen}
      >
        <span
          className={`h-2 w-2 rounded-full ${getStatusDot(currentHealth.status)}`}
        />
        <span className="font-semibold uppercase tracking-wider">
          {currentNet.name}
        </span>
        {currentHealth.latencyMs !== null ? (
          <span className="font-mono text-[10px] text-slate-400 bg-slate-800/80 px-1.5 py-0.5 rounded">
            {currentHealth.latencyMs}ms
          </span>
        ) : (
          <span className="font-mono text-[10px] text-slate-500">--</span>
        )}

        {hasNetworkMismatch && (
          <span
            data-testid="network-mismatch-warning"
            title={`Wallet network mismatch: wallet is on ${connectedWalletNetwork}, playground is on ${selectedNetwork}`}
            className="flex items-center gap-1 text-amber-400 pl-0.5"
          >
            <AlertTriangle size={13} className="animate-pulse" />
          </span>
        )}

        <ChevronDown
          size={14}
          className={`text-slate-400 group-hover:text-slate-200 transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 rounded-2xl bg-slate-950 border border-slate-800 shadow-2xl backdrop-blur-xl z-50 p-2 space-y-2">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-800/60">
            <div className="flex items-center gap-2 text-slate-400 text-xs font-semibold uppercase tracking-wider">
              <Server size={14} className="text-teal-400" />
              <span>RPC Networks</span>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                void pingAllNetworks(true);
              }}
              disabled={isRefreshing}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              title="Ping RPC Endpoints"
              aria-label="Ping RPC Endpoints"
            >
              <RefreshCw
                size={12}
                className={isRefreshing ? "animate-spin text-teal-400" : ""}
              />
            </button>
          </div>

          {/* Network Mismatch Warning Banner */}
          {hasNetworkMismatch && (
            <div
              role="alert"
              data-testid="wallet-network-mismatch-banner"
              className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs space-y-1.5"
            >
              <div className="flex items-center gap-1.5 font-semibold text-amber-300">
                <AlertTriangle size={14} className="text-amber-400 shrink-0" />
                <span>Wallet Network Mismatch</span>
              </div>
              <p className="text-[11px] text-amber-200/90 leading-relaxed">
                Connected wallet is on{" "}
                <strong className="uppercase font-mono text-amber-100">
                  {connectedWalletNetwork}
                </strong>
                , but playground is targeting{" "}
                <strong className="uppercase font-mono text-amber-100">
                  {currentNet.name}
                </strong>
                . Deployed contract invocations and signatures may fail.
              </p>
              {connectedWalletNetwork &&
                connectedWalletNetwork in NETWORKS &&
                connectedWalletNetwork !== selectedNetwork && (
                  <button
                    type="button"
                    onClick={() =>
                      handleSelectNetwork(connectedWalletNetwork as NetworkId)
                    }
                    className="mt-1 text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 border border-amber-500/40 transition-colors w-full text-center"
                  >
                    Switch Playground to{" "}
                    {NETWORKS[connectedWalletNetwork as NetworkId].name}
                  </button>
                )}
            </div>
          )}

          {/* Network Selection List */}
          <div className="space-y-1 py-0.5">
            {(Object.keys(NETWORKS) as NetworkId[]).map((id) => {
              const net = NETWORKS[id];
              const health = healthMap[id];
              const isSelected = id === selectedNetwork;

              return (
                <button
                  key={id}
                  onClick={() => handleSelectNetwork(id)}
                  className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left transition-all ${
                    isSelected
                      ? "bg-teal-500/10 border border-teal-500/30 text-white"
                      : "hover:bg-slate-900 text-slate-300 border border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={`h-2 w-2 rounded-full shrink-0 ${getStatusDot(health.status)}`}
                    />
                    <div className="truncate">
                      <p className="text-xs font-semibold uppercase tracking-wider">
                        {net.name}
                      </p>
                      <p className="text-[10px] text-slate-500 font-mono truncate">
                        {net.rpcUrl}
                      </p>
                    </div>
                  </div>

                  <div className="text-right shrink-0 ml-2 flex flex-col items-end justify-center">
                    {health.status === "checking" ? (
                      <span className="font-mono text-[10px] text-slate-400 font-medium animate-pulse">
                        Checking...
                      </span>
                    ) : health.status === "offline" ? (
                      <div className="flex flex-col items-end">
                        <span className="text-[10px] text-rose-400 font-medium">
                          Offline
                        </span>
                        {health.error && (
                          <span
                            className="text-[9px] text-rose-400/80 max-w-[90px] truncate"
                            title={health.error}
                          >
                            {health.error}
                          </span>
                        )}
                      </div>
                    ) : health.latencyMs !== null ? (
                      <span
                        className={`font-mono text-[10px] font-medium ${
                          health.status === "degraded"
                            ? "text-amber-400"
                            : "text-teal-300"
                        }`}
                      >
                        {health.latencyMs}ms
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-500">--</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Footer: Contract Cache Status */}
          <div className="flex items-center justify-between px-3 py-1.5 border-t border-slate-800/60 text-[10px] text-slate-400 font-mono">
            <span>Contract Cache</span>
            <span className="text-emerald-400 flex items-center gap-1">
              <CheckCircle2 size={10} />
              Synchronized ({currentNet.name})
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
