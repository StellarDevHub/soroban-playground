import type { Metadata } from "next";

import PatentRegistryDashboard from "@/components/PatentRegistryDashboard";

export const metadata: Metadata = {
  title: "Patent Registry | Soroban Playground",
  description:
    "Register inventions, verify patents with decentralized validation, and manage licensing agreements in a decentralized marketplace.",
};

export default function PatentRegistryPage() {
  return <PatentRegistryDashboard />;
}
