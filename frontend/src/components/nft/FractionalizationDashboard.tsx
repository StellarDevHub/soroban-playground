"use client";

import React, { useState } from "react";
import {
  Layers,
  Lock,
  Unlock,
  Users,
  ArrowRightLeft,
  PlusCircle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type VaultStatus = "Active" | "BuyoutPending" | "Redeemed";

export interface Vault {
  id: number;
  depositor: string;
  nftContract: string;
  nftTokenId: number;
  metadataHash: string;
  totalShares: number;
  buyoutPrice: number;
  status: VaultStatus;
  createdAt: number;
  buyoutWinner: string | null;
}

export interface ShareHolding {
  vaultId: number;
  shares: number;
}

interface FractionalizationDashboardProps {
  contractId?: string;
  walletAddress?: string;
  vaults: Vault[];
  myHoldings: ShareHolding[];
  isLoading: boolean;
  onCreateVault: (params: {
    nftContract: string;
    nftTokenId: number;
    metadataHash: string;
    totalShares: number;
    buyoutPrice: number;
  }) => Promise<void>;
  onTransferShares: (params: {
    vaultId: number;
    to: string;
    amount: number;
  }) => Promise<void>;
  onInitiateBuyout: (vaultId: number) => Promise<void>;
  onRedeemShares: (vaultId: number) => Promise<void>;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function FractionalizationDashboard({
  contractId,
  walletAddress,
  vaults,
  myHoldings,
  isLoading,
  onCreateVault,
  onTransferShares,
  onInitiateBuyout,
  onRedeemShares,
}: FractionalizationDashboardProps) {
  const [tab, setTab] = useState<"vaults" | "portfolio" | "create">("vaults");
  const [expandedVault, setExpandedVault] = useState<number | null>(null);

  // Transfer form state
  const [transferVaultId, setTransferVaultId] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [transferAmount, setTransferAmount] = useState("");

  // Create vault form state
  const [nftContract, setNftContract] = useState("");
  const [nftTokenId, setNftTokenId] = useState("");
  const [metadataHash, setMetadataHash] = useState("");
  const [totalShares, setTotalShares] = useState("1000");
  const [buyoutPrice, setBuyoutPrice] = useState("");

  if (!contractId) {
    return (
      <div className="flex flex-col space-y-3 p-5 bg-gray-900 border border-gray-800 rounded-xl shadow-lg">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-widest flex items-center gap-2">
          <Layers size={16} className="text-indigo-400" />
          NFT Fractionalization
        </h3>
        <p className="text-xs text-gray-500 italic">
          Deploy the fractionalization contract to start fractionalizing NFTs.
        </p>
      </div>
    );
  }

  const activeVaults = vaults.filter((v) => v.status === "Active");
  const redeemedVaults = vaults.filter((v) => v.status === "Redeemed");

  const handleCreateVault = async () => {
    if (!nftContract || !nftTokenId || !metadataHash || !totalShares || !buyoutPrice) return;
    await onCreateVault({
      nftContract,
      nftTokenId: parseInt(nftTokenId),
      metadataHash,
      totalShares: parseInt(totalShares),
      buyoutPrice: parseFloat(buyoutPrice),
    });
    setNftContract("");
    setNftTokenId("");
    setMetadataHash("");
    setTotalShares("1000");
    setBuyoutPrice("");
  };

  const handleTransfer = async () => {
    if (!transferVaultId || !transferTo || !transferAmount) return;
    await onTransferShares({
      vaultId: parseInt(transferVaultId),
      to: transferTo,
      amount: parseInt(transferAmount),
    });
    setTransferVaultId("");
    setTransferTo("");
    setTransferAmount("");
  };

  return (
    <div className="flex flex-col space-y-4 p-5 bg-gray-900 border border-gray-800 rounded-xl shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-widest flex items-center gap-2">
          <Layers size={16} className="text-indigo-400" />
          NFT Fractionalization
        </h3>
        {walletAddress && (
          <span className="text-xs text-gray-500 font-mono">
            {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}
          </span>
        )}
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-2">
        <MiniStat label="Total Vaults" value={String(vaults.length)} color="indigo" />
        <MiniStat label="Active" value={String(activeVaults.length)} color="emerald" />
        <MiniStat label="Redeemed" value={String(redeemedVaults.length)} color="gray" />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-800 pb-2">
        {(["vaults", "portfolio", "create"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors capitalize ${
              tab === t
                ? "bg-indigo-600/20 text-indigo-300 border border-indigo-500/30"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {t === "portfolio" ? `Portfolio (${myHoldings.length})` : t === "vaults" ? `Vaults (${vaults.length})` : "New Vault"}
          </button>
        ))}
      </div>

      {/* Vaults tab */}
      {tab === "vaults" && (
        <div className="space-y-2">
          {vaults.length === 0 ? (
            <p className="text-xs text-gray-500 italic text-center py-6">
              No vaults yet. Create one to fractionalize an NFT.
            </p>
          ) : (
            vaults.map((vault) => (
              <VaultCard
                key={vault.id}
                vault={vault}
                walletAddress={walletAddress}
                isLoading={isLoading}
                expanded={expandedVault === vault.id}
                onToggle={() =>
                  setExpandedVault(expandedVault === vault.id ? null : vault.id)
                }
                onInitiateBuyout={onInitiateBuyout}
                onRedeemShares={onRedeemShares}
              />
            ))
          )}
        </div>
      )}

      {/* Portfolio tab */}
      {tab === "portfolio" && (
        <div className="space-y-4">
          {myHoldings.length === 0 ? (
            <p className="text-xs text-gray-500 italic text-center py-6">
              You don&apos;t hold any fractional shares yet.
            </p>
          ) : (
            <div className="space-y-2">
              {myHoldings.map((h) => {
                const vault = vaults.find((v) => v.id === h.vaultId);
                const pct = vault
                  ? ((h.shares / vault.totalShares) * 100).toFixed(1)
                  : "?";
                return (
                  <div
                    key={h.vaultId}
                    className="p-3 bg-gray-950/60 border border-gray-800 rounded-lg"
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-xs text-gray-300 font-mono">
                          Vault #{h.vaultId}
                        </p>
                        <p className="text-[10px] text-gray-500 mt-0.5">
                          {h.shares.toLocaleString()} shares · {pct}% ownership
                        </p>
                      </div>
                      <VaultStatusBadge status={vault?.status ?? "Active"} />
                    </div>
                    {/* Ownership bar */}
                    <div className="mt-2 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 transition-all"
                        style={{ width: `${Math.min(100, parseFloat(pct))}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Transfer shares */}
          <div className="p-3 bg-gray-950/60 border border-gray-800 rounded-lg space-y-2">
            <p className="text-xs font-medium text-gray-300 flex items-center gap-1.5">
              <ArrowRightLeft size={12} className="text-indigo-400" />
              Transfer Shares
            </p>
            <Field label="Vault ID">
              <input
                value={transferVaultId}
                onChange={(e) => setTransferVaultId(e.target.value)}
                placeholder="1"
                className={inputCls}
              />
            </Field>
            <Field label="Recipient Address">
              <input
                value={transferTo}
                onChange={(e) => setTransferTo(e.target.value)}
                placeholder="G..."
                className={inputCls}
              />
            </Field>
            <Field label="Amount">
              <input
                type="number"
                value={transferAmount}
                onChange={(e) => setTransferAmount(e.target.value)}
                placeholder="100"
                className={inputCls}
              />
            </Field>
            <button
              onClick={handleTransfer}
              disabled={isLoading || !transferVaultId || !transferTo || !transferAmount}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-800 disabled:text-gray-600 text-white transition-colors"
            >
              {isLoading ? (
                <RefreshCw size={12} className="animate-spin" />
              ) : (
                <ArrowRightLeft size={12} />
              )}
              Transfer Shares
            </button>
          </div>
        </div>
      )}

      {/* Create vault tab */}
      {tab === "create" && (
        <div className="space-y-3">
          <Field label="NFT Contract Address">
            <input
              value={nftContract}
              onChange={(e) => setNftContract(e.target.value)}
              placeholder="C..."
              className={inputCls}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="NFT Token ID">
              <input
                type="number"
                value={nftTokenId}
                onChange={(e) => setNftTokenId(e.target.value)}
                placeholder="1"
                className={inputCls}
              />
            </Field>
            <Field label="Total Shares">
              <input
                type="number"
                value={totalShares}
                onChange={(e) => setTotalShares(e.target.value)}
                placeholder="1000"
                className={inputCls}
              />
            </Field>
          </div>
          <Field label="Metadata Hash (IPFS CID or sha256)">
            <input
              value={metadataHash}
              onChange={(e) => setMetadataHash(e.target.value)}
              placeholder="Qm..."
              className={inputCls}
            />
          </Field>
          <Field label="Buyout Price (XLM)">
            <input
              type="number"
              value={buyoutPrice}
              onChange={(e) => setBuyoutPrice(e.target.value)}
              placeholder="10000"
              className={inputCls}
            />
          </Field>

          <div className="p-2 bg-indigo-900/20 border border-indigo-800/40 rounded text-[10px] text-indigo-300">
            <ShieldCheck size={10} className="inline mr-1" />
            NFT will be locked in vault custody. You receive all {totalShares || "N"} shares.
            A majority holder (≥51%) can trigger a buyout at the set price.
          </div>

          <button
            onClick={handleCreateVault}
            disabled={
              isLoading ||
              !nftContract ||
              !nftTokenId ||
              !metadataHash ||
              !totalShares ||
              !buyoutPrice
            }
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-800 disabled:text-gray-600 text-white transition-colors"
          >
            {isLoading ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              <PlusCircle size={14} />
            )}
            Create Vault &amp; Fractionalize
          </button>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function VaultCard({
  vault,
  walletAddress,
  isLoading,
  expanded,
  onToggle,
  onInitiateBuyout,
  onRedeemShares,
}: {
  vault: Vault;
  walletAddress?: string;
  isLoading: boolean;
  expanded: boolean;
  onToggle: () => void;
  onInitiateBuyout: (id: number) => Promise<void>;
  onRedeemShares: (id: number) => Promise<void>;
}) {
  return (
    <div className="border border-gray-800 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 text-left hover:bg-gray-800/40 transition-colors"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-1.5 bg-indigo-900/30 rounded">
            <Lock size={12} className="text-indigo-400" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-gray-200 font-mono">
              Vault #{vault.id}
            </p>
            <p className="text-[10px] text-gray-500 truncate">
              {vault.nftContract.slice(0, 8)}…{vault.nftContract.slice(-4)} · Token {vault.nftTokenId}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <VaultStatusBadge status={vault.status} />
          {expanded ? (
            <ChevronUp size={14} className="text-gray-500" />
          ) : (
            <ChevronDown size={14} className="text-gray-500" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-800 p-3 space-y-3 bg-gray-950/50">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <InfoRow label="Total Shares" value={vault.totalShares.toLocaleString()} />
            <InfoRow
              label="Buyout Price"
              value={`${vault.buyoutPrice.toLocaleString()} XLM`}
            />
            <InfoRow
              label="Depositor"
              value={`${vault.depositor.slice(0, 8)}…${vault.depositor.slice(-4)}`}
            />
            <InfoRow
              label="Created"
              value={new Date(vault.createdAt * 1000).toLocaleDateString()}
            />
          </div>

          {vault.buyoutWinner && (
            <div className="flex items-center gap-1.5 text-[10px] text-emerald-400">
              <Unlock size={10} />
              Redeemed by {vault.buyoutWinner.slice(0, 8)}…{vault.buyoutWinner.slice(-4)}
            </div>
          )}

          {vault.status === "Active" && (
            <div className="flex gap-2 pt-1 border-t border-gray-800">
              <button
                onClick={() => onInitiateBuyout(vault.id)}
                disabled={isLoading}
                className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/30 text-amber-300 text-xs rounded transition-colors"
              >
                <Wallet size={11} />
                Initiate Buyout
              </button>
            </div>
          )}

          {vault.status === "Redeemed" && (
            <button
              onClick={() => onRedeemShares(vault.id)}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-1 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 text-xs rounded transition-colors"
            >
              <Users size={11} />
              Redeem My Shares
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function VaultStatusBadge({ status }: { status: VaultStatus }) {
  const styles: Record<VaultStatus, string> = {
    Active: "bg-emerald-900/30 text-emerald-400 border-emerald-800/50",
    BuyoutPending: "bg-amber-900/30 text-amber-400 border-amber-800/50",
    Redeemed: "bg-gray-800 text-gray-500 border-gray-700",
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}

function MiniStat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: "indigo" | "emerald" | "gray";
}) {
  const colorMap = {
    indigo: "text-indigo-400",
    emerald: "text-emerald-400",
    gray: "text-gray-500",
  };
  return (
    <div className="p-2 bg-gray-950/60 border border-gray-800 rounded-lg text-center">
      <p className={`text-sm font-bold font-mono ${colorMap[color]}`}>{value}</p>
      <p className="text-[10px] text-gray-600 mt-0.5">{label}</p>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</p>
      <p className="text-xs text-gray-300 font-mono truncate">{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">
        {label}
      </label>
      {children}
    </div>
  );
}

const inputCls =
  "w-full bg-gray-950 border border-gray-800 rounded-md py-1.5 px-2 text-xs text-gray-200 focus:outline-none focus:border-indigo-500 font-mono";
