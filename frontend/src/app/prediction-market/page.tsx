"use client";

// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { useState, useCallback } from "react";
import PredictionMarketPanel, {
  MarketData,
} from "../../components/PredictionMarketPanel";

const CONTRACT_ID_RE = /^C[A-Z0-9]{55}$/;

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NEXT_PUBLIC_BACKEND_URL || "https://soroban-playground.onrender.com");

export default function PredictionMarketPage() {
  const [contractId, setContractId] = useState(
    process.env.NEXT_PUBLIC_PM_CONTRACT_ID?.trim() ?? ""
  );
  const [walletAddress, setWalletAddress] = useState("");
  const [inputContract, setInputContract] = useState(contractId);
  const [inputWallet, setInputWallet] = useState(walletAddress);
  const [contractError, setContractError] = useState("");
  const [markets, setMarkets] = useState<MarketData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  function applyConfig() {
    if (inputContract && !CONTRACT_ID_RE.test(inputContract)) {
      setContractError("Contract ID must start with C and be 56 characters.");
      return;
    }
    setContractError("");
    setContractId(inputContract);
    setWalletAddress(inputWallet);
  }

  const fetchMarkets = useCallback(async (cid: string) => {
    if (!cid) return;
    setIsLoading(true);
    setErrorMsg("");
    try {
      const res = await fetch(
        `${API_BASE}/api/prediction-market/markets?contractId=${encodeURIComponent(cid)}`
      );
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? "Failed to load markets");
      const raw: MarketData[] = (data.data.markets ?? []).map(
        (m: {
          id: number;
          question: string;
          market_type?: string;
          marketType?: string;
          status?: string;
          total_yes_stake?: number;
          totalYesStake?: number;
          total_no_stake?: number;
          totalNoStake?: number;
          winning_outcome?: number | null;
          winningOutcome?: number | null;
          resolution_deadline?: number;
          resolutionDeadline?: number;
        }) => ({
          id: m.id,
          question: m.question,
          marketType: m.market_type ?? m.marketType ?? "Binary",
          status: m.status ?? "Open",
          totalYesStake: m.total_yes_stake ?? m.totalYesStake ?? 0,
          totalNoStake: m.total_no_stake ?? m.totalNoStake ?? 0,
          winningOutcome:
            m.winning_outcome != null
              ? m.winning_outcome === 1
                ? "YES"
                : "NO"
              : m.winningOutcome,
          resolutionDeadline:
            m.resolution_deadline ?? m.resolutionDeadline ?? 0,
        })
      );
      setMarkets(raw);
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, []);

  async function handleCreateMarket(params: {
    question: string;
    marketType: number;
    deadline: number;
    oracle: string;
  }) {
    setIsLoading(true);
    setStatusMsg("");
    setErrorMsg("");
    try {
      const res = await fetch(`${API_BASE}/api/prediction-market/markets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractId,
          creator: walletAddress,
          question: params.question,
          marketType: params.marketType,
          resolutionDeadline: params.deadline,
          oracle: params.oracle,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? "Create failed");
      setStatusMsg(`Market created (ID: ${data.data})`);
      await fetchMarkets(contractId);
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "Create market failed");
    } finally {
      setIsLoading(false);
    }
  }

  async function handlePlaceBet(marketId: number, outcome: number, stake: number) {
    setIsLoading(true);
    setStatusMsg("");
    setErrorMsg("");
    try {
      const res = await fetch(
        `${API_BASE}/api/prediction-market/markets/${marketId}/bet`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contractId,
            trader: walletAddress,
            outcome,
            stake,
          }),
        }
      );
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? "Bet failed");
      setStatusMsg(`Bet placed: ${stake} XLM on ${outcome === 1 ? "YES" : "NO"}`);
      await fetchMarkets(contractId);
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "Place bet failed");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleResolveMarket(marketId: number, outcome: number) {
    setIsLoading(true);
    setStatusMsg("");
    setErrorMsg("");
    try {
      const res = await fetch(
        `${API_BASE}/api/prediction-market/markets/${marketId}/resolve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contractId, winningOutcome: outcome }),
        }
      );
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? "Resolve failed");
      setStatusMsg(`Market ${marketId} resolved: ${outcome === 1 ? "YES" : "NO"} wins`);
      await fetchMarkets(contractId);
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "Resolve market failed");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCancelMarket(marketId: number) {
    setIsLoading(true);
    setStatusMsg("");
    setErrorMsg("");
    try {
      const res = await fetch(
        `${API_BASE}/api/prediction-market/markets/${marketId}/cancel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contractId }),
        }
      );
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? "Cancel failed");
      setStatusMsg(`Market ${marketId} cancelled`);
      await fetchMarkets(contractId);
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "Cancel market failed");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCalculatePayout(marketId: number): Promise<number> {
    if (!walletAddress) return 0;
    try {
      const res = await fetch(
        `${API_BASE}/api/prediction-market/markets/${marketId}/payout/${encodeURIComponent(walletAddress)}?contractId=${encodeURIComponent(contractId)}`
      );
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data.data.payout ?? 0;
    } catch {
      return 0;
    }
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white p-4 md:p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Page header */}
        <header>
          <h1 className="text-2xl font-bold text-white">📈 Prediction Market</h1>
          <p className="text-sm text-gray-400 mt-1">
            Decentralized prediction markets on Stellar Soroban — buy YES/NO
            shares and resolve outcomes via on-chain Oracle.
          </p>
        </header>

        {/* Connection config card */}
        <section
          className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-3"
          aria-label="Connection settings"
        >
          <h2 className="text-sm font-semibold text-gray-200">Connection</h2>
          <div className="space-y-2">
            <div>
              <label
                htmlFor="pm-contract-id"
                className="block text-xs text-gray-400 mb-1"
              >
                Contract ID
              </label>
              <input
                id="pm-contract-id"
                value={inputContract}
                onChange={(e) => setInputContract(e.target.value)}
                placeholder="C…"
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500"
                aria-describedby={contractError ? "pm-contract-error" : undefined}
              />
              {contractError && (
                <p
                  id="pm-contract-error"
                  className="text-xs text-red-400 mt-1"
                  role="alert"
                >
                  {contractError}
                </p>
              )}
            </div>
            <div>
              <label
                htmlFor="pm-wallet"
                className="block text-xs text-gray-400 mb-1"
              >
                Wallet Address (needed to place bets / create markets)
              </label>
              <input
                id="pm-wallet"
                value={inputWallet}
                onChange={(e) => setInputWallet(e.target.value)}
                placeholder="G…"
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={applyConfig}
                className="flex-1 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium rounded transition-colors"
              >
                Connect
              </button>
              <button
                onClick={() => fetchMarkets(contractId || inputContract)}
                disabled={!contractId && !inputContract}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-white text-sm rounded transition-colors"
                aria-label="Refresh markets"
              >
                ↻
              </button>
            </div>
          </div>
        </section>

        {/* Status / error feedback */}
        {statusMsg && (
          <div
            role="status"
            className="text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-900/50 rounded-lg px-3 py-2"
          >
            ✓ {statusMsg}
          </div>
        )}
        {errorMsg && (
          <div
            role="alert"
            className="text-xs text-red-300 bg-red-950/40 border border-red-900/50 rounded-lg px-3 py-2"
          >
            ✗ {errorMsg}
          </div>
        )}

        {/* Main panel */}
        <PredictionMarketPanel
          contractId={contractId}
          walletAddress={walletAddress || undefined}
          markets={markets}
          isLoading={isLoading}
          onCreateMarket={handleCreateMarket}
          onPlaceBet={handlePlaceBet}
          onResolveMarket={handleResolveMarket}
          onCancelMarket={handleCancelMarket}
          onCalculatePayout={handleCalculatePayout}
        />
      </div>
    </main>
  );
}
