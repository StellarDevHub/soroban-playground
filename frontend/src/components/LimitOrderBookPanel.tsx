"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  TrendingUp,
  TrendingDown,
  BookOpen,
  History,
  BarChart2,
  RefreshCw,
  X,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Order {
  id: number;
  owner: string;
  side: "buy" | "sell";
  price: number;
  quantity: number;
  remaining: number;
  status: "open" | "partially_filled" | "filled" | "cancelled";
  createdAt: number;
}

interface Trade {
  buyOrderId: number;
  sellOrderId: number;
  price: number;
  quantity: number;
  executedAt: number;
}

interface OrderBook {
  bids: Order[];
  asks: Order[];
}

interface Stats {
  totalOrders: number;
  openOrders: number;
  totalTrades: number;
  totalVolume: number;
}

interface Props {
  apiBase?: string;
  walletAddress?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_API = "http://localhost:5000/api/orderbook";
const POLL_INTERVAL_MS = 3000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function statusBadge(status: Order["status"]) {
  const map: Record<Order["status"], string> = {
    open: "bg-blue-500/20 text-blue-300",
    partially_filled: "bg-yellow-500/20 text-yellow-300",
    filled: "bg-green-500/20 text-green-300",
    cancelled: "bg-gray-500/20 text-gray-400",
  };
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-medium ${map[status]}`}
      aria-label={`Order status: ${status.replace("_", " ")}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function LimitOrderBookPanel({
  apiBase = DEFAULT_API,
  walletAddress = "",
}: Props) {
  const [book, setBook] = useState<OrderBook>({ bids: [], asks: [] });
  const [trades, setTrades] = useState<Trade[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"book" | "trades" | "stats">("book");

  // Form state
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [owner, setOwner] = useState(walletAddress);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [lastTrades, setLastTrades] = useState<Trade[]>([]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Data fetching ───────────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    try {
      const [bookRes, tradesRes, statsRes] = await Promise.all([
        fetch(apiBase),
        fetch(`${apiBase}/trades?limit=20`),
        fetch(`${apiBase}/stats`),
      ]);
      if (!bookRes.ok || !tradesRes.ok || !statsRes.ok) throw new Error("Fetch failed");
      const [bookData, tradesData, statsData] = await Promise.all([
        bookRes.json(),
        tradesRes.json(),
        statsRes.json(),
      ]);
      setBook(bookData.data);
      setTrades(tradesData.data.trades);
      setStats(statsData.data);
      setError(null);
    } catch {
      setError("Failed to load order book data");
    }
  }, [apiBase]);

  useEffect(() => {
    setLoading(true);
    fetchAll().finally(() => setLoading(false));
    pollRef.current = setInterval(fetchAll, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchAll]);

  // ── Form submission ─────────────────────────────────────────────────────────

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const p = parseFloat(price);
    const q = parseFloat(quantity);
    if (!owner.trim()) return setFormError("Owner / wallet address is required");
    if (!Number.isFinite(p) || p <= 0) return setFormError("Price must be a positive number");
    if (!Number.isFinite(q) || q <= 0) return setFormError("Quantity must be a positive number");

    setSubmitting(true);
    try {
      const res = await fetch(`${apiBase}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: owner.trim(), side, price: p, quantity: q }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to place order");
      setLastTrades(data.data.trades ?? []);
      setPrice("");
      setQuantity("");
      await fetchAll();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (id: number) => {
    if (!owner.trim()) return;
    try {
      await fetch(`${apiBase}/orders/${id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: owner.trim() }),
      });
      await fetchAll();
    } catch {
      // silently ignore — user will see stale data refresh
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4 p-4 bg-gray-900 text-gray-100 min-h-screen font-mono">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <BookOpen size={20} aria-hidden="true" />
          Limit Order Book
        </h1>
        <button
          onClick={() => fetchAll()}
          aria-label="Refresh order book"
          className="p-1.5 rounded hover:bg-gray-700 transition-colors"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {error && (
        <div role="alert" className="bg-red-900/40 border border-red-700 rounded p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Last trades flash */}
      {lastTrades.length > 0 && (
        <div role="status" className="bg-green-900/30 border border-green-700 rounded p-3 text-sm text-green-300">
          ✓ {lastTrades.length} trade{lastTrades.length > 1 ? "s" : ""} executed — qty{" "}
          {lastTrades.map(t => fmt(t.quantity)).join(", ")} @ price{" "}
          {lastTrades.map(t => fmt(t.price)).join(", ")}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Order Form */}
        <section aria-label="Place order" className="bg-gray-800 rounded-lg p-4">
          <h2 className="text-sm font-semibold mb-3 text-gray-300">Place Order</h2>
          <form onSubmit={handlePlaceOrder} noValidate className="flex flex-col gap-3">
            {/* Owner */}
            <div>
              <label htmlFor="lob-owner" className="block text-xs text-gray-400 mb-1">
                Wallet Address
              </label>
              <input
                id="lob-owner"
                type="text"
                value={owner}
                onChange={e => setOwner(e.target.value)}
                placeholder="G..."
                className="w-full bg-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-required="true"
              />
            </div>

            {/* Side toggle */}
            <div role="group" aria-label="Order side" className="flex rounded overflow-hidden">
              <button
                type="button"
                onClick={() => setSide("buy")}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  side === "buy" ? "bg-green-600 text-white" : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                }`}
                aria-pressed={side === "buy"}
              >
                <TrendingUp size={14} className="inline mr-1" aria-hidden="true" />
                Buy
              </button>
              <button
                type="button"
                onClick={() => setSide("sell")}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  side === "sell" ? "bg-red-600 text-white" : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                }`}
                aria-pressed={side === "sell"}
              >
                <TrendingDown size={14} className="inline mr-1" aria-hidden="true" />
                Sell
              </button>
            </div>

            {/* Price */}
            <div>
              <label htmlFor="lob-price" className="block text-xs text-gray-400 mb-1">
                Price
              </label>
              <input
                id="lob-price"
                type="number"
                min="0"
                step="any"
                value={price}
                onChange={e => setPrice(e.target.value)}
                placeholder="0.00"
                className="w-full bg-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-required="true"
              />
            </div>

            {/* Quantity */}
            <div>
              <label htmlFor="lob-qty" className="block text-xs text-gray-400 mb-1">
                Quantity
              </label>
              <input
                id="lob-qty"
                type="number"
                min="0"
                step="any"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                placeholder="0.00"
                className="w-full bg-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-required="true"
              />
            </div>

            {formError && (
              <p role="alert" className="text-xs text-red-400">
                {formError}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className={`py-2 rounded font-medium text-sm transition-colors ${
                side === "buy"
                  ? "bg-green-600 hover:bg-green-500 disabled:bg-green-900"
                  : "bg-red-600 hover:bg-red-500 disabled:bg-red-900"
              } text-white`}
            >
              {submitting ? "Placing…" : `Place ${side === "buy" ? "Buy" : "Sell"} Order`}
            </button>
          </form>
        </section>

        {/* Main panel */}
        <section aria-label="Order book data" className="lg:col-span-2 bg-gray-800 rounded-lg p-4">
          {/* Tabs */}
          <div role="tablist" className="flex gap-1 mb-4 border-b border-gray-700 pb-2">
            {(["book", "trades", "stats"] as const).map(tab => (
              <button
                key={tab}
                role="tab"
                aria-selected={activeTab === tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 rounded text-sm capitalize transition-colors ${
                  activeTab === tab
                    ? "bg-blue-600 text-white"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                {tab === "book" && <BookOpen size={13} className="inline mr-1" aria-hidden="true" />}
                {tab === "trades" && <History size={13} className="inline mr-1" aria-hidden="true" />}
                {tab === "stats" && <BarChart2 size={13} className="inline mr-1" aria-hidden="true" />}
                {tab}
              </button>
            ))}
          </div>

          {/* Book tab */}
          {activeTab === "book" && (
            <div className="grid grid-cols-2 gap-4" role="tabpanel" aria-label="Order book">
              {/* Asks */}
              <div>
                <h3 className="text-xs text-red-400 font-semibold mb-2">Asks (Sell)</h3>
                <div className="space-y-1 max-h-64 overflow-y-auto" aria-label="Ask orders">
                  {book.asks.length === 0 && (
                    <p className="text-xs text-gray-500">No asks</p>
                  )}
                  {book.asks.map(o => (
                    <div
                      key={o.id}
                      className="flex items-center justify-between text-xs bg-red-900/20 rounded px-2 py-1"
                    >
                      <span className="text-red-300">{fmt(o.price)}</span>
                      <span className="text-gray-300">{fmt(o.remaining)}</span>
                      {o.owner === owner && (
                        <button
                          onClick={() => handleCancel(o.id)}
                          aria-label={`Cancel ask order ${o.id}`}
                          className="ml-1 text-gray-500 hover:text-red-400"
                        >
                          <X size={11} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Bids */}
              <div>
                <h3 className="text-xs text-green-400 font-semibold mb-2">Bids (Buy)</h3>
                <div className="space-y-1 max-h-64 overflow-y-auto" aria-label="Bid orders">
                  {book.bids.length === 0 && (
                    <p className="text-xs text-gray-500">No bids</p>
                  )}
                  {book.bids.map(o => (
                    <div
                      key={o.id}
                      className="flex items-center justify-between text-xs bg-green-900/20 rounded px-2 py-1"
                    >
                      <span className="text-green-300">{fmt(o.price)}</span>
                      <span className="text-gray-300">{fmt(o.remaining)}</span>
                      {o.owner === owner && (
                        <button
                          onClick={() => handleCancel(o.id)}
                          aria-label={`Cancel bid order ${o.id}`}
                          className="ml-1 text-gray-500 hover:text-red-400"
                        >
                          <X size={11} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Trades tab */}
          {activeTab === "trades" && (
            <div role="tabpanel" aria-label="Trade history">
              <table className="w-full text-xs" aria-label="Recent trades">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-700">
                    <th className="text-left py-1">Buy #</th>
                    <th className="text-left py-1">Sell #</th>
                    <th className="text-right py-1">Price</th>
                    <th className="text-right py-1">Qty</th>
                    <th className="text-right py-1">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center text-gray-500 py-4">
                        No trades yet
                      </td>
                    </tr>
                  )}
                  {trades.map((t, i) => (
                    <tr key={i} className="border-b border-gray-700/50">
                      <td className="py-1 text-green-400">#{t.buyOrderId}</td>
                      <td className="py-1 text-red-400">#{t.sellOrderId}</td>
                      <td className="py-1 text-right">{fmt(t.price)}</td>
                      <td className="py-1 text-right">{fmt(t.quantity)}</td>
                      <td className="py-1 text-right text-gray-400">
                        {new Date(t.executedAt).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Stats tab */}
          {activeTab === "stats" && stats && (
            <div role="tabpanel" aria-label="Statistics" className="grid grid-cols-2 gap-3">
              {[
                { label: "Total Orders", value: stats.totalOrders },
                { label: "Open Orders", value: stats.openOrders },
                { label: "Total Trades", value: stats.totalTrades },
                { label: "Total Volume", value: fmt(stats.totalVolume) },
              ].map(({ label, value }) => (
                <div key={label} className="bg-gray-700/50 rounded p-3">
                  <p className="text-xs text-gray-400">{label}</p>
                  <p className="text-lg font-bold text-white">{value}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
