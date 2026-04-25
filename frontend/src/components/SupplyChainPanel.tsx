"use client";

import React, { useState } from "react";
import { Package, MapPin, ShieldCheck, AlertTriangle, Plus, CheckCircle, XCircle, Clock } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ProductStatus =
  | "Registered"
  | "InTransit"
  | "AtWarehouse"
  | "QualityCheck"
  | "Approved"
  | "Rejected"
  | "Delivered"
  | "Recalled";

export type QualityResult = "Pass" | "Fail" | "Pending";

export interface ProductData {
  id: number;
  owner: string;
  name: string;
  metadataHash: number;
  status: ProductStatus;
  createdAt: number;
  checkpointCount: number;
}

export interface CheckpointData {
  productId: number;
  index: number;
  handler: string;
  locationHash: number;
  timestamp: number;
}

export interface QualityReportData {
  productId: number;
  inspector: string;
  result: QualityResult;
  reportHash: number;
  timestamp: number;
}

interface Props {
  contractId?: string;
  walletAddress?: string;
  products: ProductData[];
  isLoading: boolean;
  onRegisterProduct: (name: string, metadataHash: number) => Promise<void>;
  onAddCheckpoint: (productId: number, locationHash: number, notesHash: number) => Promise<void>;
  onSubmitQualityReport: (productId: number, result: QualityResult, reportHash: number) => Promise<void>;
  onRecallProduct: (productId: number) => Promise<void>;
  onUpdateStatus: (productId: number, status: ProductStatus) => Promise<void>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<ProductStatus, string> = {
  Registered: "text-slate-300",
  InTransit: "text-cyan-300",
  AtWarehouse: "text-blue-300",
  QualityCheck: "text-amber-300",
  Approved: "text-emerald-300",
  Rejected: "text-rose-300",
  Delivered: "text-teal-300",
  Recalled: "text-red-400",
};

const STATUS_ICON: Record<ProductStatus, React.ReactNode> = {
  Registered: <Package size={10} />,
  InTransit: <MapPin size={10} />,
  AtWarehouse: <Package size={10} />,
  QualityCheck: <ShieldCheck size={10} />,
  Approved: <CheckCircle size={10} />,
  Rejected: <XCircle size={10} />,
  Delivered: <CheckCircle size={10} />,
  Recalled: <AlertTriangle size={10} />,
};

function short(addr: string) {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SupplyChainPanel({
  contractId,
  walletAddress,
  products,
  isLoading,
  onRegisterProduct,
  onAddCheckpoint,
  onSubmitQualityReport,
  onRecallProduct,
  onUpdateStatus,
}: Props) {
  const [tab, setTab] = useState<"products" | "register" | "checkpoint" | "quality">("products");

  // Register form
  const [regName, setRegName] = useState("");
  const [regHash, setRegHash] = useState("");

  // Checkpoint form
  const [cpProductId, setCpProductId] = useState("");
  const [cpLocation, setCpLocation] = useState("");
  const [cpNotes, setCpNotes] = useState("");

  // Quality form
  const [qaProductId, setQaProductId] = useState("");
  const [qaResult, setQaResult] = useState<QualityResult>("Pass");
  const [qaHash, setQaHash] = useState("");

  const disabled = !contractId || isLoading;

  const handleRegister = async () => {
    if (!regName.trim()) return;
    await onRegisterProduct(regName.trim(), parseInt(regHash) || 0);
    setRegName("");
    setRegHash("");
  };

  const handleCheckpoint = async () => {
    if (!cpProductId) return;
    await onAddCheckpoint(parseInt(cpProductId), parseInt(cpLocation) || 0, parseInt(cpNotes) || 0);
    setCpProductId("");
    setCpLocation("");
    setCpNotes("");
  };

  const handleQuality = async () => {
    if (!qaProductId) return;
    await onSubmitQualityReport(parseInt(qaProductId), qaResult, parseInt(qaHash) || 0);
    setQaProductId("");
    setQaHash("");
  };

  const TABS = [
    { key: "products", label: "Products" },
    { key: "register", label: "Register" },
    { key: "checkpoint", label: "Checkpoint" },
    { key: "quality", label: "QA Report" },
  ] as const;

  return (
    <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
          <Package size={14} />
          Supply Chain
        </p>
        <span className="text-xs text-slate-500">{products.length} products</span>
      </div>

      {!contractId && (
        <p className="mb-3 rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
          Deploy a contract to use supply chain tracking.
        </p>
      )}

      {/* Tabs */}
      <div className="mb-3 flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-2 py-1 text-[11px] font-medium transition ${
              tab === t.key
                ? "bg-cyan-400/20 text-cyan-200"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Products list */}
      {tab === "products" && (
        <div className="space-y-2">
          {products.length === 0 && (
            <p className="text-xs text-slate-500">No products registered yet.</p>
          )}
          {products.map((p) => (
            <div
              key={p.id}
              className="rounded-xl border border-white/8 bg-slate-950/50 px-3 py-2 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-100">
                  #{p.id} {p.name}
                </span>
                <span className={`flex items-center gap-1 ${STATUS_COLOR[p.status]}`}>
                  {STATUS_ICON[p.status]}
                  {p.status}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between text-slate-500">
                <span>Owner: {short(p.owner)}</span>
                <span>{p.checkpointCount} checkpoints</span>
              </div>
              {p.status !== "Recalled" && (
                <div className="mt-2 flex gap-2">
                  <button
                    disabled={disabled}
                    onClick={() => onUpdateStatus(p.id, "Delivered")}
                    className="rounded-lg border border-teal-400/30 bg-teal-400/10 px-2 py-1 text-[10px] text-teal-200 transition hover:bg-teal-400/20 disabled:opacity-40"
                  >
                    Mark Delivered
                  </button>
                  <button
                    disabled={disabled}
                    onClick={() => onRecallProduct(p.id)}
                    className="rounded-lg border border-red-400/30 bg-red-400/10 px-2 py-1 text-[10px] text-red-300 transition hover:bg-red-400/20 disabled:opacity-40"
                  >
                    Recall
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Register product */}
      {tab === "register" && (
        <div className="space-y-2">
          <input
            value={regName}
            onChange={(e) => setRegName(e.target.value)}
            placeholder="Product name"
            className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-slate-200 outline-none placeholder:text-slate-600"
          />
          <input
            value={regHash}
            onChange={(e) => setRegHash(e.target.value)}
            placeholder="Metadata hash (number)"
            type="number"
            className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-slate-200 outline-none placeholder:text-slate-600"
          />
          <button
            disabled={disabled || !regName.trim()}
            onClick={handleRegister}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-400/30 bg-cyan-400/10 py-2 text-xs font-medium text-cyan-200 transition hover:bg-cyan-400/20 disabled:opacity-40"
          >
            <Plus size={12} />
            Register Product
          </button>
        </div>
      )}

      {/* Add checkpoint */}
      {tab === "checkpoint" && (
        <div className="space-y-2">
          <input
            value={cpProductId}
            onChange={(e) => setCpProductId(e.target.value)}
            placeholder="Product ID"
            type="number"
            className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-slate-200 outline-none placeholder:text-slate-600"
          />
          <input
            value={cpLocation}
            onChange={(e) => setCpLocation(e.target.value)}
            placeholder="Location hash"
            type="number"
            className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-slate-200 outline-none placeholder:text-slate-600"
          />
          <input
            value={cpNotes}
            onChange={(e) => setCpNotes(e.target.value)}
            placeholder="Notes hash"
            type="number"
            className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-slate-200 outline-none placeholder:text-slate-600"
          />
          <button
            disabled={disabled || !cpProductId}
            onClick={handleCheckpoint}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-blue-400/30 bg-blue-400/10 py-2 text-xs font-medium text-blue-200 transition hover:bg-blue-400/20 disabled:opacity-40"
          >
            <MapPin size={12} />
            Add Checkpoint
          </button>
        </div>
      )}

      {/* Quality report */}
      {tab === "quality" && (
        <div className="space-y-2">
          <input
            value={qaProductId}
            onChange={(e) => setQaProductId(e.target.value)}
            placeholder="Product ID"
            type="number"
            className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-slate-200 outline-none placeholder:text-slate-600"
          />
          <select
            value={qaResult}
            onChange={(e) => setQaResult(e.target.value as QualityResult)}
            className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-slate-200 outline-none"
          >
            <option value="Pass">Pass</option>
            <option value="Fail">Fail</option>
            <option value="Pending">Pending</option>
          </select>
          <input
            value={qaHash}
            onChange={(e) => setQaHash(e.target.value)}
            placeholder="Report hash"
            type="number"
            className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-slate-200 outline-none placeholder:text-slate-600"
          />
          <button
            disabled={disabled || !qaProductId}
            onClick={handleQuality}
            className={`flex w-full items-center justify-center gap-2 rounded-xl border py-2 text-xs font-medium transition disabled:opacity-40 ${
              qaResult === "Pass"
                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20"
                : qaResult === "Fail"
                  ? "border-rose-400/30 bg-rose-400/10 text-rose-200 hover:bg-rose-400/20"
                  : "border-amber-400/30 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20"
            }`}
          >
            {qaResult === "Pass" ? (
              <CheckCircle size={12} />
            ) : qaResult === "Fail" ? (
              <XCircle size={12} />
            ) : (
              <Clock size={12} />
            )}
            Submit QA Report
          </button>
        </div>
      )}

      {isLoading && (
        <p className="mt-2 text-center text-xs text-slate-500">Processing…</p>
      )}
    </div>
  );
}
