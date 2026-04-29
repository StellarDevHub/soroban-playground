"use client";

import React, { useState } from "react";
import {
  Music,
  Users,
  BarChart3,
  CreditCard,
  Play,
  Plus,
  TrendingUp,
  Mic2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RoyaltySplit {
  address: string;
  share: number; // basis points out of 10000
  label: string;
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  splits: RoyaltySplit[];
  totalRoyaltyEarned: number;
  streamCount: number;
  registeredAt: number;
}

export interface UsageAnalytics {
  totalStreams: number;
  totalRevenue: number;
  topSongId: string;
  activeArtists: number;
  revenueThisMonth: number;
}

interface RoyaltyDistributionPanelProps {
  contractId?: string;
  walletAddress?: string;
  songs: Song[];
  analytics: UsageAnalytics | null;
  isLoading: boolean;
  onRegisterSong: (params: {
    id: string;
    title: string;
    splits: RoyaltySplit[];
  }) => Promise<void>;
  onDistributeRoyalty: (songId: string, amount: number) => Promise<void>;
  onWithdraw: (songId: string) => Promise<void>;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RoyaltyDistributionPanel({
  contractId,
  walletAddress,
  songs,
  analytics,
  isLoading,
  onRegisterSong,
  onDistributeRoyalty,
  onWithdraw,
}: RoyaltyDistributionPanelProps) {
  const [tab, setTab] = useState<"dashboard" | "songs" | "register">("dashboard");
  const [expandedSong, setExpandedSong] = useState<string | null>(null);

  // Register form
  const [songId, setSongId] = useState("");
  const [songTitle, setSongTitle] = useState("");
  const [splits, setSplits] = useState<RoyaltySplit[]>([
    { address: "", share: 7000, label: "Artist" },
    { address: "", share: 2000, label: "Producer" },
    { address: "", share: 1000, label: "Label" },
  ]);

  // Distribute form
  const [distributeId, setDistributeId] = useState("");
  const [distributeAmount, setDistributeAmount] = useState("");

  if (!contractId) {
    return (
      <div className="flex flex-col space-y-3 p-5 bg-gray-900 border border-gray-800 rounded-xl shadow-lg">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-widest flex items-center gap-2">
          <Music size={16} className="text-pink-400" />
          Music Royalty Distribution
        </h3>
        <p className="text-xs text-gray-500 italic">
          Deploy the royalty contract to start distributing streaming revenue.
        </p>
      </div>
    );
  }

  const totalBps = splits.reduce((s, sp) => s + sp.share, 0);

  const handleRegister = async () => {
    if (!songId || !songTitle || totalBps !== 10000) return;
    await onRegisterSong({ id: songId, title: songTitle, splits });
    setSongId("");
    setSongTitle("");
    setSplits([
      { address: "", share: 7000, label: "Artist" },
      { address: "", share: 2000, label: "Producer" },
      { address: "", share: 1000, label: "Label" },
    ]);
  };

  const handleDistribute = async () => {
    const amt = parseFloat(distributeAmount);
    if (!distributeId || !amt || amt <= 0) return;
    await onDistributeRoyalty(distributeId, amt);
    setDistributeId("");
    setDistributeAmount("");
  };

  return (
    <div className="flex flex-col space-y-4 p-5 bg-gray-900 border border-gray-800 rounded-xl shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-widest flex items-center gap-2">
          <Music size={16} className="text-pink-400" />
          Music Royalty Distribution
        </h3>
        {walletAddress && (
          <span className="text-xs text-gray-500 font-mono">
            {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}
          </span>
        )}
      </div>

      {/* Analytics strip */}
      {analytics && (
        <div className="grid grid-cols-2 gap-2">
          <StatCard
            icon={<TrendingUp size={13} className="text-pink-400" />}
            label="Total Revenue"
            value={`${analytics.totalRevenue.toLocaleString()} XLM`}
          />
          <StatCard
            icon={<Play size={13} className="text-blue-400" />}
            label="Total Streams"
            value={analytics.totalStreams.toLocaleString()}
          />
          <StatCard
            icon={<Mic2 size={13} className="text-violet-400" />}
            label="Active Artists"
            value={String(analytics.activeArtists)}
          />
          <StatCard
            icon={<BarChart3 size={13} className="text-emerald-400" />}
            label="This Month"
            value={`${analytics.revenueThisMonth.toLocaleString()} XLM`}
          />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-800 pb-2">
        {(["dashboard", "songs", "register"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors capitalize ${
              tab === t
                ? "bg-pink-600/20 text-pink-300 border border-pink-500/30"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {t === "songs" ? `Songs (${songs.length})` : t}
          </button>
        ))}
      </div>

      {/* Dashboard tab */}
      {tab === "dashboard" && (
        <div className="space-y-3">
          <p className="text-xs font-medium text-gray-400">Distribute Streaming Revenue</p>
          <Field label="Song ID">
            <input
              value={distributeId}
              onChange={(e) => setDistributeId(e.target.value)}
              placeholder="song-001"
              className={inputCls}
            />
          </Field>
          <Field label="Amount (XLM)">
            <input
              type="number"
              value={distributeAmount}
              onChange={(e) => setDistributeAmount(e.target.value)}
              placeholder="100"
              className={inputCls}
            />
          </Field>
          <button
            onClick={handleDistribute}
            disabled={isLoading || !distributeId || !distributeAmount}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium bg-pink-600 hover:bg-pink-500 disabled:bg-gray-800 disabled:text-gray-600 text-white transition-colors"
          >
            {isLoading ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              <CreditCard size={14} />
            )}
            Distribute Royalties
          </button>

          {/* Top earners */}
          {songs.length > 0 && (
            <div className="mt-2">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                Top Earners
              </p>
              <div className="space-y-1.5">
                {[...songs]
                  .sort((a, b) => b.totalRoyaltyEarned - a.totalRoyaltyEarned)
                  .slice(0, 3)
                  .map((song) => (
                    <div
                      key={song.id}
                      className="flex items-center justify-between p-2 bg-gray-950/60 border border-gray-800 rounded"
                    >
                      <div className="flex items-center gap-2">
                        <Play size={10} className="text-pink-400" />
                        <div>
                          <p className="text-xs text-gray-300">{song.title}</p>
                          <p className="text-[10px] text-gray-500">{song.artist}</p>
                        </div>
                      </div>
                      <p className="text-xs font-mono text-emerald-400">
                        {song.totalRoyaltyEarned.toLocaleString()} XLM
                      </p>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Songs tab */}
      {tab === "songs" && (
        <div className="space-y-2">
          {songs.length === 0 ? (
            <p className="text-xs text-gray-500 italic text-center py-6">
              No songs registered yet.
            </p>
          ) : (
            songs.map((song) => (
              <div key={song.id} className="border border-gray-800 rounded-lg overflow-hidden">
                <button
                  onClick={() =>
                    setExpandedSong(expandedSong === song.id ? null : song.id)
                  }
                  className="w-full flex items-center justify-between p-3 text-left hover:bg-gray-800/40 transition-colors"
                  aria-expanded={expandedSong === song.id}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-1.5 bg-pink-900/30 rounded">
                      <Music size={11} className="text-pink-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-gray-200 truncate">{song.title}</p>
                      <p className="text-[10px] text-gray-500">{song.artist}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-mono text-emerald-400">
                      {song.totalRoyaltyEarned.toLocaleString()} XLM
                    </span>
                    {expandedSong === song.id ? (
                      <ChevronUp size={13} className="text-gray-500" />
                    ) : (
                      <ChevronDown size={13} className="text-gray-500" />
                    )}
                  </div>
                </button>

                {expandedSong === song.id && (
                  <div className="border-t border-gray-800 p-3 space-y-3 bg-gray-950/50">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <InfoRow label="Song ID" value={song.id} />
                      <InfoRow
                        label="Streams"
                        value={song.streamCount.toLocaleString()}
                      />
                      <InfoRow
                        label="Registered"
                        value={new Date(song.registeredAt * 1000).toLocaleDateString()}
                      />
                      <InfoRow
                        label="Total Earned"
                        value={`${song.totalRoyaltyEarned.toLocaleString()} XLM`}
                      />
                    </div>

                    {/* Splits */}
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">
                        Royalty Splits
                      </p>
                      <div className="space-y-1">
                        {song.splits.map((split, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                              <div
                                className="h-full bg-pink-500"
                                style={{ width: `${split.share / 100}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-gray-400 w-12 text-right font-mono">
                              {(split.share / 100).toFixed(0)}%
                            </span>
                            <span className="text-[10px] text-gray-500 w-16 truncate">
                              {split.label}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <button
                      onClick={() => onWithdraw(song.id)}
                      disabled={isLoading}
                      className="w-full flex items-center justify-center gap-1 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 text-xs rounded transition-colors"
                    >
                      <CreditCard size={11} />
                      Withdraw My Share
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Register tab */}
      {tab === "register" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Song ID">
              <input
                value={songId}
                onChange={(e) => setSongId(e.target.value)}
                placeholder="song-001"
                className={inputCls}
              />
            </Field>
            <Field label="Title">
              <input
                value={songTitle}
                onChange={(e) => setSongTitle(e.target.value)}
                placeholder="My Track"
                className={inputCls}
              />
            </Field>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">
                Royalty Splits
              </p>
              <span
                className={`text-[10px] font-mono ${
                  totalBps === 10000 ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {totalBps} / 10000 bps
              </span>
            </div>
            <div className="space-y-2">
              {splits.map((split, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    value={split.label}
                    onChange={(e) =>
                      setSplits((prev) =>
                        prev.map((s, j) =>
                          j === i ? { ...s, label: e.target.value } : s
                        )
                      )
                    }
                    placeholder="Role"
                    className={`${inputCls} w-20`}
                  />
                  <input
                    value={split.address}
                    onChange={(e) =>
                      setSplits((prev) =>
                        prev.map((s, j) =>
                          j === i ? { ...s, address: e.target.value } : s
                        )
                      )
                    }
                    placeholder="G..."
                    className={`${inputCls} flex-1`}
                  />
                  <input
                    type="number"
                    value={split.share}
                    onChange={(e) =>
                      setSplits((prev) =>
                        prev.map((s, j) =>
                          j === i ? { ...s, share: parseInt(e.target.value) || 0 } : s
                        )
                      )
                    }
                    placeholder="bps"
                    className={`${inputCls} w-16`}
                  />
                </div>
              ))}
            </div>
            <button
              onClick={() =>
                setSplits((prev) => [
                  ...prev,
                  { address: "", share: 0, label: "Collaborator" },
                ])
              }
              className="mt-2 text-[10px] text-gray-500 hover:text-gray-300 flex items-center gap-1 transition-colors"
            >
              <Plus size={10} /> Add split
            </button>
          </div>

          <button
            onClick={handleRegister}
            disabled={isLoading || !songId || !songTitle || totalBps !== 10000}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium bg-pink-600 hover:bg-pink-500 disabled:bg-gray-800 disabled:text-gray-600 text-white transition-colors"
          >
            {isLoading ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              <Mic2 size={14} />
            )}
            Register Song
          </button>
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const inputCls =
  "w-full bg-gray-950 border border-gray-800 rounded-md py-1.5 px-2 text-xs text-gray-200 focus:outline-none focus:border-pink-500 font-mono";

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

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="p-3 bg-gray-950/60 border border-gray-800 rounded-lg">
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-sm font-semibold text-gray-200 font-mono">{value}</p>
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
