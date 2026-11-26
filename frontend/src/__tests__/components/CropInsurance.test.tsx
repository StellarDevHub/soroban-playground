// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * @file CropInsurance.test.tsx
 * React Testing Library component tests for Parametric Crop Insurance:
 * - Interactive Satellite Weather Map rendering with parcel polygons
 * - Weather radar and isohyet contour layer toggling
 * - Drought and flood threshold slider interactivity
 * - Parametric trigger condition evaluations and payout simulation
 * - On-chain Soroban contract payout execution receipt
 */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

import CropInsuranceDashboard from "../../components/insurance/CropInsuranceDashboard";
import { SAMPLE_AGRICULTURAL_PARCELS } from "../../lib/insurance/parametricEngine";

describe("CropInsuranceDashboard Component", () => {
  it("renders dashboard header, KPI stats, and oracle status indicators", () => {
    render(<CropInsuranceDashboard />);

    expect(screen.getByTestId("crop-insurance-dashboard")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Parametric Crop Insurance/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Stellar Testnet")).toBeInTheDocument();
    expect(screen.getByText("NOAA Satellite Active")).toBeInTheDocument();
    expect(screen.getByText("Total Value Insured")).toBeInTheDocument();
    expect(screen.getByText("Monitored Farmland")).toBeInTheDocument();
  });

  it("renders interactive satellite weather map and agricultural parcel polygons", () => {
    render(<CropInsuranceDashboard />);

    expect(
      screen.getByTestId("satellite-weather-map-container"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("weather-map-svg")).toBeInTheDocument();

    // Verify all 5 sample parcels are rendered as SVG polygons
    for (const parcel of SAMPLE_AGRICULTURAL_PARCELS) {
      expect(
        screen.getByTestId(`parcel-polygon-${parcel.id}`),
      ).toBeInTheDocument();
    }

    // Verify coordinate HUD and radar legend are visible
    expect(screen.getByTestId("cursor-coordinates-hud")).toBeInTheDocument();
    expect(screen.getByTestId("radar-legend-bar")).toBeInTheDocument();
  });

  it("toggles map weather layers (radar, contours, satellite, parcels)", () => {
    render(<CropInsuranceDashboard />);

    // Toggle radar layer
    expect(screen.getByTestId("layer-radar")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("toggle-layer-radar"));
    expect(screen.queryByTestId("layer-radar")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("toggle-layer-radar"));
    expect(screen.getByTestId("layer-radar")).toBeInTheDocument();

    // Toggle contours layer
    expect(screen.getByTestId("layer-contours")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("toggle-layer-contours"));
    expect(screen.queryByTestId("layer-contours")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("toggle-layer-contours"));
    expect(screen.getByTestId("layer-contours")).toBeInTheDocument();

    // Toggle parcels layer
    expect(screen.getByTestId("layer-parcels")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("toggle-layer-parcels"));
    expect(screen.queryByTestId("layer-parcels")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("toggle-layer-parcels"));
    expect(screen.getByTestId("layer-parcels")).toBeInTheDocument();
  });

  it("supports map zoom controls and radar play/pause", () => {
    render(<CropInsuranceDashboard />);

    const zoomInBtn = screen.getByTestId("map-zoom-in");
    const zoomOutBtn = screen.getByTestId("map-zoom-out");
    const resetViewBtn = screen.getByTestId("map-reset-view");

    fireEvent.click(zoomInBtn);
    expect(screen.getByText(/Zoom: 125%/i)).toBeInTheDocument();

    fireEvent.click(zoomOutBtn);
    expect(screen.getByText(/Zoom: 100%/i)).toBeInTheDocument();

    fireEvent.click(resetViewBtn);
    expect(screen.getByText(/Zoom: 100%/i)).toBeInTheDocument();

    // Toggle radar sweep animation
    const playPauseBtn = screen.getByTestId("radar-play-pause-button");
    expect(playPauseBtn).toHaveTextContent(/Pause Sweep/i);
    fireEvent.click(playPauseBtn);
    expect(playPauseBtn).toHaveTextContent(/Resume Sweep/i);
  });

  it("triggers parametric drought payout upon moving rainfall slider or selecting preset", async () => {
    render(<CropInsuranceDashboard />);

    // Click Severe Drought preset (45mm)
    const droughtPreset = screen.getByTestId("preset-severe-drought");
    fireEvent.click(droughtPreset);

    const statusBanner = screen.getByTestId("trigger-status-banner");
    expect(statusBanner).toHaveTextContent(/DROUGHT TRIGGER/i);
    expect(screen.getByTestId("execute-payout-button")).toBeInTheDocument();

    // Move drought slider up
    const droughtSlider = screen.getByTestId("drought-threshold-slider");
    fireEvent.change(droughtSlider, { target: { value: "180" } });
    expect(screen.getByText("180 mm")).toBeInTheDocument();
  });

  it("simulates on-chain Soroban contract payout execution", async () => {
    render(<CropInsuranceDashboard />);

    // Activate drought trigger
    fireEvent.click(screen.getByTestId("preset-severe-drought"));

    const executeBtn = screen.getByTestId("execute-payout-button");
    expect(executeBtn).toBeInTheDocument();
    fireEvent.click(executeBtn);

    // Wait for simulated Soroban contract execution receipt
    await waitFor(() => {
      expect(
        screen.getByTestId("payout-execution-receipt"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText(/Parametric Claim Executed on Stellar Soroban/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/LEDGER #/i)).toBeInTheDocument();
    expect(screen.getByText(/Transaction Hash:/i)).toBeInTheDocument();
  });

  it("selects different agricultural parcels and updates active policy", () => {
    render(<CropInsuranceDashboard />);

    // Select second parcel: Prairie Valley Soybean
    const parcelRow2 = screen.getByTestId("parcel-row-parcel-ia-02");
    fireEvent.click(parcelRow2);

    expect(
      screen.getByText("Prairie Valley Soybean Reserve"),
    ).toBeInTheDocument();
    expect(screen.getByText("Policy #102")).toBeInTheDocument();
  });
});
