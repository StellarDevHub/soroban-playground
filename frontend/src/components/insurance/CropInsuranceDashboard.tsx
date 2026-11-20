// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * @file CropInsuranceDashboard.tsx
 * Clean Architecture master dashboard for Parametric Crop Insurance,
 * orchestrating the interactive satellite weather map and parametric claim simulator.
 */

"use client";

import React, { useMemo, useState } from "react";
import {
  Activity,
  CheckCircle,
  CloudRain,
  Coins,
  Globe2,
  Layers,
  MapPin,
  Radio,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Sprout,
  Users,
} from "lucide-react";
import type { AgriculturalParcel } from "../../types/insurance";
import {
  evaluateParametricTrigger,
  SAMPLE_AGRICULTURAL_PARCELS,
  SOROBAN_INSURANCE_CONTRACT_ID,
} from "../../lib/insurance/parametricEngine";
import SatelliteWeatherMap from "./SatelliteWeatherMap";
import ParametricSimulator from "./ParametricSimulator";

export default function CropInsuranceDashboard() {
  const [parcels] = useState<AgriculturalParcel[]>(SAMPLE_AGRICULTURAL_PARCELS);
  const [selectedParcelId, setSelectedParcelId] = useState<string>(
    parcels[0]?.id ?? "parcel-ia-01",
  );

  const selectedParcel = useMemo(() => {
    return parcels.find((p) => p.id === selectedParcelId) ?? parcels[0];
  }, [parcels, selectedParcelId]);

  // Simulation controls state
  const [simulatedRainfallMm, setSimulatedRainfallMm] = useState<number>(
    selectedParcel.currentRainfallMm,
  );
  const [droughtThresholdMm, setDroughtThresholdMm] = useState<number>(
    selectedParcel.droughtThresholdMm,
  );
  const [floodThresholdMm, setFloodThresholdMm] = useState<number>(
    selectedParcel.floodThresholdMm,
  );

  // When parcel changes, optionally align sliders to its baseline
  const handleSelectParcel = (id: string) => {
    setSelectedParcelId(id);
    const p = parcels.find((item) => item.id === id);
    if (p) {
      setDroughtThresholdMm(p.droughtThresholdMm);
      setFloodThresholdMm(p.floodThresholdMm);
    }
  };

  // Evaluate trigger state for selected parcel
  const currentEvaluation = useMemo(() => {
    return evaluateParametricTrigger(
      selectedParcel,
      simulatedRainfallMm,
      droughtThresholdMm,
      floodThresholdMm,
    );
  }, [selectedParcel, simulatedRainfallMm, droughtThresholdMm, floodThresholdMm]);

  // Aggregated KPIs
  const totalInsuredValue = useMemo(() => {
    return parcels.reduce((sum, p) => sum + p.insuredValue, 0);
  }, [parcels]);

  const totalAreaHectares = useMemo(() => {
    return parcels.reduce((sum, p) => sum + p.areaHectares, 0);
  }, [parcels]);

  return (
    <div
      className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-6 lg:p-8"
      data-testid="crop-insurance-dashboard"
    >
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Top Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                Soroban Smart Contracts
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/30 flex items-center gap-1">
                <Radio className="w-3 h-3 animate-pulse" />
                Satellite Telemetry
              </span>
            </div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
              <Sprout className="w-8 h-8 text-emerald-400" />
              Parametric Crop Insurance
            </h1>
            <p className="text-sm text-slate-400 mt-1 max-w-2xl">
              Automated weather-indexed drought and flood coverage. Satellite rainfall telemetry triggers instant indemnity payouts via Soroban smart contracts.
            </p>
          </div>

          {/* Network & Oracle Status Badges */}
          <div className="flex items-center gap-3">
            <div className="px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs">
              <div className="text-slate-400 text-[10px] uppercase font-semibold">Network</div>
              <div className="font-semibold text-sky-400 flex items-center gap-1.5 mt-0.5">
                <div className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
                Stellar Testnet
              </div>
            </div>
            <div className="px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs">
              <div className="text-slate-400 text-[10px] uppercase font-semibold">Oracle Feed</div>
              <div className="font-semibold text-emerald-400 flex items-center gap-1.5 mt-0.5">
                <CheckCircle className="w-3.5 h-3.5" />
                NOAA Satellite Active
              </div>
            </div>
          </div>
        </header>

        {/* Overview KPI Cards */}
        <section
          className="grid grid-cols-2 lg:grid-cols-4 gap-4"
          aria-label="Key Performance Indicators"
        >
          <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl shadow-lg">
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-xs font-semibold uppercase tracking-wider">Total Value Insured</span>
              <Coins className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-black text-white font-mono">
              ${totalInsuredValue.toLocaleString()}{" "}
              <span className="text-xs font-normal text-slate-400">USDC</span>
            </div>
            <div className="text-[11px] text-emerald-400 mt-1">
              Across {parcels.length} agricultural policies
            </div>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl shadow-lg">
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-xs font-semibold uppercase tracking-wider">Monitored Farmland</span>
              <Globe2 className="w-4 h-4 text-sky-400" />
            </div>
            <div className="text-2xl font-black text-white font-mono">
              {totalAreaHectares.toFixed(1)}{" "}
              <span className="text-xs font-normal text-slate-400">ha</span>
            </div>
            <div className="text-[11px] text-sky-400 mt-1">
              GPS polygon boundaries mapped
            </div>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl shadow-lg">
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-xs font-semibold uppercase tracking-wider">Oracle Precipitation</span>
              <CloudRain className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="text-2xl font-black text-white font-mono">
              {simulatedRainfallMm}{" "}
              <span className="text-xs font-normal text-slate-400">mm</span>
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              Live simulated rainfall radar
            </div>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl shadow-lg">
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-xs font-semibold uppercase tracking-wider">Trigger Status</span>
              {currentEvaluation.isTriggered ? (
                <ShieldAlert className="w-4 h-4 text-rose-400 animate-pulse" />
              ) : (
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
              )}
            </div>
            <div
              className={`text-xl font-bold ${
                currentEvaluation.isTriggered ? "text-rose-400" : "text-emerald-400"
              }`}
            >
              {currentEvaluation.triggerType === "DROUGHT"
                ? "Drought Triggered"
                : currentEvaluation.triggerType === "FLOOD"
                ? "Flood Triggered"
                : "Safe / Active"}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              {currentEvaluation.isTriggered
                ? `$${currentEvaluation.payoutAmount.toLocaleString()} USDC claim ready`
                : "No payout required"}
            </div>
          </div>
        </section>

        {/* Two-Column Responsive Layout: Map & Simulator */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Interactive Satellite Weather Map (7 cols) */}
          <div className="lg:col-span-7 space-y-4">
            <SatelliteWeatherMap
              parcels={parcels}
              selectedParcelId={selectedParcelId}
              onSelectParcel={handleSelectParcel}
              simulatedRainfallMm={simulatedRainfallMm}
              droughtThresholdMm={droughtThresholdMm}
              floodThresholdMm={floodThresholdMm}
              isDroughtTriggered={currentEvaluation.triggerType === "DROUGHT"}
              isFloodTriggered={currentEvaluation.triggerType === "FLOOD"}
            />
          </div>

          {/* Right Column: Parametric Claim Simulator (5 cols) */}
          <div className="lg:col-span-5 space-y-4">
            <ParametricSimulator
              selectedParcel={selectedParcel}
              simulatedRainfallMm={simulatedRainfallMm}
              droughtThresholdMm={droughtThresholdMm}
              floodThresholdMm={floodThresholdMm}
              onSimulatedRainfallChange={setSimulatedRainfallMm}
              onDroughtThresholdChange={setDroughtThresholdMm}
              onFloodThresholdChange={setFloodThresholdMm}
            />
          </div>
        </section>

        {/* Agricultural Parcels Portfolio Table */}
        <section
          className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4"
          aria-label="Insured Agricultural Parcels Portfolio"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <MapPin className="w-4 h-4 text-emerald-400" />
                Insured Agricultural Parcel Portfolio
              </h3>
              <p className="text-xs text-slate-400">
                Click any parcel row to inspect its geographic coordinates and weather triggers
              </p>
            </div>
            <span className="text-xs font-mono text-slate-500">
              Contract: {SOROBAN_INSURANCE_CONTRACT_ID.substring(0, 8)}...
            </span>
          </div>

          <div className="overflow-x-auto">
            <table
              className="w-full text-left text-xs text-slate-300"
              data-testid="parcels-portfolio-table"
            >
              <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider font-semibold border-b border-slate-800">
                <tr>
                  <th className="py-3 px-3">Parcel Name</th>
                  <th className="py-3 px-3">Crop Type</th>
                  <th className="py-3 px-3">Area</th>
                  <th className="py-3 px-3">Insured Sum</th>
                  <th className="py-3 px-3">Baseline Rain</th>
                  <th className="py-3 px-3">Drought Trigger</th>
                  <th className="py-3 px-3">Flood Limit</th>
                  <th className="py-3 px-3">Policy Status</th>
                  <th className="py-3 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {parcels.map((parcel) => {
                  const isSelected = parcel.id === selectedParcelId;
                  const evalResult = evaluateParametricTrigger(
                    parcel,
                    simulatedRainfallMm,
                    droughtThresholdMm,
                    floodThresholdMm,
                  );

                  return (
                    <tr
                      key={parcel.id}
                      onClick={() => handleSelectParcel(parcel.id)}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-sky-500/10 text-white font-medium"
                          : "hover:bg-slate-800/50"
                      }`}
                      data-testid={`parcel-row-${parcel.id}`}
                    >
                      <td className="py-3 px-3 font-sans font-semibold text-white">
                        {parcel.name}
                      </td>
                      <td className="py-3 px-3">
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-sky-300 font-sans">
                          {parcel.cropType}
                        </span>
                      </td>
                      <td className="py-3 px-3">{parcel.areaHectares} ha</td>
                      <td className="py-3 px-3 text-emerald-400 font-semibold">
                        ${parcel.insuredValue.toLocaleString()}
                      </td>
                      <td className="py-3 px-3">{parcel.baselineRainfallMm} mm</td>
                      <td className="py-3 px-3 text-amber-400 font-semibold">
                        &lt; {parcel.droughtThresholdMm} mm
                      </td>
                      <td className="py-3 px-3 text-indigo-400">
                        &gt; {parcel.floodThresholdMm} mm
                      </td>
                      <td className="py-3 px-3">
                        {evalResult.triggerType === "DROUGHT" ? (
                          <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px]">
                            DROUGHT TRIGGERED
                          </span>
                        ) : evalResult.triggerType === "FLOOD" ? (
                          <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-[10px]">
                            FLOOD TRIGGERED
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px]">
                            ACTIVE (SAFE)
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectParcel(parcel.id);
                          }}
                          className={`px-2.5 py-1 rounded text-[11px] font-sans font-medium transition-colors ${
                            isSelected
                              ? "bg-sky-500 text-white"
                              : "bg-slate-800 hover:bg-slate-700 text-slate-300"
                          }`}
                        >
                          {isSelected ? "Inspecting" : "Select"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
