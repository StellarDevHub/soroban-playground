"use client";

import React, { useState } from "react";
import {
  BarChart2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Coins,
  TrendingUp,
  XCircle,
} from "lucide-react";

export type MarketOutcome = "YES" | "NO";

export interface MarketData {
  id: number;
  question: string;
  marketType: "Binary" | "Scalar";
  status: "Open" | "Resolved" | "Cancelled";
  totalYesStake: number;
  totalNoStake: number;
  winningOutcome?: MarketOutcome;
  resolutionDeadline: number; // unix timestamp
}

interface PredictionMarketPanelProps {
  contractId?: string;
  walletAddress?: string;
  onCreateMarket: (params: {
    question: string;
    marketType: number;
    deadline: number;
    oracle: string;
  }) => Promise<void>;
  onPlaceBet: (marketId: number, outcome: number, stake: number) => Promise<void>;
  onResolveMarket: (marketId: number, outcome: number) => Promise<void>;
  onCancelMarket: (marketId: number) => Promise<void>;
  onCalculatePayout: (marketId: number) => Promise<number>;
  markets: MarketData[];
  isLoading: boolean;
}

export default function PredictionMarketPanel({
  contractId,
  walletAddress,
  onCreateMarket,
  onPlaceBet,
  onResolveMarket,
  onCancelMarket,
  onCalculatePayout,
  markets,
  isLoading,
}: PredictionMarketPanelProps) {
  const [activeTab, setActiveTab] = useState<"markets" | "create">("markets");
  const [expandedMarket, setExpandedMarket] = useState<number | null>(null);

  // Create market form state
  const [question, setQuestion] = useState("");
  const [marketType, setMarketType] = useState<0 | 1>(0);
  const [deadlineHours, setDeadlineHours] = useState("24");
  const [oracle, setOracle] = useState("");

  // Bet form state
  const [betOutcome, setBetOutcome] = useState<Record<number, number>>({});
  const [betStake, setBetStake] = useState<Record<number, string>>({});

  // Payout state
  const [payouts, setPayouts] = useState<Record<number, number>>({});

  const handleCreateMarket = async () => {
    if (!question || !oracle) return;
    const deadline = Math.floor(Date.now() / 1000) + parseInt(deadlineHours) * 3600;
    await onCreateMarket({ question, marketType, deadline, oracle });
    setQuestion("");
    setOracle("");
  };

  const handlePlaceBet = async (marketId: number) => {
    const outcome = betOutcome[marketId] ?? 1;
    const stake = parseInt(betStake[marketId] ?? "0");
    if (stake <= 0) return;
    await onPlaceBet(marketId, outcome, stake);
    setBetStake((prev) => ({ ...prev, [marketId]: "" }));
  };

  const handleCalculatePayout = async (marketId: number) => {
    const payout = await onCalculatePayout(marketId);
    setPayouts((prev) => ({ ...prev, [marketId]: payout }));
  };

  const totalPool = (m: MarketData) => m.totalYesStake + m.totalNoStake;
  const yesPercent = (m: MarketData) => {
    const pool = totalPool(m);
    return pool === 0 ? 50 : Math.round((m.totalYesStake / pool) * 100);
  };

  if (!contractId) {
    return (
      <div className="flex flex-col space-y-3 p-5 bg-gray-900 border border-gray-800 rounded-xl shadow-lg">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-widest flex items-center">
          <BarChart2 size={16} className="mr-2 text-cyan-400" />
          Prediction Market
        </h3>
        <p className="text-xs text-gray-500 italic">
          Deploy the prediction market contract to start trading.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col space-y-4 p-5 bg-gray-900 border border-gray-800 rounded-xl shadow-lg">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-widest flex items-center">
          <BarChart2 size={16} className="mr-2 text-cyan-400" />
          Prediction Market
        </h3>
        {walletAddress && (
          <span className="text-xs text-gray-500 font-mono truncate max-w-[120px]">
            {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-800 pb-2">
        {(["markets", "create"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
              activeTab === tab
                ? "bg-cyan-600/20 text-cyan-300 border border-cyan-500/30"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {tab === "markets" ? "Markets" : "Create Market"}
          </button>
        ))}
      </div>

      {/* Markets Tab */}
      {activeTab === "markets" && (
        <div className="space-y-3">
          {markets.length === 0 ? (
            <p className="text-xs text-gray-500 italic text-center py-4">
              No markets yet. Create one to get started.
            </p>
          ) : (
            markets.map((market) => (
              <div
                key={market.id}
                className="border border-gray-800 rounded-lg overflow-hidden"
              >
                {/* Market header */}
                <button
                  onClick={() =>
                    setExpandedMarket(expandedMarket === market.id ? null : market.id)
                  }
                  className="w-full flex items-start justify-between p-3 text-left hover:bg-gray-800/50 transition-colors"
                >
                  <div className="flex-1 min-w-0 pr-2">
                    <p className="text-sm text-gray-200 font-medium truncate">
                      {market.question}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <StatusBadge status={market.status} />
                      <span className="text-xs text-gray-500">
                        {market.marketType} · Pool: {totalPool(market)} XLM
                      </span>
                    </div>
                  </div>
                  {expandedMarket === market.id ? (
                    <ChevronUp size={14} className="text-gray-500 shrink-0 mt-1" />
                  ) : (
                    <ChevronDown size={14} className="text-gray-500 shrink-0 mt-1" />
                  )}
                </button>

                {/* Expanded market details */}
                {expandedMarket === market.id && (
                  <div className="border-t border-gray-800 p-3 space-y-3 bg-gray-950/50">
                    {/* Probability bar */}
                    <div>
                      <div className="flex justify-between text-xs text-gray-400 mb-1">
                        <span>YES {yesPercent(market)}%</span>
                        <span>NO {100 - yesPercent(market)}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500 to-cyan-500 transition-all"
                          style={{ width: `${yesPercent(market)}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-xs text-gray-500 mt-1">
                        <span>{market.totalYesStake} XLM staked YES</span>
                        <span>{market.totalNoStake} XLM staked NO</span>
                      </div>
                    </div>

                    {/* Winning outcome */}
                    {market.status === "Resolved" && market.winningOutcome && (
                      <div className="flex items-center gap-2 text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-900/50 rounded-md p-2">
                        <CheckCircle2 size={12} />
                        Resolved: {market.winningOutcome} wins
                      </div>
                    )}

                    {/* Place bet (only for open markets) */}
                    {market.status === "Open" && walletAddress && (
                      <div className="space-y-2">
                        <p className="text-xs text-gray-400 font-medium">Place Bet</p>
                        <div className="flex gap-2">
                          <button
                            onClick={() =>
                              setBetOutcome((p) => ({ ...p, [market.id]: 1 }))
                            }
                            className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
                              (betOutcome[market.id] ?? 1) === 1
                                ? "bg-emerald-600 text-white"
                                : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                            }`}
                          >
                            YES
                          </button>
                          <button
                            onClick={() =>
                              setBetOutcome((p) => ({ ...p, [market.id]: 0 }))
                            }
                            className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
                              (betOutcome[market.id] ?? 1) === 0
                                ? "bg-rose-600 text-white"
                                : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                            }`}
                          >
                            NO
                          </button>
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            min="1"
                            value={betStake[market.id] ?? ""}
                            onChange={(e) =>
                              setBetStake((p) => ({ ...p, [market.id]: e.target.value }))
                            }
                            placeholder="Stake (XLM)"
                            className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-cyan-500"
                          />
                          <button
                            onClick={() => handlePlaceBet(market.id)}
                            disabled={isLoading || !betStake[market.id]}
                            className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-800 disabled:text-gray-600 text-white text-xs rounded font-medium transition-colors flex items-center gap-1"
                          >
                            <Coins size={12} />
                            Bet
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Payout calculator */}
                    {market.status === "Resolved" && walletAddress && (
                      <div className="space-y-2">
                        <button
                          onClick={() => handleCalculatePayout(market.id)}
                          disabled={isLoading}
                          className="w-full py-1.5 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/30 text-amber-300 text-xs rounded font-medium transition-colors flex items-center justify-center gap-1"
                        >
                          <TrendingUp size={12} />
                          Calculate My Payout
                        </button>
                        {payouts[market.id] !== undefined && (
                          <p className="text-xs text-center text-emerald-300">
                            Payout: {payouts[market.id]} XLM
                          </p>
                        )}
                      </div>
                    )}

                    {/* Admin actions */}
                    {market.status === "Open" && (
                      <div className="flex gap-2 pt-1 border-t border-gray-800">
                        <button
                          onClick={() => onResolveMarket(market.id, 1)}
                          disabled={isLoading}
                          className="flex-1 py-1.5 bg-emerald-900/30 hover:bg-emerald-900/50 border border-emerald-800/50 text-emerald-400 text-xs rounded transition-colors"
                        >
                          Resolve YES
                        </button>
                        <button
                          onClick={() => onResolveMarket(market.id, 0)}
                          disabled={isLoading}
                          className="flex-1 py-1.5 bg-rose-900/30 hover:bg-rose-900/50 border border-rose-800/50 text-rose-400 text-xs rounded transition-colors"
                        >
                          Resolve NO
                        </button>
                        <button
                          onClick={() => onCancelMarket(market.id)}
                          disabled={isLoading}
                          className="px-2 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs rounded transition-colors"
                        >
                          <XCircle size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Create Market Tab */}
      {activeTab === "create" && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Question</label>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Will BTC exceed $100k by end of 2025?"
              rows={2}
              className="w-full bg-gray-950 border border-gray-800 rounded-md py-2 px-3 text-sm text-gray-200 focus:outline-none focus:border-cyan-500 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Market Type</label>
            <div className="flex gap-2">
              {([0, 1] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setMarketType(t)}
                  className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
                    marketType === t
                      ? "bg-cyan-600/20 text-cyan-300 border border-cyan-500/30"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  }`}
                >
                  {t === 0 ? "Binary (YES/NO)" : "Scalar (Range)"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Resolution Deadline (hours from now)
            </label>
            <input
              type="number"
              min="1"
              value={deadlineHours}
              onChange={(e) => setDeadlineHours(e.target.value)}
              className="w-full bg-gray-950 border border-gray-800 rounded-md py-2 px-3 text-sm text-gray-200 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Oracle Address</label>
            <input
              type="text"
              value={oracle}
              onChange={(e) => setOracle(e.target.value)}
              placeholder="G..."
              className="w-full bg-gray-950 border border-gray-800 rounded-md py-2 px-3 text-sm text-gray-200 font-mono focus:outline-none focus:border-cyan-500"
            />
          </div>

          <button
            onClick={handleCreateMarket}
            disabled={isLoading || !question || !oracle}
            className="w-full flex items-center justify-center py-2.5 rounded-lg text-sm font-medium transition-all bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-800 disabled:text-gray-600 text-white"
          >
            {isLoading ? (
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-b-transparent border-white mr-2" />
            ) : (
              <Clock size={16} className="mr-2" />
            )}
            Create Market
          </button>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: MarketData["status"] }) {
  const styles = {
    Open: "bg-emerald-900/40 text-emerald-300 border-emerald-800/50",
    Resolved: "bg-blue-900/40 text-blue-300 border-blue-800/50",
    Cancelled: "bg-gray-800 text-gray-400 border-gray-700",
  };
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${styles[status]}`}
    >
      {status}
    </span>
  );
}
