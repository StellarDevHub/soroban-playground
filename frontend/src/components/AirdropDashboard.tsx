"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Droplets, RefreshCw, PlusCircle, Wallet } from "lucide-react";
import { useFreighterWallet } from "../hooks/useFreighterWallet";
import { useAirdrop, type Campaign } from "../hooks/useAirdrop";
import CampaignCard from "./airdrop/CampaignCard";
import CampaignDetail from "./airdrop/CampaignDetail";
import CreateCampaignForm from "./airdrop/CreateCampaignForm";

type View = "list" | "create";

export default function AirdropDashboard() {
  const wallet = useFreighterWallet();
  const airdrop = useAirdrop();

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Campaign | null>(null);
  const [view, setView] = useState<View>("list");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    const result = await airdrop.listCampaigns({ status: statusFilter || undefined });
    if (result) {
      setCampaigns(result.items);
      setTotal(result.total);
    }
    setRefreshing(false);
  }, [airdrop, statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(data: Omit<Campaign, "id" | "claimedAmount" | "remainingAmount" | "claimCount" | "allowlistSize" | "createdAt">) {
    const created = await airdrop.createCampaign(data);
    if (created) {
      setView("list");
      await load();
      setSelected(created);
    }
  }

  async function handleClaim(campaignId: number, address: string) {
    await airdrop.claim(campaignId, address);
    await load();
  }

  async function handleEnd(campaignId: number, admin: string) {
    await airdrop.endCampaign(campaignId, admin);
    await load();
    setSelected(null);
  }

  async function handleAddAllowlist(campaignId: number, addresses: string[]) {
    await airdrop.addToAllowlist(campaignId, addresses);
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-4 sm:p-6">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-900/40 rounded-xl">
            <Droplets className="w-7 h-7 text-indigo-400" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Token Airdrop</h1>
            <p className="text-sm text-gray-400">{total} campaign{total !== 1 ? "s" : ""}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Wallet connect */}
          {wallet.status === "connected" ? (
            <div className="flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs">
              <Wallet className="w-3.5 h-3.5 text-green-400" aria-hidden="true" />
              <span className="text-gray-300 font-mono truncate max-w-[120px]">{wallet.address}</span>
            </div>
          ) : (
            <button
              onClick={wallet.connect}
              disabled={wallet.status === "connecting"}
              className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-sm px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              <Wallet className="w-4 h-4" aria-hidden="true" />
              {wallet.status === "connecting" ? "Connecting…" : "Connect Wallet"}
            </button>
          )}

          <button
            onClick={load}
            disabled={refreshing}
            aria-label="Refresh campaigns"
            className="p-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
          </button>

          <button
            onClick={() => setView(view === "create" ? "list" : "create")}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
          >
            <PlusCircle className="w-4 h-4" aria-hidden="true" />
            New Campaign
          </button>
        </div>
      </header>

      {/* Error banner */}
      {airdrop.error && (
        <div role="alert" className="mb-4 p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-400 text-sm">
          {airdrop.error}
        </div>
      )}

      {/* Create form */}
      {view === "create" && (
        <div className="mb-6 bg-gray-900 border border-gray-700 rounded-xl p-5">
          <CreateCampaignForm
            walletAddress={wallet.address}
            onSubmit={handleCreate}
            onCancel={() => setView("list")}
          />
        </div>
      )}

      {/* Main layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Campaign list */}
        <div className="lg:col-span-1 space-y-3">
          {/* Filter */}
          <div className="flex gap-2">
            {["", "active", "ended"].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                  statusFilter === s
                    ? "bg-indigo-600 border-indigo-500 text-white"
                    : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500"
                }`}
              >
                {s === "" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>

          {airdrop.loading && campaigns.length === 0 ? (
            <div className="text-center py-12 text-gray-500 text-sm">Loading…</div>
          ) : campaigns.length === 0 ? (
            <div className="text-center py-12 text-gray-500 text-sm">
              No campaigns yet.{" "}
              <button onClick={() => setView("create")} className="text-indigo-400 hover:underline">
                Create one
              </button>
            </div>
          ) : (
            campaigns.map((c) => (
              <CampaignCard
                key={c.id}
                campaign={c}
                selected={selected?.id === c.id}
                onSelect={setSelected}
              />
            ))
          )}
        </div>

        {/* Detail panel */}
        <div className="lg:col-span-2">
          {selected ? (
            <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
              <CampaignDetail
                campaign={selected}
                walletAddress={wallet.address}
                onClaim={handleClaim}
                onEnd={handleEnd}
                onAddAllowlist={handleAddAllowlist}
                getStats={airdrop.getStats}
                checkEligibility={airdrop.checkEligibility}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center h-64 bg-gray-900 border border-gray-700 rounded-xl text-gray-500 text-sm">
              Select a campaign to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
