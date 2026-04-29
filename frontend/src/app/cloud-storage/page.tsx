import dynamic from "next/dynamic";

const CloudStoragePanel = dynamic(
  () => import("@/components/CloudStoragePanel").then((m) => m.CloudStoragePanel),
  { ssr: false, loading: () => <div className="p-6 text-gray-500">Loading cloud storage…</div> }
);

export const metadata = {
  title: "Cloud Storage | Soroban Playground",
  description: "Decentralized cloud storage with file sharding and redundancy management.",
};

export default function CloudStoragePage() {
  return <CloudStoragePanel />;
}