// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * @file parametricEngine.node.test.ts
 * Node-based unit test suite for Parametric Crop Insurance engine,
 * threshold trigger simulations, SPI drought indexes, and Soroban payout verification.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateSpi,
  evaluateParametricTrigger,
  SAMPLE_AGRICULTURAL_PARCELS,
  simulateSorobanPayoutExecution,
  SOROBAN_INSURANCE_CONTRACT_ID,
  WEATHER_PRESETS,
} from "../../lib/insurance/parametricEngine.ts";
import type { AgriculturalParcel } from "../../types/insurance.ts";

test("SAMPLE_AGRICULTURAL_PARCELS contains valid insured farmland datasets", () => {
  assert.equal(SAMPLE_AGRICULTURAL_PARCELS.length, 5);

  for (const parcel of SAMPLE_AGRICULTURAL_PARCELS) {
    assert.ok(parcel.id.startsWith("parcel-"));
    assert.ok(parcel.coordinates.length >= 3, "Parcel must have at least 3 vertices");
    assert.ok(parcel.areaHectares > 0, "Area must be positive");
    assert.ok(parcel.insuredValue > 0, "Insured value must be positive");
    assert.ok(parcel.farmerAddress.startsWith("G"), "Farmer address must be Stellar G-address");
    assert.ok(parcel.droughtThresholdMm > 0);
    assert.ok(parcel.floodThresholdMm > parcel.droughtThresholdMm);
  }
});

test("evaluateParametricTrigger correctly fires DROUGHT trigger when rainfall breaches threshold", () => {
  const parcel: AgriculturalParcel = SAMPLE_AGRICULTURAL_PARCELS[0]; // drought threshold: 140mm, insured: $125k
  const simulatedRain = 60; // 60mm < 140mm

  const result = evaluateParametricTrigger(parcel, simulatedRain);
  assert.equal(result.isTriggered, true);
  assert.equal(result.triggerType, "DROUGHT");
  assert.equal(result.simulatedRainfallMm, 60);
  assert.equal(result.droughtThresholdMm, 140);
  assert.equal(result.deficitOrExcessMm, 80); // 140 - 60
  assert.ok(result.payoutPercentage > 0, "Payout percentage must be > 0");
  assert.ok(result.payoutAmount > 0, "Payout amount must be > 0");
  assert.equal(
    result.payoutAmount,
    Math.round((parcel.insuredValue * result.payoutPercentage) / 100),
  );
  assert.ok(result.statusMessage.includes("DROUGHT TRIGGER ACTIVATED"));
  assert.equal(result.sorobanContractId, SOROBAN_INSURANCE_CONTRACT_ID);
});

test("evaluateParametricTrigger correctly fires FLOOD trigger when rainfall exceeds upper limit", () => {
  const parcel: AgriculturalParcel = SAMPLE_AGRICULTURAL_PARCELS[0]; // flood threshold: 650mm
  const simulatedRain = 780; // 780mm > 650mm

  const result = evaluateParametricTrigger(parcel, simulatedRain);
  assert.equal(result.isTriggered, true);
  assert.equal(result.triggerType, "FLOOD");
  assert.equal(result.deficitOrExcessMm, 130); // 780 - 650
  assert.ok(result.payoutPercentage > 0);
  assert.ok(result.payoutAmount > 0);
  assert.ok(result.statusMessage.includes("FLOOD TRIGGER ACTIVATED"));
});

test("evaluateParametricTrigger leaves policy untriggered within normal rainfall range", () => {
  const parcel: AgriculturalParcel = SAMPLE_AGRICULTURAL_PARCELS[0]; // 140mm - 650mm safe zone
  const simulatedRain = 350;

  const result = evaluateParametricTrigger(parcel, simulatedRain);
  assert.equal(result.isTriggered, false);
  assert.equal(result.triggerType, "NONE");
  assert.equal(result.deficitOrExcessMm, 0);
  assert.equal(result.payoutPercentage, 0);
  assert.equal(result.payoutAmount, 0);
  assert.ok(result.statusMessage.includes("safe operational parameters"));
});

test("evaluateParametricTrigger respects dynamic user threshold slider overrides", () => {
  const parcel: AgriculturalParcel = SAMPLE_AGRICULTURAL_PARCELS[0];
  const rainfall = 170; // Normally above default 140mm -> safe

  const defaultEval = evaluateParametricTrigger(parcel, rainfall);
  assert.equal(defaultEval.isTriggered, false);

  // User drags drought threshold slider up to 190mm
  const adjustedEval = evaluateParametricTrigger(parcel, rainfall, 190, 650);
  assert.equal(adjustedEval.isTriggered, true);
  assert.equal(adjustedEval.triggerType, "DROUGHT");
  assert.equal(adjustedEval.deficitOrExcessMm, 20); // 190 - 170

  // User drags drought threshold down to 100mm with 120mm rainfall -> safe
  const lowThresholdEval = evaluateParametricTrigger(parcel, 120, 100, 650);
  assert.equal(lowThresholdEval.isTriggered, false);
});

test("calculateSpi computes accurate Standardized Precipitation Index categories", () => {
  const baseline = 400;

  // Severe drought: 60mm vs 400mm
  const droughtSpi = calculateSpi(60, baseline);
  assert.ok(droughtSpi.spiValue <= -2.0);
  assert.equal(droughtSpi.category, "Extreme Drought");

  // Near normal: 390mm vs 400mm
  const normalSpi = calculateSpi(390, baseline);
  assert.ok(normalSpi.spiValue > -1.0 && normalSpi.spiValue < 1.0);
  assert.equal(normalSpi.category, "Near Normal");

  // Catastrophic wet: 800mm vs 400mm
  const floodSpi = calculateSpi(800, baseline);
  assert.ok(floodSpi.spiValue >= 2.0);
  assert.equal(floodSpi.category, "Extremely Wet");
});

test("simulateSorobanPayoutExecution generates valid simulated on-chain receipt", () => {
  const parcel = SAMPLE_AGRICULTURAL_PARCELS[0];
  const evaluation = evaluateParametricTrigger(parcel, 50); // Drought triggered

  const receipt = simulateSorobanPayoutExecution(evaluation);
  assert.ok(receipt.txHash.startsWith("0x"));
  assert.equal(receipt.txHash.length, 66); // 0x + 64 hex chars
  assert.ok(receipt.ledgerSequence > 50000000);
  assert.equal(receipt.policyId, parcel.policyId);
  assert.equal(receipt.recipient, parcel.farmerAddress);
  assert.equal(receipt.payoutAmount, evaluation.payoutAmount);
  assert.equal(receipt.contractMethod, "trigger_payout");
  assert.equal(receipt.status, "SUCCESS");
});

test("WEATHER_PRESETS defines all required simulated climatic scenarios", () => {
  assert.ok(WEATHER_PRESETS.length >= 5);
  const ids = WEATHER_PRESETS.map((p) => p.id);
  assert.ok(ids.includes("severe-drought"));
  assert.ok(ids.includes("seasonal-normal"));
  assert.ok(ids.includes("flash-flood"));
});
