import type { Metadata } from "next";

import YieldOptimizerDashboard from "@/components/YieldOptimizerDashboard";

export const metadata: Metadata = {
  title: "Yield Optimizer | Soroban Playground",
  description:
    "Create cross-protocol strategies, manage deposits/withdrawals, run auto-compounding, and execute deterministic backtests.",
};

export default function YieldOptimizerPage() {
  return <YieldOptimizerDashboard />;
}
