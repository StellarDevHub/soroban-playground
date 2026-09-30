"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { Activity, ChevronDown, RefreshCw, Server } from "lucide-react";

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

export interface NetworkHealth {
  status: "healthy" | "degraded" | "offline" | "checking";
  latencyMs: number | null;
  lastChecked: number | null;
  error?: string;
}

export default function NetworkSwitcher() {
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

  const checkNetworkLatency = useCallback(async (netId: NetworkId) => {
    const net = NETWORKS[netId];
    const start = performance.now();

    try {
      const controller = new AbortController();
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

      if (res.ok) {
        const data = await res.json();
        const isHealthy =
          data.result?.status === "healthy" || Boolean(data.result);
        const status = !isHealthy
          ? "offline"
          : latency < 300
            ? "healthy"
            : "degraded";

        setHealthMap((prev) => ({
          ...prev,
          [netId]: {
            status,
            latencyMs: latency,
            lastChecked: Date.now(),
            error: !isHealthy ? "Unhealthy response" : undefined,
          },
        }));
      } else {
        setHealthMap((prev) => ({
          ...prev,
          [netId]: {
            status: "offline",
            latencyMs: latency,
            lastChecked: Date.now(),
            error: `HTTP ${res.status}`,
          },
        }));
      }
    } catch (err) {
      let errorMessage = "Network Error";
      if (err instanceof Error) {
        if (err.name === "AbortError") {
          errorMessage = "Timeout";
        } else {
          errorMessage = err.message;
        }
      }
      setHealthMap((prev) => ({
        ...prev,
        [netId]: {
          status: "offline",
          latencyMs: null,
          lastChecked: Date.now(),
          error: errorMessage,
        },
      }));
    }
  }, []);

  const pingAllNetworks = useCallback(async () => {
    setIsRefreshing(true);
    await Promise.all(
      (Object.keys(NETWORKS) as NetworkId[]).map((id) =>
        checkNetworkLatency(id),
      ),
    );
    setIsRefreshing(false);
  }, [checkNetworkLatency]);

  useEffect(() => {
    pingAllNetworks();
    const interval = setInterval(pingAllNetworks, 15000);
    return () => clearInterval(interval);
  }, [pingAllNetworks]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("soroban_playground_network", selectedNetwork);
      window.dispatchEvent(new Event("soroban-network-change"));
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
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-slate-700/60 hover:border-slate-600 text-slate-200 text-xs font-medium transition-all shadow-sm group"
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
        <ChevronDown
          size={14}
          className={`text-slate-400 group-hover:text-slate-200 transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 rounded-2xl bg-slate-950 border border-slate-800 shadow-2xl backdrop-blur-xl z-50 p-2 space-y-1">
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800/60">
            <div className="flex items-center gap-2 text-slate-400 text-xs font-semibold uppercase tracking-wider">
              <Server size={14} className="text-teal-400" />
              <span>RPC Networks</span>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                pingAllNetworks();
              }}
              disabled={isRefreshing}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              title="Ping RPC Endpoints"
            >
              <RefreshCw
                size={12}
                className={isRefreshing ? "animate-spin text-teal-400" : ""}
              />
            </button>
          </div>

          <div className="space-y-1 py-1">
            {(Object.keys(NETWORKS) as NetworkId[]).map((id) => {
              const net = NETWORKS[id];
              const health = healthMap[id];
              const isSelected = id === selectedNetwork;

              return (
                <button
                  key={id}
                  onClick={() => {
                    setSelectedNetwork(id);
                    setIsOpen(false);
                  }}
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
                        className={`font-mono text-[10px] font-medium ${health.status === "degraded" ? "text-amber-400" : "text-teal-300"}`}
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
        </div>
      )}
    </div>
  );
}
