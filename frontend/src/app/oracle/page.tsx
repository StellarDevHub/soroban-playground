import dynamic from "next/dynamic";

// The panel opens a WebSocket and uses browser-only APIs, so render
// client-side only. SSR would just produce a placeholder anyway.
const OracleStatusPanel = dynamic(
  () => import("@/components/OracleStatusPanel").then((m) => m.OracleStatusPanel),
  { ssr: false, loading: () => <div className="p-6 text-gray-500">Loading oracle network…</div> }
);

export const metadata = {
  title: "Oracle Network | Soroban Playground",
  description:
    "Distributed oracle node coordination, consensus voting, leader election, and live event stream.",
};

export default function OraclePage() {
  return <OracleStatusPanel />;
}
