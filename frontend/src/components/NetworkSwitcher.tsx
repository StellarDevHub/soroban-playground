"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  RefreshCw,
  Server,
} from "lucide-react";
import { readJson } from "@/lib/offline/storage";
import { DEPLOYED_CONTRACTS_STORAGE_KEY } from "@/hooks/useDeployedContracts";

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

export const NETWORK_STORAGE_KEY = "soroban_playground_network";
export const CONTRACT_REGISTERS_KEY_PREFIX = "soroban_contract_register_";
export const ACTIVE_CONTRACT_KEY = "soroban_active_contract_id";
const LEGACY_ACTIVE_CONTRACT_KEY = "soroban_contract_id";

export interface NetworkHealth {
  status: "healthy" | "degraded" | "offline" | "checking";
  latencyMs: number | null;
  lastChecked: number | null;
  error?: string;
}

export interface NetworkSwitcherProps {
  isWalletConnected?: boolean;
  walletNetwork?: string | null;
}

/** Map wallet names and network passphrases onto the playground network ids. */
export function normalizeNetwork(
  network: string | null | undefined,
): NetworkId | null {
  if (!network) return null;
  const value = network.trim().toLowerCase();
  if (!value) return null;
  if (value.includes("future")) return "futurenet";
  if (value.includes("standalone") || value.includes("local")) return "local";
  if (value.includes("main") || value.includes("public")) return "mainnet";
  if (value.includes("test")) return "testnet";
  return null;
}

function parseContractIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function readNetworkContracts(networkId: NetworkId): string[] {
  const entries = readJson<unknown>(DEPLOYED_CONTRACTS_STORAGE_KEY, []);
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const contract = entry as { contractId?: unknown; network?: unknown };
    if (
      typeof contract.contractId !== "string" ||
      normalizeNetwork(
        typeof contract.network === "string" ? contract.network : null,
      ) !== networkId
    ) {
      return [];
    }
    return [contract.contractId];
  });
}

/**
 * Drop cross-network contract selections and reload the register belonging to
 * the newly selected network so invocations never reuse a stale contract id.
 */
export function clearAndReloadContractRegisters(
  networkId: NetworkId,
): string[] {
  if (typeof window === "undefined") return [];

  try {
    window.localStorage.removeItem(ACTIVE_CONTRACT_KEY);
    window.localStorage.removeItem(LEGACY_ACTIVE_CONTRACT_KEY);

    const reloadedContracts = Array.from(
      new Set([
        ...parseContractIds(
          window.localStorage.getItem(
            `${CONTRACT_REGISTERS_KEY_PREFIX}${networkId}`,
          ),
        ),
        ...readNetworkContracts(networkId),
      ]),
    );
    const detail = {
      network: networkId,
      reloadedContracts,
    };

    window.dispatchEvent(
      new CustomEvent("soroban-contract-cache-invalidation", { detail }),
    );
    window.dispatchEvent(
      new CustomEvent("soroban-contracts-invalidated", { detail }),
    );

    return reloadedContracts;
  } catch {
    return [];
  }
}

export default function NetworkSwitcher({
  isWalletConnected: connectedProp,
  walletNetwork: walletNetworkProp,
}: NetworkSwitcherProps = {}) {
  const isWalletConnected = connectedProp ?? false;
  const walletNetwork = normalizeNetwork(walletNetworkProp);

  const [selectedNetwork, setSelectedNetwork] = useState<NetworkId>(() => {
    if (typeof window !== "undefined") {
      const saved = window.localStorage.getItem(NETWORK_STORAGE_KEY);
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
  const mountedRef = useRef(true);
  const controllersRef = useRef<Set<AbortController>>(new Set());
  const previousNetworkRef = useRef<NetworkId>(selectedNetwork);

  const hasNetworkMismatch = Boolean(
    isWalletConnected && walletNetwork && walletNetwork !== selectedNetwork,
  );

  const checkNetworkLatency = useCallback(async (networkId: NetworkId) => {
    const controller = new AbortController();
    controllersRef.current.add(controller);
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const start = performance.now();

    try {
      const response = await fetch(NETWORKS[networkId].rpcUrl, {
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

      if (!mountedRef.current) return;
      const latencyMs = Math.round(performance.now() - start);

      if (!response.ok) {
        setHealthMap((previous) => ({
          ...previous,
          [networkId]: {
            status: "offline",
            latencyMs,
            lastChecked: Date.now(),
            error: `HTTP ${response.status}`,
          },
        }));
        return;
      }

      const data = await response.json();
      const isHealthy = Boolean(data?.result);
      setHealthMap((previous) => ({
        ...previous,
        [networkId]: {
          status: isHealthy
            ? latencyMs < 300
              ? "healthy"
              : "degraded"
            : "offline",
          latencyMs,
          lastChecked: Date.now(),
          error: isHealthy ? undefined : "Unhealthy response",
        },
      }));
    } catch (error) {
      if (!mountedRef.current) return;
      const errorMessage =
        error instanceof Error && error.name === "AbortError"
          ? "Timeout"
          : error instanceof Error
            ? error.message
            : "Network Error";
      setHealthMap((previous) => ({
        ...previous,
        [networkId]: {
          status: "offline",
          latencyMs: null,
          lastChecked: Date.now(),
          error: errorMessage,
        },
      }));
    } finally {
      clearTimeout(timeoutId);
      controllersRef.current.delete(controller);
    }
  }, []);

  const pingAllNetworks = useCallback(
    async (showSpinner = false) => {
      if (showSpinner && mountedRef.current) setIsRefreshing(true);
      try {
        await Promise.all(
          (Object.keys(NETWORKS) as NetworkId[]).map((id) =>
            checkNetworkLatency(id),
          ),
        );
      } finally {
        if (showSpinner && mountedRef.current) setIsRefreshing(false);
      }
    },
    [checkNetworkLatency],
  );

  useEffect(() => {
    mountedRef.current = true;
    const controllers = controllersRef.current;
    void pingAllNetworks();
    const interval = setInterval(() => {
      void pingAllNetworks();
    }, 15000);

    return () => {
      clearInterval(interval);
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
      mountedRef.current = false;
    };
  }, [pingAllNetworks]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(NETWORK_STORAGE_KEY, selectedNetwork);

    if (previousNetworkRef.current !== selectedNetwork) {
      clearAndReloadContractRegisters(selectedNetwork);
      previousNetworkRef.current = selectedNetwork;
    }

    window.dispatchEvent(
      new CustomEvent("soroban-network-change", {
        detail: { network: selectedNetwork },
      }),
    );
  }, [selectedNetwork]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelectNetwork = useCallback(
    (networkId: NetworkId) => {
      setSelectedNetwork(networkId);
      setIsOpen(false);
      void checkNetworkLatency(networkId);
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
            title={`Wallet network mismatch: wallet is on ${walletNetwork}, playground is on ${selectedNetwork}`}
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
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-800/60">
            <div className="flex items-center gap-2 text-slate-400 text-xs font-semibold uppercase tracking-wider">
              <Server size={14} className="text-teal-400" />
              <span>RPC Networks</span>
            </div>
            <button
              onClick={(event) => {
                event.stopPropagation();
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
                  {walletNetwork}
                </strong>
                , but playground is targeting{" "}
                <strong className="uppercase font-mono text-amber-100">
                  {currentNet.name}
                </strong>
                . Deployed contract invocations and signatures may fail.
              </p>
              {walletNetwork && walletNetwork !== selectedNetwork && (
                <button
                  type="button"
                  onClick={() => handleSelectNetwork(walletNetwork)}
                  className="mt-1 text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 border border-amber-500/40 transition-colors w-full text-center"
                >
                  Switch Playground to {NETWORKS[walletNetwork].name}
                </button>
              )}
            </div>
          )}

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
