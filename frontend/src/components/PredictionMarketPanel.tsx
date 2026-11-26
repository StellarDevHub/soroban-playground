"use client";

// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import React, { useMemo, useState } from "react";
import {
  ArrowRight,
  BarChart2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Coins,
  Sliders,
  TrendingUp,
  XCircle,
} from "lucide-react";
import {
  DEFAULT_TAKEOUT_FEE_RATE,
  calculateBinaryParimutuelOdds,
  formatDecimalOdds,
  simulateBinaryBet,
} from "../lib/predictionMarketMath";

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

export interface PredictionMarketPanelProps {
  contractId?: string;
  walletAddress?: string;
  onCreateMarket: (params: {
    question: string;
    marketType: number;
    deadline: number;
    oracle: string;
  }) => Promise<void>;
  onPlaceBet: (
    marketId: number,
    outcome: number,
    stake: number,
  ) => Promise<void>;
  onResolveMarket: (marketId: number, outcome: number) => Promise<void>;
  onCancelMarket: (marketId: number) => Promise<void>;
  onCalculatePayout: (marketId: number) => Promise<number>;
  markets: MarketData[];
  isLoading: boolean;
  takeoutFeeRate?: number;
  onTakeoutFeeRateChange?: (rate: number) => void;
}

const FEE_OPTIONS = [0, 0.01, 0.02, 0.03, 0.05];
const STAKE_PRESETS = [10, 25, 50, 100, 250, 500];

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
  takeoutFeeRate,
  onTakeoutFeeRateChange,
}: PredictionMarketPanelProps) {
  const [activeTab, setActiveTab] = useState<"markets" | "create">("markets");
  const [expandedMarket, setExpandedMarket] = useState<number | null>(null);
  const [internalFeeRate, setInternalFeeRate] = useState(
    takeoutFeeRate ?? DEFAULT_TAKEOUT_FEE_RATE,
  );

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

  const feeRate = onTakeoutFeeRateChange
    ? (takeoutFeeRate ?? DEFAULT_TAKEOUT_FEE_RATE)
    : internalFeeRate;

  const handleFeeRateChange = (rate: number) => {
    setInternalFeeRate(rate);
    onTakeoutFeeRateChange?.(rate);
  };

  const handleCreateMarket = async () => {
    if (!question || !oracle) return;
    const deadline =
      Math.floor(Date.now() / 1000) + parseInt(deadlineHours, 10) * 3600;
    await onCreateMarket({ question, marketType, deadline, oracle });
    setQuestion("");
    setOracle("");
  };

  const handlePlaceBet = async (marketId: number) => {
    const outcome = betOutcome[marketId] ?? 1;
    const stake = parseInt(betStake[marketId] ?? "0", 10);
    if (!Number.isFinite(stake) || stake <= 0) return;
    await onPlaceBet(marketId, outcome, stake);
    setBetStake((prev) => ({ ...prev, [marketId]: "" }));
  };

  const handleCalculatePayout = async (marketId: number) => {
    const payout = await onCalculatePayout(marketId);
    setPayouts((prev) => ({ ...prev, [marketId]: payout }));
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

      {/* Tabs and protocol fee selector */}
      <div className="flex items-center justify-between border-b border-gray-800 pb-2">
        <div className="flex gap-2">
          {(["markets", "create"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
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
        <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
          <span>Fee:</span>
          <select
            value={feeRate}
            onChange={(e) => handleFeeRateChange(parseFloat(e.target.value))}
            className="bg-gray-800 border border-gray-700 text-gray-300 rounded px-1.5 py-0.5 text-[11px] focus:outline-none focus:border-cyan-500"
            aria-label="Protocol takeout fee rate"
          >
            {FEE_OPTIONS.map((rate) => (
              <option key={rate} value={rate}>
                {(rate * 100).toFixed(0)}%
              </option>
            ))}
          </select>
        </div>
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
              <MarketCard
                key={market.id}
                market={market}
                isExpanded={expandedMarket === market.id}
                onToggleExpand={() =>
                  setExpandedMarket(
                    expandedMarket === market.id ? null : market.id,
                  )
                }
                walletAddress={walletAddress}
                isLoading={isLoading}
                takeoutFeeRate={feeRate}
                betOutcome={betOutcome[market.id] ?? 1}
                betStake={betStake[market.id] ?? ""}
                payout={payouts[market.id]}
                onSetBetOutcome={(value) =>
                  setBetOutcome((prev) => ({ ...prev, [market.id]: value }))
                }
                onSetBetStake={(value) =>
                  setBetStake((prev) => ({ ...prev, [market.id]: value }))
                }
                onPlaceBet={() => handlePlaceBet(market.id)}
                onCalculatePayout={() => handleCalculatePayout(market.id)}
                onResolveMarket={(outcome) =>
                  onResolveMarket(market.id, outcome)
                }
                onCancelMarket={() => onCancelMarket(market.id)}
              />
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
            <label className="block text-xs text-gray-400 mb-1">
              Market Type
            </label>
            <div className="flex gap-2">
              {([0, 1] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setMarketType(type)}
                  className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
                    marketType === type
                      ? "bg-cyan-600/20 text-cyan-300 border border-cyan-500/30"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  }`}
                >
                  {type === 0 ? "Binary (YES/NO)" : "Scalar (Range)"}
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
            <label className="block text-xs text-gray-400 mb-1">
              Oracle Address
            </label>
            <input
              type="text"
              value={oracle}
              onChange={(e) => setOracle(e.target.value)}
              placeholder="G..."
              className="w-full bg-gray-950 border border-gray-800 rounded-md py-2 px-3 text-sm text-gray-200 font-mono focus:outline-none focus:border-cyan-500"
            />
          </div>

          <button
            type="button"
            onClick={handleCreateMarket}
            disabled={isLoading || !question || !oracle}
            aria-label="Submit create market"
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

interface MarketCardProps {
  market: MarketData;
  isExpanded: boolean;
  onToggleExpand: () => void;
  walletAddress?: string;
  isLoading: boolean;
  takeoutFeeRate: number;
  betOutcome: number;
  betStake: string;
  payout?: number;
  onSetBetOutcome: (value: number) => void;
  onSetBetStake: (value: string) => void;
  onPlaceBet: () => Promise<void>;
  onCalculatePayout: () => Promise<void>;
  onResolveMarket: (outcome: number) => Promise<void>;
  onCancelMarket: () => Promise<void>;
}

function MarketCard({
  market,
  isExpanded,
  onToggleExpand,
  walletAddress,
  isLoading,
  takeoutFeeRate,
  betOutcome,
  betStake,
  payout,
  onSetBetOutcome,
  onSetBetStake,
  onPlaceBet,
  onCalculatePayout,
  onResolveMarket,
  onCancelMarket,
}: MarketCardProps) {
  const odds = useMemo(
    () =>
      calculateBinaryParimutuelOdds(
        market.totalYesStake,
        market.totalNoStake,
        takeoutFeeRate,
      ),
    [market.totalYesStake, market.totalNoStake, takeoutFeeRate],
  );

  const parsedStake = parseInt(betStake || "0", 10);
  const currentStake =
    Number.isFinite(parsedStake) && parsedStake > 0 ? parsedStake : 0;
  const sliderMax = Math.max(500, Math.round(odds.totalPool * 1.5) || 500);

  const simulation = useMemo(() => {
    if (currentStake <= 0) return null;
    return simulateBinaryBet(
      market.totalYesStake,
      market.totalNoStake,
      betOutcome === 1 ? 1 : 0,
      currentStake,
      takeoutFeeRate,
    );
  }, [
    market.totalYesStake,
    market.totalNoStake,
    betOutcome,
    currentStake,
    takeoutFeeRate,
  ]);

  return (
    <div className="border border-gray-800 rounded-lg overflow-hidden bg-gray-900/40">
      {/* Market header */}
      <button
        type="button"
        onClick={onToggleExpand}
        className="w-full flex items-start justify-between p-3 text-left hover:bg-gray-800/50 transition-colors"
        aria-expanded={isExpanded}
      >
        <div className="flex-1 min-w-0 pr-2">
          <p className="text-sm text-gray-200 font-medium truncate">
            {market.question}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <StatusBadge status={market.status} />
            <span className="text-xs text-gray-500 font-mono">
              Pool: {odds.totalPool} XLM · YES{" "}
              {odds.yes.impliedProbabilityPercent.toFixed(0)}% / NO{" "}
              {odds.no.impliedProbabilityPercent.toFixed(0)}%
            </span>
          </div>
        </div>
        {isExpanded ? (
          <ChevronUp size={14} className="text-gray-500 shrink-0 mt-1" />
        ) : (
          <ChevronDown size={14} className="text-gray-500 shrink-0 mt-1" />
        )}
      </button>

      {/* Expanded market details */}
      {isExpanded && (
        <div className="border-t border-gray-800 p-4 space-y-4 bg-gray-950/60">
          {/* Live implied probability bars and odds */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center text-xs">
              <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
                <span className="font-semibold">YES</span>
                <span>{odds.yes.impliedProbabilityPercent.toFixed(1)}%</span>
                <span className="text-[11px] text-emerald-500/80 font-mono">
                  ({formatDecimalOdds(odds.yes.decimalOdds)} ·{" "}
                  {odds.yes.americanOdds})
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-rose-400 font-medium">
                <span className="text-[11px] text-rose-500/80 font-mono">
                  ({formatDecimalOdds(odds.no.decimalOdds)} ·{" "}
                  {odds.no.americanOdds})
                </span>
                <span>{odds.no.impliedProbabilityPercent.toFixed(1)}%</span>
                <span className="font-semibold">NO</span>
              </div>
            </div>

            <div
              className="h-2.5 rounded-full bg-gray-800 overflow-hidden flex"
              role="progressbar"
              aria-label="Implied probability distribution"
              aria-valuenow={Math.round(odds.yes.impliedProbabilityPercent)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full bg-gradient-to-r from-emerald-600 to-teal-400 transition-all duration-300"
                style={{ width: `${odds.yes.impliedProbabilityPercent}%` }}
              />
              <div
                className="h-full bg-gradient-to-r from-pink-500 to-rose-600 transition-all duration-300"
                style={{ width: `${odds.no.impliedProbabilityPercent}%` }}
              />
            </div>

            <div className="flex justify-between text-[11px] text-gray-500 mt-1 font-mono">
              <span>{market.totalYesStake.toLocaleString()} XLM staked</span>
              <span className="text-[10px] text-gray-600">
                Net: {odds.netPool} XLM · Fee:{" "}
                {(takeoutFeeRate * 100).toFixed(0)}%
              </span>
              <span>{market.totalNoStake.toLocaleString()} XLM staked</span>
            </div>
          </div>

          {market.status === "Resolved" && market.winningOutcome && (
            <div className="flex items-center gap-2 text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-900/50 rounded-md p-2.5">
              <CheckCircle2 size={13} />
              <span>Resolved Outcome: {market.winningOutcome} wins</span>
            </div>
          )}

          {/* Interactive bet sizing and slippage slider */}
          {market.status === "Open" && walletAddress && (
            <div className="space-y-3 bg-gray-900/70 border border-gray-800/80 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-300 font-semibold flex items-center gap-1.5">
                  <Sliders size={13} className="text-cyan-400" />
                  Parimutuel Odds &amp; Bet Slider
                </p>
                <span className="text-[10px] text-gray-400 font-mono">
                  Takeout Fee: {(takeoutFeeRate * 100).toFixed(0)}%
                </span>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onSetBetOutcome(1)}
                  aria-label="Select YES outcome"
                  className={`flex-1 py-1.5 rounded text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${
                    betOutcome === 1
                      ? "bg-emerald-600 text-white shadow-sm shadow-emerald-900/40"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  }`}
                >
                  <span>YES</span>
                  <span className="text-[10px] opacity-80 font-mono">
                    {formatDecimalOdds(odds.yes.decimalOdds)}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onSetBetOutcome(0)}
                  aria-label="Select NO outcome"
                  className={`flex-1 py-1.5 rounded text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${
                    betOutcome === 0
                      ? "bg-rose-600 text-white shadow-sm shadow-rose-900/40"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  }`}
                >
                  <span>NO</span>
                  <span className="text-[10px] opacity-80 font-mono">
                    {formatDecimalOdds(odds.no.decimalOdds)}
                  </span>
                </button>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <label
                    htmlFor={`bet-slider-${market.id}`}
                    className="text-gray-400 font-medium"
                  >
                    Bet Size (XLM)
                  </label>
                  <div className="flex items-center gap-1">
                    <input
                      id={`bet-input-${market.id}`}
                      type="number"
                      min="1"
                      max={sliderMax}
                      value={betStake}
                      onChange={(e) => onSetBetStake(e.target.value)}
                      placeholder="0"
                      className="w-24 bg-gray-950 border border-gray-700 rounded px-2 py-1 text-xs text-right text-cyan-300 font-mono font-medium focus:outline-none focus:border-cyan-500"
                      aria-label="Stake in XLM"
                    />
                    <span className="text-xs text-gray-500 font-mono">XLM</span>
                  </div>
                </div>

                <input
                  id={`bet-slider-${market.id}`}
                  type="range"
                  min="1"
                  max={sliderMax}
                  step="1"
                  value={currentStake || 1}
                  onChange={(e) => onSetBetStake(e.target.value)}
                  aria-label="Bet size slider"
                  aria-valuemin={1}
                  aria-valuemax={sliderMax}
                  aria-valuenow={currentStake}
                  className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500 focus:outline-none"
                />

                <div className="flex gap-1.5 flex-wrap">
                  {STAKE_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => onSetBetStake(String(preset))}
                      className={`px-2 py-0.5 rounded text-[11px] font-mono border transition-colors ${
                        currentStake === preset
                          ? "bg-cyan-950/80 border-cyan-500 text-cyan-300"
                          : "bg-gray-800/60 border-gray-700 text-gray-400 hover:bg-gray-800 hover:text-gray-200"
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                  {currentStake > 0 && (
                    <button
                      type="button"
                      onClick={() => onSetBetStake("")}
                      className="px-2 py-0.5 rounded text-[11px] border border-gray-700/60 text-gray-500 hover:text-gray-300 transition-colors"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {simulation && currentStake > 0 && (
                <div className="bg-gray-950/80 border border-gray-800 rounded-lg p-2.5 space-y-2 text-xs">
                  <div className="flex items-center justify-between border-b border-gray-800/80 pb-1.5">
                    <span className="text-gray-400 font-medium flex items-center gap-1">
                      <TrendingUp size={12} className="text-cyan-400" />
                      Projected Return
                    </span>
                    <div className="text-right">
                      <span className="text-sm font-semibold text-emerald-300 font-mono">
                        {simulation.expectedPayout.toFixed(2)} XLM
                      </span>
                      <span className="text-[10px] text-gray-400 block font-mono">
                        {simulation.expectedProfit >= 0 ? "+" : ""}
                        {simulation.expectedProfit.toFixed(2)} XLM (
                        {simulation.roiPercent >= 0 ? "+" : ""}
                        {simulation.roiPercent.toFixed(1)}% ROI)
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <span className="text-gray-500 block">
                        Effective Odds:
                      </span>
                      <span className="text-gray-200 font-mono font-medium">
                        {formatDecimalOdds(simulation.effectiveDecimalOdds)}
                        <span className="text-gray-400 text-[10px] ml-1">
                          ({simulation.effectiveAmericanOdds})
                        </span>
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500 block">
                        Price Slippage:
                      </span>
                      <span
                        className={`font-mono font-medium ${
                          simulation.oddsSlippagePercent > 10
                            ? "text-rose-400"
                            : simulation.oddsSlippagePercent > 3
                              ? "text-amber-400"
                              : "text-emerald-400"
                        }`}
                      >
                        {simulation.oddsSlippagePercent.toFixed(1)}%
                        {simulation.oddsSlippagePercent > 10 && (
                          <span className="text-[10px] ml-1 text-rose-500 font-sans">
                            (High)
                          </span>
                        )}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500 block">
                        Probability Shift:
                      </span>
                      <span className="text-cyan-300 font-mono flex items-center gap-1">
                        <span>
                          {simulation.preBetProbabilityPercent.toFixed(1)}%
                        </span>
                        <ArrowRight size={10} className="text-gray-500" />
                        <span>
                          {simulation.postBetProbabilityPercent.toFixed(1)}%
                        </span>
                        <span className="text-[10px] text-cyan-400 font-sans">
                          ({simulation.probabilityShiftPercent >= 0 ? "+" : ""}
                          {simulation.probabilityShiftPercent.toFixed(1)}%)
                        </span>
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500 block">
                        Protocol Fee Deducted:
                      </span>
                      <span className="text-gray-400 font-mono">
                        {simulation.takeoutFeeDeduction.toFixed(2)} XLM
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={onPlaceBet}
                disabled={isLoading || !betStake || currentStake <= 0}
                className="w-full py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-800 disabled:text-gray-600 text-white text-xs rounded-lg font-medium transition-colors flex items-center justify-center gap-1.5 shadow-sm"
              >
                <Coins size={13} />
                <span>
                  Place {currentStake > 0 ? `${currentStake} XLM ` : ""}Bet on{" "}
                  {betOutcome === 1 ? "YES" : "NO"}
                </span>
              </button>
            </div>
          )}

          {/* Payout calculator */}
          {market.status === "Resolved" && walletAddress && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={onCalculatePayout}
                disabled={isLoading}
                className="w-full py-1.5 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/30 text-amber-300 text-xs rounded font-medium transition-colors flex items-center justify-center gap-1"
              >
                <TrendingUp size={12} />
                Calculate My Payout
              </button>
              {payout !== undefined && (
                <p className="text-xs text-center text-emerald-300 font-mono">
                  Payout: {payout} XLM
                </p>
              )}
            </div>
          )}

          {/* Admin actions */}
          {market.status === "Open" && (
            <div className="flex gap-2 pt-1 border-t border-gray-800">
              <button
                type="button"
                onClick={() => onResolveMarket(1)}
                disabled={isLoading}
                className="flex-1 py-1.5 bg-emerald-900/30 hover:bg-emerald-900/50 border border-emerald-800/50 text-emerald-400 text-xs rounded transition-colors"
              >
                Resolve YES
              </button>
              <button
                type="button"
                onClick={() => onResolveMarket(0)}
                disabled={isLoading}
                className="flex-1 py-1.5 bg-rose-900/30 hover:bg-rose-900/50 border border-rose-800/50 text-rose-400 text-xs rounded transition-colors"
              >
                Resolve NO
              </button>
              <button
                type="button"
                onClick={onCancelMarket}
                disabled={isLoading}
                className="px-2 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs rounded transition-colors"
                aria-label="Cancel market"
              >
                <XCircle size={12} />
              </button>
            </div>
          )}
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
