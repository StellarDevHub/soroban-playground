"use client";

import StoragePinningDashboard from "@/components/Ipfs/StoragePinningDashboard";

export default function DecentralizedPinningPage() {
  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
      <StoragePinningDashboard />
    </div>
  );
}
