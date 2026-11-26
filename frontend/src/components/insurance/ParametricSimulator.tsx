// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * @file ParametricSimulator.tsx
 * Interactive parametric crop insurance claim simulator with drought/flood
 * threshold sliders, SPI drought analysis, and simulated Soroban contract payout execution.
 */

"use client";

import React, { useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CloudLightning,
  CloudRain,
  CloudSun,
  Coins,
  ExternalLink,
  Flame,
  Gauge,
  HelpCircle,
  Play,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sun,
  Waves,
  Zap,
} from "lucide-react";
import type {
  AgriculturalParcel,
  ParametricTriggerEvaluation,
  SimulatedPayoutReceipt,
} from "../../types/insurance";
import {
  calculateSpi,
  evaluateParametricTrigger,
  simulateSorobanPayoutExecution,
  WEATHER_PRESETS,
} from "../../lib/insurance/parametricEngine";

interface ParametricSimulatorProps {
  selectedParcel: AgriculturalParcel;
  simulatedRainfallMm: number;
  droughtThresholdMm: number;
  floodThresholdMm: number;
  onSimulatedRainfallChange: (rainfallMm: number) => void;
  onDroughtThresholdChange: (thresholdMm: number) => void;
  onFloodThresholdChange: (thresholdMm: number) => void;
}

export default function ParametricSimulator({
  selectedParcel,
  simulatedRainfallMm,
  droughtThresholdMm,
  floodThresholdMm,
  onSimulatedRainfallChange,
  onDroughtThresholdChange,
  onFloodThresholdChange,
}: ParametricSimulatorProps) {
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionReceipt, setExecutionReceipt] =
    useState<SimulatedPayoutReceipt | null>(null);

  // Live trigger evaluation
  const evaluation: ParametricTriggerEvaluation = evaluateParametricTrigger(
    selectedParcel,
    simulatedRainfallMm,
    droughtThresholdMm,
    floodThresholdMm,
  );

  // Standardized Precipitation Index (SPI)
  const spi = calculateSpi(simulatedRainfallMm, selectedParcel.baselineRainfallMm);

  const handleExecutePayout = () => {
    setIsExecuting(true);
    setExecutionReceipt(null);
    setTimeout(() => {
      const receipt = simulateSorobanPayoutExecution(evaluation);
      setExecutionReceipt(receipt);
      setIsExecuting(false);
    }, 450);
  };

  return (
    <div
      className="space-y-6"
      data-testid="parametric-simulator-container"
    >
      {/* Simulation Controls Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
              <Gauge className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                Parametric Trigger Simulator
              </h3>
              <p className="text-xs text-slate-400">
                Adjust drought/precipitation sliders to test automated smart contract payouts
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              onSimulatedRainfallChange(selectedParcel.currentRainfallMm);
              onDroughtThresholdChange(selectedParcel.droughtThresholdMm);
              onFloodThresholdChange(selectedParcel.floodThresholdMm);
              setExecutionReceipt(null);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 transition-colors"
            data-testid="reset-simulator-button"
            title="Reset to parcel defaults"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Defaults
          </button>
        </div>

        {/* Quick Weather Scenarios */}
        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
            Weather Scenario Presets
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {WEATHER_PRESETS.map((preset) => {
              const isSelected = simulatedRainfallMm === preset.rainfallMm;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => onSimulatedRainfallChange(preset.rainfallMm)}
                  className={`flex flex-col items-center justify-center p-2.5 rounded-xl border text-xs text-center transition-all ${
                    isSelected
                      ? "bg-sky-500/20 border-sky-500 text-white shadow-md shadow-sky-500/10"
                      : "bg-slate-950/60 border-slate-800 text-slate-300 hover:bg-slate-800/80 hover:border-slate-700"
                  }`}
                  data-testid={`preset-${preset.id}`}
                >
                  <div className="mb-1 text-slate-400">
                    {preset.id === "severe-drought" && <Sun className="w-4 h-4 text-rose-400" />}
                    {preset.id === "moderate-dry" && <CloudSun className="w-4 h-4 text-amber-400" />}
                    {preset.id === "seasonal-normal" && <CloudRain className="w-4 h-4 text-emerald-400" />}
                    {preset.id === "heavy-monsoon" && <CloudLightning className="w-4 h-4 text-sky-400" />}
                    {preset.id === "flash-flood" && <Waves className="w-4 h-4 text-indigo-400" />}
                  </div>
                  <span className="font-medium">{preset.label}</span>
                  <span className="text-[10px] text-slate-400 font-mono mt-0.5">
                    {preset.rainfallMm} mm
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Sliders Grid */}
        <div className="space-y-5 pt-2">
          {/* Slider 1: Drought Threshold */}
          <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <label
                htmlFor="drought-threshold-slider"
                className="text-xs font-semibold text-amber-400 flex items-center gap-1.5"
              >
                <Flame className="w-3.5 h-3.5 text-amber-400" />
                Drought Payout Threshold (mm)
              </label>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold font-mono text-amber-400">
                  {droughtThresholdMm} mm
                </span>
                <span className="text-[11px] text-slate-500">
                  (Below triggers claim)
                </span>
              </div>
            </div>
            <input
              id="drought-threshold-slider"
              type="range"
              min="30"
              max="260"
              step="5"
              value={droughtThresholdMm}
              onChange={(e) => onDroughtThresholdChange(parseInt(e.target.value, 10))}
              className="w-full accent-amber-500 h-2 bg-slate-800 rounded-lg cursor-pointer"
              data-testid="drought-threshold-slider"
            />
            <div className="flex justify-between text-[10px] text-slate-500 font-mono">
              <span>30 mm (Extreme Drought)</span>
              <span>140 mm (Baseline)</span>
              <span>260 mm (High Deficit Threshold)</span>
            </div>
          </div>

          {/* Slider 2: Simulated Recorded Rainfall */}
          <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <label
                htmlFor="simulated-rainfall-slider"
                className="text-xs font-semibold text-sky-400 flex items-center gap-1.5"
              >
                <CloudRain className="w-3.5 h-3.5 text-sky-400" />
                Simulated Oracle Rainfall Telemetry (mm)
              </label>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold font-mono text-sky-400">
                  {simulatedRainfallMm} mm
                </span>
                <span className="text-[11px] text-slate-500">
                  (Seasonal Baseline: {selectedParcel.baselineRainfallMm} mm)
                </span>
              </div>
            </div>
            <input
              id="simulated-rainfall-slider"
              type="range"
              min="0"
              max="900"
              step="5"
              value={simulatedRainfallMm}
              onChange={(e) => onSimulatedRainfallChange(parseInt(e.target.value, 10))}
              className="w-full accent-sky-500 h-2 bg-slate-800 rounded-lg cursor-pointer"
              data-testid="simulated-rainfall-slider"
            />
            <div className="flex justify-between text-[10px] text-slate-500 font-mono">
              <span>0 mm (Total Aridity)</span>
              <span>380 mm (Seasonal Norm)</span>
              <span>900 mm (Monsoon Flood)</span>
            </div>
          </div>

          {/* Slider 3: Flood Threshold */}
          <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <label
                htmlFor="flood-threshold-slider"
                className="text-xs font-semibold text-indigo-400 flex items-center gap-1.5"
              >
                <Waves className="w-3.5 h-3.5 text-indigo-400" />
                Flood Catastrophe Threshold (mm)
              </label>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold font-mono text-indigo-400">
                  {floodThresholdMm} mm
                </span>
                <span className="text-[11px] text-slate-500">
                  (Above triggers flood claim)
                </span>
              </div>
            </div>
            <input
              id="flood-threshold-slider"
              type="range"
              min="500"
              max="950"
              step="10"
              value={floodThresholdMm}
              onChange={(e) => onFloodThresholdChange(parseInt(e.target.value, 10))}
              className="w-full accent-indigo-500 h-2 bg-slate-800 rounded-lg cursor-pointer"
              data-testid="flood-threshold-slider"
            />
            <div className="flex justify-between text-[10px] text-slate-500 font-mono">
              <span>500 mm</span>
              <span>650 mm (Default Flood Limit)</span>
              <span>950 mm</span>
            </div>
          </div>
        </div>
      </div>

      {/* Live Trigger Status Banner */}
      <div
        className={`p-5 rounded-2xl border transition-all duration-300 shadow-xl ${
          evaluation.triggerType === "DROUGHT"
            ? "bg-rose-950/60 border-rose-600 text-rose-100"
            : evaluation.triggerType === "FLOOD"
            ? "bg-indigo-950/60 border-indigo-600 text-indigo-100"
            : "bg-emerald-950/40 border-emerald-700/60 text-emerald-100"
        }`}
        data-testid="trigger-status-banner"
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-slate-950/50 border border-current mt-0.5">
              {evaluation.triggerType === "DROUGHT" ? (
                <ShieldAlert className="w-6 h-6 text-rose-400 animate-pulse" />
              ) : evaluation.triggerType === "FLOOD" ? (
                <Waves className="w-6 h-6 text-indigo-400 animate-pulse" />
              ) : (
                <ShieldCheck className="w-6 h-6 text-emerald-400" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-950/60 border border-current">
                  {evaluation.triggerType === "DROUGHT"
                    ? "PARAMETRIC TRIGGER: DROUGHT"
                    : evaluation.triggerType === "FLOOD"
                    ? "PARAMETRIC TRIGGER: FLOOD"
                    : "POLICY STATUS: NORMAL"}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded border ${spi.colorClass}`}>
                  SPI: {spi.spiValue.toFixed(2)} ({spi.category})
                </span>
              </div>
              <h4 className="text-lg font-bold mt-1 text-white">
                {evaluation.statusMessage}
              </h4>
              <p className="text-xs opacity-80 mt-0.5">
                {evaluation.isTriggered
                  ? "Tamper-resistant satellite oracle telemetry confirms trigger conditions met. Ready for on-chain Soroban execution."
                  : "Recorded precipitation falls within safe agricultural limits. No indemnity required."}
              </p>
            </div>
          </div>

          {/* Live Payout Amount Preview */}
          <div className="sm:text-right bg-slate-950/70 p-3 rounded-xl border border-slate-800 min-w-[200px]">
            <span className="text-[11px] text-slate-400 uppercase tracking-wider block">
              Simulated Payout
            </span>
            <span
              className={`text-2xl font-black font-mono ${
                evaluation.isTriggered ? "text-amber-400" : "text-slate-400"
              }`}
              data-testid="payout-amount-display"
            >
              ${evaluation.payoutAmount.toLocaleString()}{" "}
              <span className="text-xs font-normal text-slate-400">USDC</span>
            </span>
            <span className="text-[11px] text-slate-400 block mt-0.5">
              Indemnity Rate: {evaluation.payoutPercentage}% of insured sum
            </span>
          </div>
        </div>

        {/* Action Button: Execute On-Chain Payout */}
        {evaluation.isTriggered && (
          <div className="mt-4 pt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-slate-300">
              Contract Method: <code className="font-mono text-sky-300">trigger_payout({evaluation.policyId})</code>
            </div>
            <button
              type="button"
              onClick={handleExecutePayout}
              disabled={isExecuting}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm bg-gradient-to-r from-amber-500 to-rose-600 hover:from-amber-400 hover:to-rose-500 text-white shadow-lg shadow-amber-500/20 active:scale-98 transition-all disabled:opacity-60"
              data-testid="execute-payout-button"
            >
              {isExecuting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Submitting to Soroban...</span>
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  <span>Execute Soroban Payout ({evaluation.payoutAmount.toLocaleString()} USDC)</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* On-Chain Execution Confirmation Receipt */}
      {executionReceipt && (
        <div
          className="p-5 rounded-2xl bg-emerald-950/40 border border-emerald-600 text-white shadow-2xl animate-in fade-in space-y-3"
          data-testid="payout-execution-receipt"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <h4 className="text-sm font-bold text-white">
                Parametric Claim Executed on Stellar Soroban
              </h4>
            </div>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              LEDGER #{executionReceipt.ledgerSequence}
            </span>
          </div>

          <p className="text-xs text-slate-300">
            Automated indemnity claim verified by NOAA satellite precipitation oracle.
            Smart contract transferred{" "}
            <strong className="text-emerald-400">
              ${executionReceipt.payoutAmount.toLocaleString()} USDC
            </strong>{" "}
            directly to the farmer&apos;s wallet.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono bg-slate-950/80 p-3 rounded-xl border border-slate-800">
            <div>
              <span className="text-slate-500">Transaction Hash:</span>
              <p className="text-sky-400 truncate">{executionReceipt.txHash}</p>
            </div>
            <div>
              <span className="text-slate-500">Beneficiary:</span>
              <p className="text-slate-300 truncate">{executionReceipt.recipient}</p>
            </div>
            <div>
              <span className="text-slate-500">Gas Consumed:</span>
              <p className="text-slate-300">{executionReceipt.gasUnitsConsumed} CPU units</p>
            </div>
            <div>
              <span className="text-slate-500">Timestamp:</span>
              <p className="text-slate-300">{new Date(executionReceipt.timestamp).toLocaleTimeString()}</p>
            </div>
          </div>
        </div>
      )}

      {/* Selected Policy Breakdown Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        <h4 className="text-sm font-bold text-white flex items-center justify-between">
          <span>Active Policy Specification</span>
          <span className="text-xs font-mono text-slate-400">
            Policy #{selectedParcel.policyId}
          </span>
        </h4>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
            <span className="text-slate-400 text-[11px] block">Insured Parcel</span>
            <span className="font-semibold text-white block mt-0.5">
              {selectedParcel.name}
            </span>
          </div>
          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
            <span className="text-slate-400 text-[11px] block">Crop & Coverage</span>
            <span className="font-semibold text-sky-400 block mt-0.5">
              {selectedParcel.cropType} ({selectedParcel.areaHectares} ha)
            </span>
          </div>
          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
            <span className="text-slate-400 text-[11px] block">Total Insured Value</span>
            <span className="font-semibold text-emerald-400 block mt-0.5">
              ${selectedParcel.insuredValue.toLocaleString()} USDC
            </span>
          </div>
          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
            <span className="text-slate-400 text-[11px] block">Premium Deposited</span>
            <span className="font-semibold text-amber-400 block mt-0.5">
              ${selectedParcel.premiumPaid.toLocaleString()} USDC
            </span>
          </div>
        </div>

        <div className="text-[11px] text-slate-500 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
          <div>
            Contract ID: <span className="font-mono text-slate-400">{evaluation.sorobanContractId}</span>
          </div>
          <div>
            Oracle Feed: <span className="font-mono text-slate-400">{evaluation.oracleFeedId}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
