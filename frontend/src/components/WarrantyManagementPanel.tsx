"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Package,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  Shield,
  XCircle,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Product {
  id: number;
  manufacturer: string;
  name: string;
  warrantyDurationSecs: number;
  isActive: boolean;
}

export interface Warranty {
  id: number;
  productId: number;
  owner: string;
  purchaseTs: number;
  expiryTs: number;
  isActive: boolean;
  serialNumber: string;
}

export interface Claim {
  id: number;
  warrantyId: number;
  claimant: string;
  description: string;
  status: "Pending" | "Approved" | "Rejected";
  filedTs: number;
  resolvedTs: number;
}

// ── API client ────────────────────────────────────────────────────────────────

const API_BASE = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5000"
).replace(/\/$/, "");

async function apiPost(path: string, body: unknown) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? "Request failed");
  return data;
}

async function apiPatch(path: string, body: unknown) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? "Request failed");
  return data;
}

async function apiGet(path: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${API_BASE}${path}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? "Request failed");
  return data;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTs(ts: number): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString();
}

function durationLabel(secs: number): string {
  const days = Math.round(secs / 86400);
  if (days >= 365) return `${Math.round(days / 365)}yr`;
  if (days >= 30) return `${Math.round(days / 30)}mo`;
  return `${days}d`;
}

const STATUS_STYLES: Record<string, string> = {
  Pending: "bg-yellow-900/40 text-yellow-300 border border-yellow-700",
  Approved: "bg-green-900/40 text-green-300 border border-green-700",
  Rejected: "bg-red-900/40 text-red-300 border border-red-700",
};

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[status] ?? "bg-gray-700 text-gray-300"}`}>
      {status}
    </span>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 flex items-center gap-3">
      <div className="text-indigo-400">{icon}</div>
      <div>
        <p className="text-xs text-gray-400">{label}</p>
        <p className="text-lg font-bold text-white">{value}</p>
      </div>
    </div>
  );
}

function ErrorMsg({ msg }: { msg: string }) {
  return (
    <p className="text-xs text-red-400 mt-1 flex items-center gap-1" role="alert">
      <AlertTriangle size={12} /> {msg}
    </p>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <h3 className="text-sm font-semibold text-gray-200 border-b border-gray-700 pb-1 mb-3">
      {title}
    </h3>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export interface WarrantyManagementPanelProps {
  contractId: string;
  walletAddress?: string;
  network?: string;
}

type Tab = "products" | "warranties" | "claims";

export default function WarrantyManagementPanel({
  contractId,
  walletAddress = "",
  network = "testnet",
}: WarrantyManagementPanelProps) {
  const [tab, setTab] = useState<Tab>("products");
  const [paused, setPaused] = useState(false);
  const [productCount, setProductCount] = useState(0);
  const [warrantyCount, setWarrantyCount] = useState(0);
  const [claimCount, setClaimCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  // ── Toast helper ────────────────────────────────────────────────────────────
  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // ── Fetch stats ─────────────────────────────────────────────────────────────
  const refreshStats = useCallback(async () => {
    if (!contractId) return;
    setLoading(true);
    try {
      const params = { contractId, network };
      const [s, pc, wc, cc] = await Promise.all([
        apiGet("/api/warranty/status", params),
        apiGet("/api/warranty/products/count", params),
        apiGet("/api/warranty/warranties/count", params),
        apiGet("/api/warranty/claims/count", params),
      ]);
      setPaused(s.paused ?? false);
      setProductCount(pc.count ?? 0);
      setWarrantyCount(wc.count ?? 0);
      setClaimCount(cc.count ?? 0);
    } catch (e: unknown) {
      showToast((e as Error).message, false);
    } finally {
      setLoading(false);
    }
  }, [contractId, network, showToast]);

  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  // ── Pause / Unpause ─────────────────────────────────────────────────────────
  async function togglePause() {
    if (!walletAddress) return showToast("Wallet address required", false);
    try {
      const fn = paused ? "unpause" : "pause";
      await apiPost(`/api/warranty/${fn}`, {
        contractId,
        admin: walletAddress,
        network,
      });
      showToast(paused ? "Contract unpaused" : "Contract paused");
      await refreshStats();
    } catch (e: unknown) {
      showToast((e as Error).message, false);
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "products", label: "Products" },
    { id: "warranties", label: "Warranties" },
    { id: "claims", label: "Claims" },
  ];

  return (
    <div className="space-y-4">
      {/* Toast */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${
            toast.ok
              ? "bg-green-900/60 text-green-300 border border-green-700"
              : "bg-red-900/60 text-red-300 border border-red-700"
          }`}
        >
          {toast.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
          {toast.msg}
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Products" value={productCount} icon={<Package size={18} />} />
        <StatCard label="Warranties" value={warrantyCount} icon={<Shield size={18} />} />
        <StatCard label="Claims" value={claimCount} icon={<Clock size={18} />} />
        <StatCard
          label="Status"
          value={paused ? "Paused" : "Active"}
          icon={paused ? <PauseCircle size={18} className="text-yellow-400" /> : <PlayCircle size={18} className="text-green-400" />}
        />
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={refreshStats}
          disabled={loading}
          aria-label="Refresh stats"
          className="p-2 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
        {walletAddress && (
          <button
            onClick={togglePause}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              paused
                ? "bg-green-700 hover:bg-green-600 text-white"
                : "bg-yellow-700 hover:bg-yellow-600 text-white"
            }`}
          >
            {paused ? <PlayCircle size={13} /> : <PauseCircle size={13} />}
            {paused ? "Unpause" : "Pause"}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-700">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? "border-b-2 border-indigo-500 text-indigo-400"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "products" && (
        <ProductsTab
          contractId={contractId}
          walletAddress={walletAddress}
          network={network}
          onRefresh={refreshStats}
          showToast={showToast}
        />
      )}
      {tab === "warranties" && (
        <WarrantiesTab
          contractId={contractId}
          walletAddress={walletAddress}
          network={network}
          showToast={showToast}
        />
      )}
      {tab === "claims" && (
        <ClaimsTab
          contractId={contractId}
          walletAddress={walletAddress}
          network={network}
          showToast={showToast}
        />
      )}
    </div>
  );
}

// ── ProductsTab ───────────────────────────────────────────────────────────────

interface TabProps {
  contractId: string;
  walletAddress: string;
  network: string;
  showToast: (msg: string, ok?: boolean) => void;
  onRefresh?: () => void;
}

function ProductsTab({ contractId, walletAddress, network, showToast, onRefresh }: TabProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [lookupId, setLookupId] = useState("");
  const [form, setForm] = useState({ manufacturer: walletAddress, name: "", durationDays: "365" });
  const [formErr, setFormErr] = useState<Partial<typeof form>>({});
  const [submitting, setSubmitting] = useState(false);

  const lookup = useCallback(async () => {
    const id = Number(lookupId);
    if (!id) return showToast("Enter a valid product ID", false);
    setLoading(true);
    try {
      const data = await apiGet(`/api/warranty/products/${id}`, { contractId, network });
      setProducts([{ id, ...data.product }]);
    } catch (e: unknown) {
      showToast((e as Error).message, false);
    } finally {
      setLoading(false);
    }
  }, [lookupId, contractId, network, showToast]);

  function validate() {
    const errs: Partial<typeof form> = {};
    if (!form.manufacturer) errs.manufacturer = "Required";
    if (!form.name.trim()) errs.name = "Required";
    const d = Number(form.durationDays);
    if (!d || d <= 0) errs.durationDays = "Must be > 0";
    setFormErr(errs);
    return Object.keys(errs).length === 0;
  }

  async function registerProduct(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      const data = await apiPost("/api/warranty/products", {
        contractId,
        manufacturer: form.manufacturer,
        name: form.name.trim(),
        warrantyDurationSecs: Number(form.durationDays) * 86400,
        network,
      });
      showToast(`Product registered (ID: ${data.productId})`);
      setForm((f) => ({ ...f, name: "" }));
      onRefresh?.();
    } catch (e: unknown) {
      showToast((e as Error).message, false);
    } finally {
      setSubmitting(false);
    }
  }

  async function deactivate(productId: number) {
    if (!walletAddress) return showToast("Wallet address required", false);
    try {
      await apiPatch(`/api/warranty/products/${productId}/deactivate`, {
        contractId,
        caller: walletAddress,
        network,
      });
      showToast("Product deactivated");
      setProducts((ps) => ps.map((p) => (p.id === productId ? { ...p, isActive: false } : p)));
    } catch (e: unknown) {
      showToast((e as Error).message, false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Register form */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <SectionHeader title="Register Product" />
        <form onSubmit={registerProduct} className="space-y-3" noValidate>
          <div>
            <label className="block text-xs text-gray-400 mb-1" htmlFor="prod-manufacturer">
              Manufacturer Address
            </label>
            <input
              id="prod-manufacturer"
              value={form.manufacturer}
              onChange={(e) => setForm((f) => ({ ...f, manufacturer: e.target.value }))}
              placeholder="G…"
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
            />
            {formErr.manufacturer && <ErrorMsg msg={formErr.manufacturer} />}
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1" htmlFor="prod-name">
              Product Name
            </label>
            <input
              id="prod-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Widget Pro 3000"
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
            />
            {formErr.name && <ErrorMsg msg={formErr.name} />}
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1" htmlFor="prod-duration">
              Warranty Duration (days)
            </label>
            <input
              id="prod-duration"
              type="number"
              min={1}
              value={form.durationDays}
              onChange={(e) => setForm((f) => ({ ...f, durationDays: e.target.value }))}
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
            />
            {formErr.durationDays && <ErrorMsg msg={formErr.durationDays} />}
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded transition-colors"
          >
            <Plus size={14} /> {submitting ? "Registering…" : "Register Product"}
          </button>
        </form>
      </div>

      {/* Lookup */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <SectionHeader title="Look Up Product" />
        <div className="flex gap-2">
          <input
            value={lookupId}
            onChange={(e) => setLookupId(e.target.value)}
            placeholder="Product ID"
            type="number"
            min={1}
            className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
          />
          <button
            onClick={lookup}
            disabled={loading}
            className="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 text-white text-sm rounded transition-colors disabled:opacity-50"
          >
            {loading ? <RefreshCw size={14} className="animate-spin" /> : "Fetch"}
          </button>
        </div>
      </div>

      {/* Results */}
      {products.length > 0 && (
        <div className="space-y-2">
          {products.map((p) => (
            <div key={p.id} className="bg-gray-800 border border-gray-700 rounded-lg p-3 flex items-start justify-between gap-3">
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-white">
                  #{p.id} — {p.name}
                </p>
                <p className="text-xs text-gray-400 truncate max-w-xs">{p.manufacturer}</p>
                <p className="text-xs text-gray-400">
                  Duration: {durationLabel(p.warrantyDurationSecs)}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <StatusBadge status={p.isActive ? "Active" : "Inactive"} />
                {p.isActive && walletAddress && (
                  <button
                    onClick={() => deactivate(p.id)}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors"
                  >
                    Deactivate
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── WarrantiesTab ─────────────────────────────────────────────────────────────

function WarrantiesTab({ contractId, walletAddress, network, showToast }: TabProps) {
  const [warranties, setWarranties] = useState<Warranty[]>([]);
  const [loading, setLoading] = useState(false);
  const [lookupId, setLookupId] = useState("");
  const [form, setForm] = useState({
    issuer: walletAddress,
    productId: "",
    owner: "",
    serialNumber: "",
  });
  const [formErr, setFormErr] = useState<Partial<typeof form>>({});
  const [submitting, setSubmitting] = useState(false);

  const lookup = useCallback(async () => {
    const id = Number(lookupId);
    if (!id) return showToast("Enter a valid warranty ID", false);
    setLoading(true);
    try {
      const data = await apiGet(`/api/warranty/warranties/${id}`, { contractId, network });
      setWarranties([{ id, ...data.warranty }]);
    } catch (e: unknown) {
      showToast((e as Error).message, false);
    } finally {
      setLoading(false);
    }
  }, [lookupId, contractId, network, showToast]);

  function validate() {
    const errs: Partial<typeof form> = {};
    if (!form.issuer) errs.issuer = "Required";
    if (!form.productId || Number(form.productId) < 1) errs.productId = "Must be ≥ 1";
    if (!form.owner) errs.owner = "Required";
    if (!form.serialNumber.trim()) errs.serialNumber = "Required";
    setFormErr(errs);
    return Object.keys(errs).length === 0;
  }

  async function issueWarranty(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      const data = await apiPost("/api/warranty/warranties", {
        contractId,
        issuer: form.issuer,
        productId: Number(form.productId),
        owner: form.owner,
        serialNumber: form.serialNumber.trim(),
        network,
      });
      showToast(`Warranty issued (ID: ${data.warrantyId})`);
      setForm((f) => ({ ...f, owner: "", serialNumber: "" }));
    } catch (e: unknown) {
      showToast((e as Error).message, false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Issue form */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <SectionHeader title="Issue Warranty" />
        <form onSubmit={issueWarranty} className="space-y-3" noValidate>
          <div>
            <label className="block text-xs text-gray-400 mb-1" htmlFor="war-issuer">
              Issuer Address (manufacturer or admin)
            </label>
            <input
              id="war-issuer"
              value={form.issuer}
              onChange={(e) => setForm((f) => ({ ...f, issuer: e.target.value }))}
              placeholder="G…"
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
            />
            {formErr.issuer && <ErrorMsg msg={formErr.issuer} />}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1" htmlFor="war-product">
                Product ID
              </label>
              <input
                id="war-product"
                type="number"
                min={1}
                value={form.productId}
                onChange={(e) => setForm((f) => ({ ...f, productId: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
              {formErr.productId && <ErrorMsg msg={formErr.productId} />}
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1" htmlFor="war-serial">
                Serial Number
              </label>
              <input
                id="war-serial"
                value={form.serialNumber}
                onChange={(e) => setForm((f) => ({ ...f, serialNumber: e.target.value }))}
                placeholder="SN-001"
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
              />
              {formErr.serialNumber && <ErrorMsg msg={formErr.serialNumber} />}
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1" htmlFor="war-owner">
              Buyer / Owner Address
            </label>
            <input
              id="war-owner"
              value={form.owner}
              onChange={(e) => setForm((f) => ({ ...f, owner: e.target.value }))}
              placeholder="G…"
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
            />
            {formErr.owner && <ErrorMsg msg={formErr.owner} />}
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded transition-colors"
          >
            <Shield size={14} /> {submitting ? "Issuing…" : "Issue Warranty"}
          </button>
        </form>
      </div>

      {/* Lookup */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <SectionHeader title="Look Up Warranty" />
        <div className="flex gap-2">
          <input
            value={lookupId}
            onChange={(e) => setLookupId(e.target.value)}
            placeholder="Warranty ID"
            type="number"
            min={1}
            className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
          />
          <button
            onClick={lookup}
            disabled={loading}
            className="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 text-white text-sm rounded transition-colors disabled:opacity-50"
          >
            {loading ? <RefreshCw size={14} className="animate-spin" /> : "Fetch"}
          </button>
        </div>
      </div>

      {/* Results */}
      {warranties.length > 0 && (
        <div className="space-y-2">
          {warranties.map((w) => (
            <div key={w.id} className="bg-gray-800 border border-gray-700 rounded-lg p-3 space-y-1">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-white">
                  Warranty #{w.id} — Product #{w.productId}
                </p>
                <StatusBadge status={w.isActive ? "Active" : "Inactive"} />
              </div>
              <p className="text-xs text-gray-400">Serial: {w.serialNumber}</p>
              <p className="text-xs text-gray-400 truncate">Owner: {w.owner}</p>
              <p className="text-xs text-gray-400">
                Purchased: {formatTs(w.purchaseTs)} · Expires: {formatTs(w.expiryTs)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── ClaimsTab ─────────────────────────────────────────────────────────────────

function ClaimsTab({ contractId, walletAddress, network, showToast }: TabProps) {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(false);
  const [lookupId, setLookupId] = useState("");
  const [form, setForm] = useState({ claimant: walletAddress, warrantyId: "", description: "" });
  const [formErr, setFormErr] = useState<Partial<typeof form>>({});
  const [submitting, setSubmitting] = useState(false);
  const [resolving, setResolving] = useState<number | null>(null);

  const lookup = useCallback(async () => {
    const id = Number(lookupId);
    if (!id) return showToast("Enter a valid claim ID", false);
    setLoading(true);
    try {
      const data = await apiGet(`/api/warranty/claims/${id}`, { contractId, network });
      setClaims([{ id, ...data.claim }]);
    } catch (e: unknown) {
      showToast((e as Error).message, false);
    } finally {
      setLoading(false);
    }
  }, [lookupId, contractId, network, showToast]);

  function validate() {
    const errs: Partial<typeof form> = {};
    if (!form.claimant) errs.claimant = "Required";
    if (!form.warrantyId || Number(form.warrantyId) < 1) errs.warrantyId = "Must be ≥ 1";
    if (!form.description.trim()) errs.description = "Required";
    setFormErr(errs);
    return Object.keys(errs).length === 0;
  }

  async function fileClaim(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      const data = await apiPost("/api/warranty/claims", {
        contractId,
        claimant: form.claimant,
        warrantyId: Number(form.warrantyId),
        description: form.description.trim(),
        network,
      });
      showToast(`Claim filed (ID: ${data.claimId})`);
      setForm((f) => ({ ...f, description: "" }));
    } catch (e: unknown) {
      showToast((e as Error).message, false);
    } finally {
      setSubmitting(false);
    }
  }

  async function resolveClaim(claimId: number, approve: boolean) {
    if (!walletAddress) return showToast("Wallet address required", false);
    setResolving(claimId);
    try {
      await apiPatch(`/api/warranty/claims/${claimId}/resolve`, {
        contractId,
        resolver: walletAddress,
        approve,
        network,
      });
      showToast(approve ? "Claim approved" : "Claim rejected");
      setClaims((cs) =>
        cs.map((c) =>
          c.id === claimId ? { ...c, status: approve ? "Approved" : "Rejected" } : c
        )
      );
    } catch (e: unknown) {
      showToast((e as Error).message, false);
    } finally {
      setResolving(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* File claim form */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <SectionHeader title="File a Claim" />
        <form onSubmit={fileClaim} className="space-y-3" noValidate>
          <div>
            <label className="block text-xs text-gray-400 mb-1" htmlFor="clm-claimant">
              Claimant Address (warranty owner)
            </label>
            <input
              id="clm-claimant"
              value={form.claimant}
              onChange={(e) => setForm((f) => ({ ...f, claimant: e.target.value }))}
              placeholder="G…"
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
            />
            {formErr.claimant && <ErrorMsg msg={formErr.claimant} />}
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1" htmlFor="clm-warranty">
              Warranty ID
            </label>
            <input
              id="clm-warranty"
              type="number"
              min={1}
              value={form.warrantyId}
              onChange={(e) => setForm((f) => ({ ...f, warrantyId: e.target.value }))}
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
            />
            {formErr.warrantyId && <ErrorMsg msg={formErr.warrantyId} />}
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1" htmlFor="clm-desc">
              Description
            </label>
            <textarea
              id="clm-desc"
              rows={3}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Describe the defect or issue…"
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none"
            />
            {formErr.description && <ErrorMsg msg={formErr.description} />}
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded transition-colors"
          >
            <Plus size={14} /> {submitting ? "Filing…" : "File Claim"}
          </button>
        </form>
      </div>

      {/* Lookup */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <SectionHeader title="Look Up Claim" />
        <div className="flex gap-2">
          <input
            value={lookupId}
            onChange={(e) => setLookupId(e.target.value)}
            placeholder="Claim ID"
            type="number"
            min={1}
            className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
          />
          <button
            onClick={lookup}
            disabled={loading}
            className="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 text-white text-sm rounded transition-colors disabled:opacity-50"
          >
            {loading ? <RefreshCw size={14} className="animate-spin" /> : "Fetch"}
          </button>
        </div>
      </div>

      {/* Results */}
      {claims.length > 0 && (
        <div className="space-y-2">
          {claims.map((c) => (
            <div key={c.id} className="bg-gray-800 border border-gray-700 rounded-lg p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-white">
                    Claim #{c.id} — Warranty #{c.warrantyId}
                  </p>
                  <p className="text-xs text-gray-400 truncate max-w-xs">{c.claimant}</p>
                </div>
                <StatusBadge status={c.status} />
              </div>
              <p className="text-xs text-gray-300 bg-gray-700/50 rounded p-2">{c.description}</p>
              <p className="text-xs text-gray-400">
                Filed: {formatTs(c.filedTs)}
                {c.resolvedTs ? ` · Resolved: ${formatTs(c.resolvedTs)}` : ""}
              </p>
              {c.status === "Pending" && walletAddress && (
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => resolveClaim(c.id, true)}
                    disabled={resolving === c.id}
                    className="flex items-center gap-1 px-3 py-1 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-xs rounded transition-colors"
                  >
                    <CheckCircle2 size={12} /> Approve
                  </button>
                  <button
                    onClick={() => resolveClaim(c.id, false)}
                    disabled={resolving === c.id}
                    className="flex items-center gap-1 px-3 py-1 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-xs rounded transition-colors"
                  >
                    <XCircle size={12} /> Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
