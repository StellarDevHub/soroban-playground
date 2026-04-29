"use client";

import React, { useState, useEffect } from "react";
import { ChevronRight, DollarSign } from "lucide-react";
import Link from "next/link";
import StablecoinDashboard from "../../components/StablecoinDashboard";

export default function StablecoinPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [metrics, setMetrics] = useState(null);
  const [priceHistory, setPriceHistory] = useState(null);
  const [rebaseHistory, setRebaseHistory] = useState(null);
  const [reserveInfo, setReserveInfo] = useState(null);
  const [contractStatus, setContractStatus] = useState(null);

  useEffect(() => {
    // Fetch data from API
    const fetchData = async () => {
      try {
        // In production, these would call the backend API
        // const metricsRes = await fetch('/api/stablecoin/metrics');
        // const priceRes = await fetch('/api/stablecoin/price-history');
        // ...etc

        // Simulated data for now
        await new Promise((resolve) => setTimeout(resolve, 1000));

        setMetrics({
          totalSupply: "1000000000000",
          totalReserve: "950000000000",
          collateralizationRatio: 0.95,
          currentPrice: 1.0,
          targetPrice: 1.0,
          priceDeviation: 0,
          lastRebase: new Date(Date.now() - 3600000).toISOString(),
          rebaseCount: 24,
          holders: 1543,
          volume24h: "50000000000",
          marketCap: "1000000000000",
        });

        setPriceHistory(
          Array.from({ length: 30 }, (_, i) => {
            const variance = (Math.random() - 0.5) * 0.02;
            return {
              price: Math.round((1.0 + variance) * 10000000),
              target_price: 10000000,
              timestamp: new Date(Date.now() - (30 - i) * 24 * 60 * 60 * 1000).toISOString(),
            };
          })
        );

        setRebaseHistory([
          {
            old_supply: "1000000000000",
            new_supply: "1001000000000",
            price: 10050000,
            timestamp: new Date(Date.now() - 3600000).toISOString(),
          },
          {
            old_supply: "999000000000",
            new_supply: "1000000000000",
            price: 10020000,
            timestamp: new Date(Date.now() - 7200000).toISOString(),
          },
        ]);

        setReserveInfo({
          totalReserve: "950000000000",
          targetReserve: "1000000000000",
          reserveRatio: 0.95,
          assets: [
            { asset: "XLM", amount: "400000000000", value: "400000000000" },
            { asset: "USDC", amount: "300000000000", value: "300000000000" },
            { asset: "BTC", amount: "8333", value: "250000000000" },
          ],
          lastUpdated: new Date().toISOString(),
        });

        setContractStatus({
          initialized: true,
          paused: false,
          contractId: "CD...",
          targetPrice: "1.00",
          rebaseCooldown: 3600,
          lastRebase: new Date(Date.now() - 3600000).toISOString(),
          nextRebase: new Date(Date.now() + 3600000).toISOString(),
        });

        setIsLoading(false);
      } catch (error) {
        console.error("Failed to fetch stablecoin data:", error);
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  const handleRebase = async () => {
    // In production, call API
    console.log("Triggering rebase...");
  };

  const handlePause = async () => {
    // In production, call API
    console.log("Pausing contract...");
  };

  const handleUnpause = async () => {
    // In production, call API
    console.log("Unpausing contract...");
  };

  const handleUpdatePrice = async (price: number) => {
    // In production, call API
    console.log("Updating price to:", price);
  };

  const handleAddReserve = async (amount: string) => {
    // In production, call API
    console.log("Adding reserve:", amount);
  };

  const handleWithdrawReserve = async (amount: string) => {
    // In production, call API
    console.log("Withdrawing reserve:", amount);
  };

  return (
    <div className="min-h-screen bg-slate-950 p-8 text-slate-100 selection:bg-cyan-500/30">
      <div className="mx-auto max-w-7xl space-y-8">
        {/* Breadcrumbs */}
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <Link href="/" className="hover:text-slate-300 transition">
            Dashboard
          </Link>
          <ChevronRight size={10} />
          <span className="text-cyan-400 font-medium">Stablecoin</span>
        </nav>

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-cyan-500/10 rounded-xl border border-cyan-500/20">
              <DollarSign className="w-8 h-8 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
                Stablecoin Reserve
              </h1>
              <p className="mt-1 text-slate-400 text-sm">
                Algorithmic stability mechanism with on-chain reserves
              </p>
            </div>
          </div>
        </div>

        {/* Dashboard */}
        <StablecoinDashboard
          metrics={metrics}
          priceHistory={priceHistory}
          rebaseHistory={rebaseHistory}
          reserveInfo={reserveInfo}
          contractStatus={contractStatus}
          isLoading={isLoading}
          isAdmin={true}
          isOracle={true}
          onRebase={handleRebase}
          onPause={handlePause}
          onUnpause={handleUnpause}
          onUpdatePrice={handleUpdatePrice}
          onAddReserve={handleAddReserve}
          onWithdrawReserve={handleWithdrawReserve}
        />

        {/* Documentation */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4">About the Algorithmic Stablecoin</h2>
          <div className="grid md:grid-cols-2 gap-6 text-sm text-slate-400">
            <div>
              <h3 className="text-slate-200 font-medium mb-2">Stability Mechanism</h3>
              <p className="leading-relaxed">
                The stablecoin maintains its peg through algorithmic rebasing. When the price
                deviates from the $1.00 target, the protocol automatically adjusts the total
                supply through expansion or contraction mechanisms.
              </p>
            </div>
            <div>
              <h3 className="text-slate-200 font-medium mb-2">Reserve Backing</h3>
              <p className="leading-relaxed">
                A diversified reserve of XLM, USDC, and BTC backs each stablecoin token,
                providing additional stability during market volatility. The collateralization
                ratio is maintained above 95%.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
