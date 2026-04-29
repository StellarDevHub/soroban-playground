// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import type { Metadata } from "next";
import LoyaltyDashboard from "../../components/LoyaltyDashboard";

export const metadata: Metadata = {
  title: "Loyalty Rewards | Soroban Playground",
  description:
    "Decentralised loyalty-points program with cross-merchant redemption and analytics.",
};

export default function LoyaltyPage() {
  return <LoyaltyDashboard />;
}
