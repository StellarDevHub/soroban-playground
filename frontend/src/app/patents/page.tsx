import type { Metadata } from "next";

import PatentRegistryDashboard from "../../components/PatentRegistryDashboard";

export const metadata: Metadata = {
  title: "Patent Registry | Soroban Playground",
  description:
    "Register inventions, verify patent claims, and manage licensing marketplace offers through the Soroban Playground patent registry demo.",
};

export default function PatentRegistryPage() {
  return <PatentRegistryDashboard />;
}
