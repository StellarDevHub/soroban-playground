// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * @file parametricEngine.ts
 * Core business logic and algorithmic engine for Parametric Crop Insurance,
 * Standardized Precipitation Index (SPI) calculations, trigger evaluations,
 * and Soroban smart contract payout simulators.
 */

import type {
  AgriculturalParcel,
  ParametricTriggerEvaluation,
  SimulatedPayoutReceipt,
  SpiAnalysis,
  SpiCategory,
} from "../../types/insurance";
import { calculateBoundingBox, calculateCentroid } from "./geoProjection";

export const SOROBAN_INSURANCE_CONTRACT_ID =
  "CA4M4X7QZLPF7X67BQLZ7R2E46WJ6NV9XPQ3M5T6K7D2Z9Y1N4B8V2W9";

export const ORACLE_FEED_ID = "STELLAR_NOAA_SATELLITE_ORACLE_V2";

/**
 * Seed dataset of insured agricultural parcels with real-world GIS coordinates.
 */
export const SAMPLE_AGRICULTURAL_PARCELS: AgriculturalParcel[] = [
  {
    id: "parcel-ia-01",
    name: "Cedar Creek Corn Sector A",
    regionId: "REGION_IOWA_CORN_01",
    cropType: "Maize",
    areaHectares: 320.5,
    farmerAddress: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUW5S",
    insuredValue: 125000,
    premiumPaid: 6250,
    baselineRainfallMm: 380,
    currentRainfallMm: 110,
    droughtThresholdMm: 140,
    floodThresholdMm: 650,
    policyId: 101,
    policyStatus: "Active",
    soilMoisturePercent: 18.4,
    elevationMeters: 290,
    coordinates: [
      { lat: 42.062, lng: -93.68 },
      { lat: 42.064, lng: -93.61 },
      { lat: 42.025, lng: -93.605 },
      { lat: 42.022, lng: -93.675 },
    ],
    centroid: { lat: 42.04325, lng: -93.6425 },
  },
  {
    id: "parcel-ia-02",
    name: "Prairie Valley Soybean Reserve",
    regionId: "REGION_IOWA_CORN_01",
    cropType: "Soybean",
    areaHectares: 245.0,
    farmerAddress: "GBBMY7Q3N2M4GHKR7PXZT2QW4V8YLM5NK2J7X6B1C9D4F8H2S5T9U1V3",
    insuredValue: 95000,
    premiumPaid: 4750,
    baselineRainfallMm: 360,
    currentRainfallMm: 125,
    droughtThresholdMm: 130,
    floodThresholdMm: 620,
    policyId: 102,
    policyStatus: "Active",
    soilMoisturePercent: 21.0,
    elevationMeters: 305,
    coordinates: [
      { lat: 42.095, lng: -93.59 },
      { lat: 42.098, lng: -93.52 },
      { lat: 42.055, lng: -93.515 },
      { lat: 42.052, lng: -93.585 },
    ],
    centroid: { lat: 42.075, lng: -93.5525 },
  },
  {
    id: "parcel-ia-03",
    name: "Red River Winter Wheat Field",
    regionId: "REGION_IOWA_CORN_01",
    cropType: "Wheat",
    areaHectares: 410.8,
    farmerAddress: "GCD4F8H2S5T9U1V3GBBMY7Q3N2M4GHKR7PXZT2QW4V8YLM5NK2J7X6B1",
    insuredValue: 160000,
    premiumPaid: 8000,
    baselineRainfallMm: 400,
    currentRainfallMm: 95,
    droughtThresholdMm: 150,
    floodThresholdMm: 680,
    policyId: 103,
    policyStatus: "Active",
    soilMoisturePercent: 14.8,
    elevationMeters: 275,
    coordinates: [
      { lat: 42.015, lng: -93.74 },
      { lat: 42.018, lng: -93.68 },
      { lat: 41.975, lng: -93.675 },
      { lat: 41.972, lng: -93.735 },
    ],
    centroid: { lat: 41.995, lng: -93.7075 },
  },
  {
    id: "parcel-ia-04",
    name: "Golden Ridge Barley Acres",
    regionId: "REGION_IOWA_CORN_01",
    cropType: "Barley",
    areaHectares: 180.2,
    farmerAddress: "GE5NK2J7X6B1C9D4F8H2S5T9U1V3GBBMY7Q3N2M4GHKR7PXZT2QW4V8Y",
    insuredValue: 72000,
    premiumPaid: 3600,
    baselineRainfallMm: 350,
    currentRainfallMm: 145,
    droughtThresholdMm: 120,
    floodThresholdMm: 600,
    policyId: 104,
    policyStatus: "Active",
    soilMoisturePercent: 24.5,
    elevationMeters: 315,
    coordinates: [
      { lat: 42.058, lng: -93.79 },
      { lat: 42.062, lng: -93.73 },
      { lat: 42.025, lng: -93.725 },
      { lat: 42.022, lng: -93.785 },
    ],
    centroid: { lat: 42.04175, lng: -93.7575 },
  },
  {
    id: "parcel-ia-05",
    name: "Sunburst Canola Meadow",
    regionId: "REGION_IOWA_CORN_01",
    cropType: "Canola",
    areaHectares: 215.0,
    farmerAddress: "GF8H2S5T9U1V3GBBMY7Q3N2M4GHKR7PXZT2QW4V8YLM5NK2J7X6B1C9D4",
    insuredValue: 88000,
    premiumPaid: 4400,
    baselineRainfallMm: 370,
    currentRainfallMm: 160,
    droughtThresholdMm: 135,
    floodThresholdMm: 640,
    policyId: 105,
    policyStatus: "Active",
    soilMoisturePercent: 27.2,
    elevationMeters: 285,
    coordinates: [
      { lat: 42.008, lng: -93.63 },
      { lat: 42.012, lng: -93.57 },
      { lat: 41.972, lng: -93.565 },
      { lat: 41.968, lng: -93.625 },
    ],
    centroid: { lat: 41.99, lng: -93.5975 },
  },
];

/**
 * Preset weather simulation scenarios for rapid UI testing.
 */
export const WEATHER_PRESETS = [
  {
    id: "severe-drought",
    label: "Extreme Drought",
    rainfallMm: 45,
    description: "Crippling heatwave & zero rainfall trigger complete drought payout.",
    icon: "sun",
  },
  {
    id: "moderate-dry",
    label: "Moderate Dry",
    rainfallMm: 115,
    description: "Precipitation below critical vegetative stage trigger thresholds.",
    icon: "cloud-sun",
  },
  {
    id: "seasonal-normal",
    label: "Optimal Seasonal",
    rainfallMm: 375,
    description: "Healthy moisture balance; contract safely un-triggered.",
    icon: "cloud-rain",
  },
  {
    id: "heavy-monsoon",
    label: "Excessive Rain",
    rainfallMm: 580,
    description: "Saturated soil approaching flood boundary parameters.",
    icon: "cloud-lightning",
  },
  {
    id: "flash-flood",
    label: "Flash Flood",
    rainfallMm: 820,
    description: "Catastrophic precipitation breaches maximum flood limit.",
    icon: "waves",
  },
] as const;

/**
 * Calculates the Standardized Precipitation Index (SPI) for drought categorization.
 */
export function calculateSpi(
  currentRainfallMm: number,
  baselineRainfallMm: number,
): SpiAnalysis {
  if (baselineRainfallMm <= 0) {
    return {
      spiValue: 0,
      category: "Near Normal",
      colorClass: "text-emerald-400 bg-emerald-950/60 border-emerald-700/50",
      description: "Baseline data insufficient",
    };
  }

  // Standard deviation approximation: ~25% of seasonal baseline
  const stdDev = Math.max(baselineRainfallMm * 0.25, 20);
  const spiValue = Math.round(((currentRainfallMm - baselineRainfallMm) / stdDev) * 100) / 100;

  let category: SpiCategory;
  let colorClass: string;
  let description: string;

  if (spiValue <= -2.0) {
    category = "Extreme Drought";
    colorClass = "text-rose-400 bg-rose-950/70 border-rose-600";
    description: "Catastrophic crop failure risk; emergency parametric payout active.";
  } else if (spiValue <= -1.5) {
    category = "Severe Drought";
    colorClass = "text-amber-400 bg-amber-950/70 border-amber-600";
    description: "High drought stress; crop yield reduction imminent.";
  } else if (spiValue <= -1.0) {
    category = "Moderate Drought";
    colorClass = "text-yellow-400 bg-yellow-950/60 border-yellow-600";
    description: "Deficit soil moisture; heightened monitoring underway.";
  } else if (spiValue < 1.0) {
    category = "Near Normal";
    colorClass = "text-emerald-400 bg-emerald-950/60 border-emerald-600";
    description: "Optimal moisture balance for healthy crop maturation.";
  } else if (spiValue < 1.5) {
    category = "Moderately Wet";
    colorClass = "text-sky-400 bg-sky-950/60 border-sky-600";
    description: "Elevated soil water retention; healthy growth.";
  } else if (spiValue < 2.0) {
    category = "Very Wet";
    colorClass = "text-blue-400 bg-blue-950/70 border-blue-600";
    description: "Heavy moisture levels; potential for localized waterlogging.";
  } else {
    category = "Extremely Wet";
    colorClass = "text-indigo-400 bg-indigo-950/70 border-indigo-600";
    description: "Flooding threshold breached; agricultural submergence claim triggered.";
  }

  return { spiValue, category, colorClass, description };
}

/**
 * Evaluates a parametric insurance policy against simulated rainfall and threshold sliders.
 */
export function evaluateParametricTrigger(
  parcel: AgriculturalParcel,
  simulatedRainfallMm: number,
  droughtThresholdOverride?: number,
  floodThresholdOverride?: number,
): ParametricTriggerEvaluation {
  const droughtThreshold = droughtThresholdOverride ?? parcel.droughtThresholdMm;
  const floodThreshold = floodThresholdOverride ?? parcel.floodThresholdMm;

  const isDrought = simulatedRainfallMm < droughtThreshold;
  const isFlood = simulatedRainfallMm > floodThreshold;

  let isTriggered = false;
  let triggerType: "DROUGHT" | "FLOOD" | "NONE" = "NONE";
  let deficitOrExcessMm = 0;
  let payoutPercentage = 0;
  let statusMessage = "Precipitation within safe operational parameters. No claim triggered.";

  if (isDrought) {
    isTriggered = true;
    triggerType = "DROUGHT";
    deficitOrExcessMm = droughtThreshold - simulatedRainfallMm;

    // Linear tiered payout from threshold down to zero:
    // If rainfall drops by 50% or more below threshold, full 100% payout
    const deficitRatio = deficitOrExcessMm / droughtThreshold;
    payoutPercentage = Math.min(100, Math.round(Math.max(25, deficitRatio * 150)));
    statusMessage = `DROUGHT TRIGGER ACTIVATED: Rainfall (${simulatedRainfallMm}mm) is ${deficitOrExcessMm}mm below the ${droughtThreshold}mm threshold.`;
  } else if (isFlood) {
    isTriggered = true;
    triggerType = "FLOOD";
    deficitOrExcessMm = simulatedRainfallMm - floodThreshold;

    const excessRatio = deficitOrExcessMm / floodThreshold;
    payoutPercentage = Math.min(100, Math.round(Math.max(50, excessRatio * 200)));
    statusMessage = `FLOOD TRIGGER ACTIVATED: Rainfall (${simulatedRainfallMm}mm) exceeds maximum ${floodThreshold}mm threshold by ${deficitOrExcessMm}mm.`;
  }

  const payoutAmount = Math.round((parcel.insuredValue * payoutPercentage) / 100);

  return {
    parcelId: parcel.id,
    policyId: parcel.policyId,
    farmerAddress: parcel.farmerAddress,
    isTriggered,
    triggerType,
    simulatedRainfallMm,
    droughtThresholdMm: droughtThreshold,
    floodThresholdMm,
    deficitOrExcessMm,
    payoutPercentage,
    payoutAmount,
    statusMessage,
    sorobanContractId: SOROBAN_INSURANCE_CONTRACT_ID,
    oracleFeedId: ORACLE_FEED_ID,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Simulates on-chain Soroban parametric contract payout execution.
 */
export function simulateSorobanPayoutExecution(
  evaluation: ParametricTriggerEvaluation,
): SimulatedPayoutReceipt {
  const randomHex = () =>
    Math.random().toString(16).substring(2, 10).toUpperCase();

  const mockTxHash = `0x${randomHex()}${randomHex()}${randomHex()}${randomHex()}${randomHex()}${randomHex()}${randomHex()}${randomHex()}`;
  const mockLedger = 54890200 + Math.floor(Math.random() * 5000);
  const gasUsed = 18450 + Math.floor(Math.random() * 2500);

  return {
    txHash: mockTxHash,
    ledgerSequence: mockLedger,
    policyId: evaluation.policyId,
    payoutAmount: evaluation.payoutAmount,
    recipient: evaluation.farmerAddress,
    gasUnitsConsumed: gasUsed,
    timestamp: new Date().toISOString(),
    contractMethod: "trigger_payout",
    status: evaluation.isTriggered ? "SUCCESS" : "FAILED",
  };
}

/**
 * Helper to get initial bounding box for the sample agricultural parcels.
 */
export function getInitialMapBounds(parcels: AgriculturalParcel[] = SAMPLE_AGRICULTURAL_PARCELS) {
  const allCoords = parcels.flatMap((p) => p.coordinates);
  return calculateBoundingBox(allCoords, 0.12);
}
