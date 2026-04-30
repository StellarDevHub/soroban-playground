"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, CheckCircle2, ClipboardList, Package,
  PauseCircle, PlayCircle, Plus, RefreshCw, Shield, XCircle,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Product { id: number; name: string; manufacturer: string; defaultWarrantySecs: number; isActive: boolean; }
export interface Warranty { id: number; productId: number; owner: string; issuedAt: number; expiresAt: number; isActive: boolean; }
export interface Claim { id: number; warrantyId: number; claimant: string; description: string; filedAt: number; status: "Pending" | "Approved" | "Rejected"; }

// ── API ───────────────────────────────────────────────────────────────────────

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5000").replace(/\/$/, "");

async function apiPost(path: string, body: unknown) {
  const res = await fetch(`${API_BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? "Request failed");
  return data;
}
async function apiGet(path: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}${path}${qs ? `?${qs}` : ""}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? "Request failed");
  return data;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function secsToLabel(s: number) {
  const d = Math.floor(s / 86400);
  return d >= 365 ? `${Math.floor(d / 365)}y` : d >= 30 ? `${Math.floor(d / 30)}mo` : `${d}d`;
}
function tsToDate(ts: number) { return new Date(ts * 1000).toLocaleDateString(); }

// ── Shared UI ─────────────────────────────────────────────────────────────────

function Err({ msg, onDismiss }: { msg: string; onDismiss: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><span className="flex-1">{msg}</span>
      <button onClick={onDismiss} aria-label="Dismiss" className="text-red-400 hover:text-red-600">✕</button>
    </div>
  );
}
function Ok({ msg, onDismiss }: { msg: string; onDismiss: () => void }) {
  return (
    <div role="status" className="flex items-start gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 text-sm">
      <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /><span className="flex-1">{msg}</span>
      <button onClick={onDismiss} aria-label="Dismiss" className="text-green-400 hover:text-green-600">✕</button>
    </div>
  );
}

function StatusBadge({ status }: { status: Claim["status"] }) {
  const map = { Pending: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400", Approved: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400", Rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" };
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${map[status]}`}>{status}</span>;
}

// ── ClaimRow ──────────────────────────────────────────────────────────────────

function ClaimRow({ claim, contractId, adminAddress, onRefresh }: { claim: Claim; contractId: string; adminAddress: string; onRefresh: () => void; }) {
  const [loading, setLoading] = useState(false);
  async function process(approve: boolean) {
    setLoading(true);
    try { await apiPost(`/api/warranty/claims/${claim.id}/process`, { contractId, admin: adminAddress, approve }); onRefresh(); }
    catch { /* handled by parent */ }
    finally { setLoading(false); }
  }
  return (
    <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-sm font-medium text-slate-900 dark:text-white">Claim #{claim.id} — Warranty #{claim.warrantyId}</span>
        <StatusBadge status={claim.status} />
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-2 truncate">{claim.description}</p>
      <div className="text-xs text-slate-400 mb-2">Filed: {tsToDate(claim.filedAt)}</div>
      {claim.status === "Pending" && adminAddress && (
        <div className="flex gap-2">
          <button onClick={() => process(true)} disabled={loading}
            className="flex items-center gap-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-3 py-1 rounded text-xs font-medium transition-colors">
            <CheckCircle2 className="w-3 h-3" /> Approve
          </button>
          <button onClick={() => process(false)} disabled={loading}
            className="flex items-center gap-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-3 py-1 rounded text-xs font-medium transition-colors">
            <XCircle className="w-3 h-3" /> Reject
          </button>
        </div>
      )}
    </div>
  );
}

// ── FileClaimForm ─────────────────────────────────────────────────────────────

function FileClaimForm({ contractId, userAddress, warranties, onCreated }: { contractId: string; userAddress: string; warranties: Warranty[]; onCreated: () => void; }) {
  const [warrantyId, setWarrantyId] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(""); const [ok, setOk] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setOk("");
    if (!warrantyId) return setErr("Select a warranty");
    if (!description.trim()) return setErr("Description is required");
    setLoading(true);
    try {
      const d = await apiPost("/api/warranty/claims", { contractId, claimant: userAddress, warrantyId: parseInt(warrantyId, 10), description: description.trim() });
      setOk(`Claim #${d.claimId} filed`); setDescription(""); onCreated();
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setLoading(false); }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3" aria-label="File warranty claim">
      {err && <Err msg={err} onDismiss={() => setErr("")} />}
      {ok && <Ok msg={ok} onDismiss={() => setOk("")} />}
      <div>
        <label htmlFor="claim-warranty" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Warranty</label>
        <select id="claim-warranty" value={warrantyId} onChange={(e) => setWarrantyId(e.target.value)} required
          className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500">
          <option value="">Select warranty…</option>
          {warranties.filter((w) => w.isActive).map((w) => <option key={w.id} value={w.id}>#{w.id} — Product #{w.productId} (expires {tsToDate(w.expiresAt)})</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="claim-desc" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Description</label>
        <textarea id="claim-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} required placeholder="Describe the issue…"
          className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none" />
      </div>
      <button type="submit" disabled={loading}
        className="w-full flex items-center justify-center gap-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
        {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ClipboardList className="w-4 h-4" />}
        {loading ? "Filing…" : "File Claim"}
      </button>
    </form>
  );
}

// ── AdminPanel ────────────────────────────────────────────────────────────────

function AdminPanel({ contractId, adminAddress, products, onRefresh }: { contractId: string; adminAddress: string; products: Product[]; onRefresh: () => void; }) {
  const [pName, setPName] = useState(""); const [pMfr, setPMfr] = useState(""); const [pDays, setPDays] = useState("365");
  const [wProduct, setWProduct] = useState(""); const [wOwner, setWOwner] = useState("");
  const [loading, setLoading] = useState(false); const [err, setErr] = useState(""); const [ok, setOk] = useState("");

  async function run(fn: () => Promise<string>) {
    setErr(""); setOk(""); setLoading(true);
    try { setOk(await fn()); onRefresh(); }
    catch (e: unknown) { setErr(e instanceof Error ? e.message : "Error"); }
    finally { setLoading(false); }
  }

  return (
    <div className="space-y-4">
      {err && <Err msg={err} onDismiss={() => setErr("")} />}
      {ok && <Ok msg={ok} onDismiss={() => setOk("")} />}

      {/* Register product */}
      <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-700">
        <h4 className="font-medium text-slate-900 dark:text-white mb-3 flex items-center gap-2"><Package className="w-4 h-4 text-blue-500" /> Register Product</h4>
        <div className="space-y-2">
          <input value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Product name" aria-label="Product name"
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <input value={pMfr} onChange={(e) => setPMfr(e.target.value)} placeholder="Manufacturer address (G…)" aria-label="Manufacturer address"
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <div className="flex gap-2">
            <input type="number" value={pDays} onChange={(e) => setPDays(e.target.value)} placeholder="Warranty days" aria-label="Warranty duration in days"
              className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <button disabled={loading} onClick={() => run(async () => {
              const d = await apiPost("/api/warranty/products", { contractId, admin: adminAddress, name: pName, manufacturer: pMfr, defaultWarrantySecs: parseInt(pDays, 10) * 86400 });
              return `Product #${d.productId} registered`;
            })} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
              Register
            </button>
          </div>
        </div>
      </div>

      {/* Issue warranty */}
      <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-700">
        <h4 className="font-medium text-slate-900 dark:text-white mb-3 flex items-center gap-2"><Shield className="w-4 h-4 text-green-500" /> Issue Warranty</h4>
        <div className="space-y-2">
          <select value={wProduct} onChange={(e) => setWProduct(e.target.value)} aria-label="Select product"
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500">
            <option value="">Select product…</option>
            {products.filter((p) => p.isActive).map((p) => <option key={p.id} value={p.id}>#{p.id} {p.name} ({secsToLabel(p.defaultWarrantySecs)})</option>)}
          </select>
          <div className="flex gap-2">
            <input value={wOwner} onChange={(e) => setWOwner(e.target.value)} placeholder="Owner address (G…)" aria-label="Owner address"
              className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500" />
            <button disabled={loading || !wProduct} onClick={() => run(async () => {
              const d = await apiPost("/api/warranty/warranties", { contractId, admin: adminAddress, productId: parseInt(wProduct, 10), owner: wOwner });
              return `Warranty #${d.warrantyId} issued`;
            })} className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
              Issue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export interface WarrantyDashboardProps {
  contractId?: string;
  adminAddress?: string;
  userAddress?: string;
}

export default function WarrantyDashboard({ contractId = "", adminAddress = "", userAddress = "" }: WarrantyDashboardProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [warranties, setWarranties] = useState<Warranty[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [tab, setTab] = useState<"claims" | "warranties" | "admin">("claims");
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(""); const [ok, setOk] = useState("");

  const loadAll = useCallback(async () => {
    if (!contractId) return;
    setLoading(true);
    try {
      const [pc, wc, cc] = await Promise.all([
        apiGet("/api/warranty/products/count" as never, { contractId }).catch(() => ({ productCount: 0 })),
        apiGet("/api/warranty/warranties/count" as never, { contractId }).catch(() => ({ warrantyCount: 0 })),
        apiGet("/api/warranty/claims/count" as never, { contractId }).catch(() => ({ claimCount: 0 })),
      ]);
      // Fetch individual items in parallel
      const [prods, warrs, clms] = await Promise.all([
        Promise.all(Array.from({ length: pc.productCount ?? 0 }, (_, i) =>
          apiGet(`/api/warranty/products/${i + 1}`, { contractId }).then((d) => ({
            id: i + 1, name: d.product?.name ?? "", manufacturer: d.product?.manufacturer ?? "",
            defaultWarrantySecs: d.product?.default_warranty_secs ?? 0, isActive: d.product?.is_active ?? false,
          })).catch(() => null)
        )),
        Promise.all(Array.from({ length: wc.warrantyCount ?? 0 }, (_, i) =>
          apiGet(`/api/warranty/warranties/${i + 1}`, { contractId }).then((d) => ({
            id: i + 1, productId: d.warranty?.product_id ?? 0, owner: d.warranty?.owner ?? "",
            issuedAt: d.warranty?.issued_at ?? 0, expiresAt: d.warranty?.expires_at ?? 0, isActive: d.warranty?.is_active ?? false,
          })).catch(() => null)
        )),
        Promise.all(Array.from({ length: cc.claimCount ?? 0 }, (_, i) =>
          apiGet(`/api/warranty/claims/${i + 1}`, { contractId }).then((d) => ({
            id: i + 1, warrantyId: d.claim?.warranty_id ?? 0, claimant: d.claim?.claimant ?? "",
            description: d.claim?.description ?? "", filedAt: d.claim?.filed_at ?? 0,
            status: (["Pending", "Approved", "Rejected"][d.claim?.status ?? 0] ?? "Pending") as Claim["status"],
          })).catch(() => null)
        )),
      ]);
      setProducts(prods.filter(Boolean) as Product[]);
      setWarranties(warrs.filter(Boolean) as Warranty[]);
      setClaims(clms.filter(Boolean) as Claim[]);
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Failed to load data"); }
    finally { setLoading(false); }
  }, [contractId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function togglePause() {
    setErr(""); setOk("");
    try {
      await apiPost(paused ? "/api/warranty/unpause" : "/api/warranty/pause", { contractId, admin: adminAddress });
      setPaused(!paused); setOk(paused ? "Contract unpaused" : "Contract paused");
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Error"); }
  }

  const pendingClaims = claims.filter((c) => c.status === "Pending").length;

  return (
    <div className="p-6 bg-white dark:bg-slate-900 rounded-xl shadow-lg border border-slate-200 dark:border-slate-800">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
            <Shield className="w-6 h-6 text-orange-600 dark:text-orange-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Warranty Management</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">Decentralized product warranties with automated claims</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {paused && <span className="text-xs font-semibold px-2 py-1 rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">PAUSED</span>}
          {pendingClaims > 0 && <span className="text-xs font-semibold px-2 py-1 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">{pendingClaims} pending</span>}
          <button onClick={loadAll} disabled={loading} aria-label="Refresh" className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
            <RefreshCw className={`w-4 h-4 text-slate-500 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {err && <div className="mb-4"><Err msg={err} onDismiss={() => setErr("")} /></div>}
      {ok && <div className="mb-4"><Ok msg={ok} onDismiss={() => setOk("")} /></div>}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: "Products", value: products.length, icon: <Package className="w-4 h-4 text-blue-500" /> },
          { label: "Warranties", value: warranties.length, icon: <Shield className="w-4 h-4 text-green-500" /> },
          { label: "Claims", value: claims.length, icon: <ClipboardList className="w-4 h-4 text-orange-500" /> },
        ].map(({ label, value, icon }) => (
          <div key={label} className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 flex items-center gap-3">
            {icon}
            <div><div className="text-xs text-slate-500">{label}</div><div className="font-bold text-slate-900 dark:text-white">{value}</div></div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg w-fit">
        {(["claims", "warranties", "admin"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} aria-pressed={tab === t}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${tab === t ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"}`}>
            {t}
          </button>
        ))}
      </div>

      {/* Claims tab */}
      {tab === "claims" && (
        <div className="space-y-4">
          {userAddress && (
            <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-700">
              <h3 className="font-medium text-slate-900 dark:text-white mb-3 flex items-center gap-2"><Plus className="w-4 h-4 text-orange-500" /> File a Claim</h3>
              <FileClaimForm contractId={contractId} userAddress={userAddress} warranties={warranties} onCreated={loadAll} />
            </div>
          )}
          <div className="space-y-2">
            <h3 className="font-medium text-slate-900 dark:text-white">All Claims</h3>
            {claims.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-sm">{contractId ? "No claims yet" : "Enter a contract ID to load data"}</div>
            ) : (
              claims.map((c) => <ClaimRow key={c.id} claim={c} contractId={contractId} adminAddress={adminAddress} onRefresh={loadAll} />)
            )}
          </div>
        </div>
      )}

      {/* Warranties tab */}
      {tab === "warranties" && (
        <div className="space-y-2">
          {warranties.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">{contractId ? "No warranties issued" : "Enter a contract ID"}</div>
          ) : (
            warranties.map((w) => (
              <div key={w.id} className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-slate-900 dark:text-white">Warranty #{w.id} — Product #{w.productId}</span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${w.isActive ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>{w.isActive ? "Active" : "Voided"}</span>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Issued: {tsToDate(w.issuedAt)} · Expires: {tsToDate(w.expiresAt)}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Admin tab */}
      {tab === "admin" && (
        <div className="space-y-4">
          <AdminPanel contractId={contractId} adminAddress={adminAddress} products={products} onRefresh={loadAll} />
          <div className="p-4 rounded-lg border border-red-200 dark:border-red-800">
            <h4 className="font-medium text-red-700 dark:text-red-400 mb-3 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Emergency Controls</h4>
            <button onClick={togglePause}
              className={`flex items-center gap-2 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors ${paused ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}`}>
              {paused ? <><PlayCircle className="w-4 h-4" /> Unpause</> : <><PauseCircle className="w-4 h-4" /> Pause Contract</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
