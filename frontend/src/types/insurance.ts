// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * @file insurance.ts
 * Clean Architecture domain types for Parametric Crop Insurance,
 * GIS agricultural parcel polygons, satellite weather radar telemetry,
 * and Soroban smart contract claim payout simulations.
 */

export type CropType =
  | "Wheat"
  | "Maize"
  | "Soybean"
  | "Barley"
  | "Rice"
  | "Cotton"
  | "Canola"
  | "Almonds"
  | "Vineyard";

export type PolicyStatus = "Active" | "Claimed" | "Expired" | "PendingTrigger";

export type TriggerType = "DROUGHT" | "FLOOD" | "NONE";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * Insured agricultural parcel with polygon geographic boundary coordinates.
 */
export interface AgriculturalParcel {
  id: string;
  name: string;
  regionId: string;
  cropType: CropType;
  areaHectares: number;
  coordinates: LatLng[];
  centroid: LatLng;
  farmerAddress: string;
  insuredValue: number;
  premiumPaid: number;
  baselineRainfallMm: number;
  currentRainfallMm: number;
  droughtThresholdMm: number;
  floodThresholdMm: number;
  policyId: number;
  policyStatus: PolicyStatus;
  soilMoisturePercent: number;
  elevationMeters: number;
}

/**
 * Weather radar cell reflecting Doppler radar precipitation intensity.
 */
export interface WeatherRadarCell {
  id: string;
  lat: number;
  lng: number;
  intensity: number; // 0 - 100%
  precipitationRateMmH: number;
  radiusKm: number;
}

/**
 * Precipitation isohyet contour line on the weather map.
 */
export interface PrecipitationContour {
  levelMm: number;
  label: string;
  color: string;
  paths: LatLng[][];
}

/**
 * Standardized Precipitation Index (SPI) drought severity level.
 */
export type SpiCategory =
  | "Extreme Drought"
  | "Severe Drought"
  | "Moderate Drought"
  | "Near Normal"
  | "Moderately Wet"
  | "Very Wet"
  | "Extremely Wet";

export interface SpiAnalysis {
  spiValue: number;
  category: SpiCategory;
  colorClass: string;
  description: string;
}

/**
 * Live parametric contract trigger evaluation result.
 */
export interface ParametricTriggerEvaluation {
  parcelId: string;
  policyId: number;
  farmerAddress: string;
  isTriggered: boolean;
  triggerType: TriggerType;
  simulatedRainfallMm: number;
  droughtThresholdMm: number;
  floodThresholdMm: number;
  deficitOrExcessMm: number;
  payoutPercentage: number; // 0 to 100%
  payoutAmount: number; // in USDC
  statusMessage: string;
  sorobanContractId: string;
  oracleFeedId: string;
  timestamp: string;
}

/**
 * Map layers visibility and display controls.
 */
export interface MapLayerOptions {
  showSatellite: boolean;
  showRadar: boolean;
  showContours: boolean;
  showParcels: boolean;
  showSoilHeatmap: boolean;
  radarOpacity: number; // 0.1 to 1.0
  isRadarPlaying: boolean;
}

/**
 * Simulated on-chain transaction receipt.
 */
export interface SimulatedPayoutReceipt {
  txHash: string;
  ledgerSequence: number;
  policyId: number;
  payoutAmount: number;
  recipient: string;
  gasUnitsConsumed: number;
  timestamp: string;
  contractMethod: string;
  status: "SUCCESS" | "FAILED";
}
