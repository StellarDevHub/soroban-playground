// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * @file page.tsx
 * Route page for Parametric Crop Insurance with Satellite Weather Map Layer.
 * Part of Issue #2064 (FRONTEND-294).
 */

"use client";

import React from "react";
import CropInsuranceDashboard from "../../components/insurance/CropInsuranceDashboard";

export default function CropInsurancePage() {
  return (
    <main
      className="min-h-screen bg-slate-950"
      aria-label="Parametric Crop Insurance System"
    >
      <CropInsuranceDashboard />
    </main>
  );
}
