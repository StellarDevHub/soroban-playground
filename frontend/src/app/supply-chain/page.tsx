"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Package, RefreshCw, AlertTriangle } from "lucide-react";
import { supplyChainApi, type Product } from "./types";
import { ProductCard, PausedBanner } from "./components";
import { RegisterForm, CheckpointForm, QualityForm, PauseControls } from "./forms";

// ── Tab config ────────────────────────────────────────────────────────────────

const TABS = [
  { key: "products", label: "Products" },
  { key: "register", label: "Register" },
  { key: "checkpoint", label: "Checkpoint" },
  { key: "quality", label: "QA Report" },
  { key: "admin", label: "Admin" },
] as const;

type Tab = (typeof TABS)[number]["key"];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SupplyChainPage() {
  const [contractId, setContractId] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [tab, setTab] = useState<Tab>("products");
  const [products, setProducts] = useState<Product[]>([]);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const connected = /^C[A-Z0-9]{55}$/.test(contractId);

  // ── Data fetching ───────────────────────────────────────────────────────────

  const fetchProducts = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    setError("");
    try {
      const { count } = await supplyChainApi.getCount(contractId);
      const items: Product[] = [];
      for (let i = 1; i <= count; i++) {
        const { product } = await supplyChainApi.getProduct(contractId, i);
        items.push(product);
      }
      setProducts(items);
      const { paused: p } = await supplyChainApi.getPaused(contractId);
      setPaused(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load products");
    } finally {
      setLoading(false);
    }
  }, [contractId, connected]);

  useEffect(() => {
    if (connected) fetchProducts();
  }, [connected, fetchProducts]);

  // ── Mutations ───────────────────────────────────────────────────────────────

  const handleRegister = async (name: string, metadataHash: number) => {
    await supplyChainApi.registerProduct(contractId, {
      owner: walletAddress,
      name,
      metadataHash,
      sourceAccount: walletAddress,
    });
    await fetchProducts();
  };

  const handleCheckpoint = async (productId: number, locationHash: number, notesHash: number) => {
    await supplyChainApi.addCheckpoint(contractId, productId, {
      handler: walletAddress,
      locationHash,
      notesHash,
      sourceAccount: walletAddress,
    });
    await fetchProducts();
  };

  const handleQuality = async (productId: number, result: "Pass" | "Fail" | "Pending", reportHash: number) => {
    await supplyChainApi.submitQualityReport(contractId, productId, {
      inspector: walletAddress,
      result,
      reportHash,
      sourceAccount: walletAddress,
    });
    await fetchProducts();
  };

  const handleRecall = async (productId: number) => {
    await supplyChainApi.recallProduct(contractId, productId, {
      caller: walletAddress,
      sourceAccount: walletAddress,
    });
    await fetchProducts();
  };

  const handleMarkDelivered = async (productId: number) => {
    await supplyChainApi.addCheckpoint(contractId, productId, {
      handler: walletAddress,
      locationHash: 0,
      notesHash: 0,
      sourceAccount: walletAddress,
    });
    await fetchProducts();
  };

  const handlePause = async () => {
    await supplyChainApi.pause(contractId, { caller: walletAddress, sourceAccount: walletAddress });
    setPaused(true);
  };

  const handleUnpause = async () => {
    await supplyChainApi.unpause(contractId, { caller: walletAddress, sourceAccount: walletAddress });
    setPaused(false);
  };

  const mutationDisabled = !connected || loading || paused;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-200">
      <div className="mx-auto max-w-2xl space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Package size={20} className="text-cyan-400" />
            Supply Chain Tracker
          </h1>
          {connected && (
            <button
              onClick={fetchProducts}
              disabled={loading}
              aria-label="Refresh products"
              className="rounded-lg border border-white/10 p-1.5 text-slate-400 transition hover:text-slate-200 disabled:opacity-40"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          )}
        </div>

        {/* Contract config */}
        <section
          aria-label="Contract configuration"
          className="rounded-2xl border border-white/8 bg-white/5 p-4 space-y-2"
        >
          <label htmlFor="contract-id" className="block text-[10px] text-slate-500">
            Contract ID
          </label>
          <input
            id="contract-id"
            value={contractId}
            onChange={(e) => setContractId(e.target.value.trim())}
            placeholder="C…"
            className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-slate-200 outline-none placeholder:text-slate-600"
            aria-describedby="contract-hint"
          />
          <p id="contract-hint" className="text-[10px] text-slate-600">
            Paste a deployed supply-chain contract ID to interact with it.
          </p>
          <label htmlFor="wallet-address" className="block text-[10px] text-slate-500">
            Your Wallet Address
          </label>
          <input
            id="wallet-address"
            value={walletAddress}
            onChange={(e) => setWalletAddress(e.target.value.trim())}
            placeholder="G…"
            className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-slate-200 outline-none placeholder:text-slate-600"
          />
        </section>

        {/* Error banner */}
        {error && (
          <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-300">
            <AlertTriangle size={14} />
            {error}
          </div>
        )}

        {/* Paused banner */}
        {connected && paused && <PausedBanner />}

        {/* Main panel */}
        {connected && (
          <section
            aria-label="Supply chain operations"
            className="rounded-2xl border border-white/8 bg-white/5 p-4"
          >
            {/* Stats row */}
            <div className="mb-3 flex items-center justify-between text-xs text-slate-500">
              <span>{products.length} product{products.length !== 1 ? "s" : ""}</span>
              <span className={paused ? "text-red-400" : "text-emerald-400"}>
                {paused ? "⏸ Paused" : "● Active"}
              </span>
            </div>

            {/* Tabs */}
            <div className="mb-4 flex gap-1 flex-wrap" role="tablist">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={tab === t.key}
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

            {/* Tab panels */}
            {tab === "products" && (
              <div role="tabpanel" aria-label="Products list" className="space-y-2">
                {loading && <p className="text-xs text-slate-500">Loading…</p>}
                {!loading && products.length === 0 && (
                  <p className="text-xs text-slate-500">No products registered yet.</p>
                )}
                {products.map((p) => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    onRecall={handleRecall}
                    onMarkDelivered={handleMarkDelivered}
                    disabled={mutationDisabled}
                  />
                ))}
              </div>
            )}

            {tab === "register" && (
              <div role="tabpanel" aria-label="Register product">
                <RegisterForm disabled={mutationDisabled} onSubmit={handleRegister} />
              </div>
            )}

            {tab === "checkpoint" && (
              <div role="tabpanel" aria-label="Add checkpoint">
                <CheckpointForm disabled={mutationDisabled} onSubmit={handleCheckpoint} />
              </div>
            )}

            {tab === "quality" && (
              <div role="tabpanel" aria-label="Quality report">
                <QualityForm disabled={mutationDisabled} onSubmit={handleQuality} />
              </div>
            )}

            {tab === "admin" && (
              <div role="tabpanel" aria-label="Admin controls">
                <PauseControls
                  paused={paused}
                  disabled={!connected || loading}
                  onPause={handlePause}
                  onUnpause={handleUnpause}
                />
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
