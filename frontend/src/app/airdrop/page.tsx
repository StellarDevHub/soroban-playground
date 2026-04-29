import type { Metadata } from "next";
import AirdropDashboard from "../../components/AirdropDashboard";

export const metadata: Metadata = {
  title: "Token Airdrop | Soroban Playground",
  description: "Create and manage token airdrop campaigns on Stellar Soroban.",
};

export default function AirdropPage() {
  return <AirdropDashboard />;
}
