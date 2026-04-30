import dynamic from "next/dynamic";

const LimitOrderBookPanel = dynamic(
  () => import("@/components/LimitOrderBookPanel"),
  { ssr: false, loading: () => <div className="p-6 text-gray-500">Loading order book…</div> }
);

export const metadata = {
  title: "Limit Order Book | Soroban Playground",
  description: "Place, match, and cancel limit orders on the Soroban Limit Order Book contract.",
};

export default function OrderBookPage() {
  return <LimitOrderBookPanel />;
}
