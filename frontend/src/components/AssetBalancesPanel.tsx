"use client";

import React, { FormEvent, useMemo, useState } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { useWallet } from "@/components/providers/WalletProvider";
import {
  TrackedSacToken,
  useAssetBalances,
} from "@/hooks/useAssetBalances";

function formatAmount(amount: string, maximumFractionDigits = 7): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return amount;
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits,
  }).format(value);
}

function formatUsd(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function streamLabel(status: string): string {
  switch (status) {
    case "live":
      return "LIVE";
    case "reconnecting":
      return "RECONNECTING";
    case "connecting":
      return "SYNCING";
    case "unavailable":
      return "HORIZON UNAVAILABLE";
    default:
      return "DISCONNECTED";
  }
}

function assetKindLabel(
  kind: "native" | "trustline" | "liquidity_pool" | "sac",
): string {
  if (kind === "native") return "Native";
  if (kind === "sac") return "SAC";
  if (kind === "liquidity_pool") return "Liquidity pool";
  return "Stellar Asset";
}

export default function AssetBalancesPanel() {
  const { address, networkPassphrase, status } = useWallet();
  const {
    balances,
    trackedSacs,
    addSac,
    removeSac,
    refresh,
    streamStatus,
    error,
    sacError,
    priceError,
    xlmUsd,
  } = useAssetBalances(address, networkPassphrase);
  const [formError, setFormError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [token, setToken] = useState({
    symbol: "",
    name: "",
    contractId: "",
    decimals: "7",
    marketAssetCode: "",
    marketAssetIssuer: "",
  });

  const pricedBalances = useMemo(
    () => balances.filter((balance) => balance.valueInUsd !== undefined),
    [balances],
  );
  const totalUsd = pricedBalances.reduce(
    (total, balance) => total + (balance.valueInUsd ?? 0),
    0,
  );

  const handleAddToken = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const newToken: TrackedSacToken = {
      symbol: token.symbol.trim().toUpperCase(),
      name: token.name.trim(),
      contractId: token.contractId.trim().toUpperCase(),
      decimals: Number(token.decimals),
      marketAssetCode: token.marketAssetCode.trim().toUpperCase() || undefined,
      marketAssetIssuer: token.marketAssetIssuer.trim() || undefined,
    };
    const validationError = addSac(newToken);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setFormError(null);
    setIsAdding(false);
    setToken({
      symbol: "",
      name: "",
      contractId: "",
      decimals: "7",
      marketAssetCode: "",
      marketAssetIssuer: "",
    });
  };

  return (
    <section className="space-y-4" aria-labelledby="asset-balances-title">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="asset-balances-title" className="text-xl font-semibold text-white">
            Asset Balances
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            {address
              ? `Live account balances on ${networkPassphrase}`
              : "Connect a wallet to stream account balances."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center gap-2 text-[10px] font-bold tracking-wider ${
              streamStatus === "live"
                ? "text-emerald-300"
                : streamStatus === "reconnecting"
                  ? "text-amber-300"
                  : "text-slate-400"
            }`}
            role="status"
            aria-live="polite"
          >
            <span
              className={`h-2 w-2 rounded-full ${
                streamStatus === "live"
                  ? "bg-emerald-400"
                  : streamStatus === "reconnecting"
                    ? "bg-amber-400 animate-pulse"
                    : "bg-slate-500"
              }`}
            />
            {streamLabel(streamStatus)}
          </span>
          <button
            type="button"
            onClick={refresh}
            disabled={!address}
            aria-label="Refresh balances and prices"
            title="Refresh balances and prices"
            className="p-2 text-slate-400 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-4 border-y border-white/10 py-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Priced portfolio value
          </p>
          <p className="mt-1 font-mono text-lg text-white">
            {pricedBalances.length ? formatUsd(totalUsd) : "-"}
          </p>
        </div>
        <p className="text-xs text-slate-400">
          {xlmUsd !== null ? `XLM ${formatUsd(xlmUsd)}` : "XLM price unavailable"}
        </p>
      </div>

      {(error || sacError || priceError) && (
        <div className="space-y-1 text-xs text-amber-200" role="status" aria-live="polite">
          {error && <p>{error}</p>}
          {sacError && <p>{sacError}</p>}
          {priceError && <p>Price conversion: {priceError}</p>}
        </div>
      )}

      <div className="overflow-x-auto border-b border-white/10">
        <table className="w-full min-w-[660px] text-left text-sm">
          <thead className="border-b border-white/10 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="py-3 pr-4 font-semibold">Asset</th>
              <th className="py-3 pr-4 font-semibold">Type</th>
              <th className="py-3 pr-4 text-right font-semibold">Balance</th>
              <th className="py-3 pr-4 text-right font-semibold">Price / XLM</th>
              <th className="py-3 text-right font-semibold">Value / USD</th>
              <th className="py-3 pl-3" aria-label="Actions" />
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {balances.map((balance) => (
              <tr key={balance.id} className="align-top">
                <td className="py-3 pr-4">
                  <span className="font-semibold text-slate-100">
                    {balance.symbol}
                  </span>
                  {balance.kind === "sac" && (
                    <span className="mt-1 block max-w-56 truncate font-mono text-[10px] text-slate-500">
                      {balance.contractId}
                    </span>
                  )}
                  {balance.kind === "trustline" && balance.issuer && (
                    <span className="mt-1 block max-w-56 truncate font-mono text-[10px] text-slate-500">
                      {balance.issuer}
                    </span>
                  )}
                </td>
                <td className="py-3 pr-4 text-xs text-slate-400">
                  {assetKindLabel(balance.kind)}
                </td>
                <td className="py-3 pr-4 text-right font-mono tabular-nums text-slate-100">
                  <span
                    className={
                      balance.delta === "up"
                        ? "balance-delta-up"
                        : balance.delta === "down"
                          ? "balance-delta-down"
                          : ""
                    }
                  >
                    {formatAmount(balance.amount, balance.decimals)}
                  </span>
                </td>
                <td className="py-3 pr-4 text-right font-mono tabular-nums text-slate-300">
                  {balance.priceInXlm === undefined
                    ? "-"
                    : `${formatAmount(String(balance.priceInXlm), 7)} XLM`}
                </td>
                <td className="py-3 text-right font-mono tabular-nums text-slate-100">
                  {formatUsd(balance.valueInUsd)}
                </td>
                <td className="py-3 pl-3 text-right">
                  {balance.kind === "sac" && balance.contractId && (
                    <button
                      type="button"
                      onClick={() => removeSac(balance.contractId as string)}
                      aria-label={`Stop tracking ${balance.symbol}`}
                      title={`Stop tracking ${balance.symbol}`}
                      className="p-1 text-slate-500 transition-colors hover:text-rose-300"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {balances.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-sm text-slate-500">
                  {status === "connected"
                    ? "Waiting for Horizon account data..."
                    : "No wallet connected."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 pt-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Stellar Asset Contracts</h3>
            <p className="mt-1 text-xs text-slate-500">
              SAC balances are read from Soroban persistent storage. Optional market metadata enables Horizon DEX pricing.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setFormError(null);
              setIsAdding((current) => !current);
            }}
            disabled={!address}
            className="inline-flex items-center gap-2 border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200 transition-colors hover:border-teal-400/40 hover:text-teal-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus size={14} />
            Track SAC
          </button>
        </div>

        {isAdding && (
          <form
            onSubmit={handleAddToken}
            className="grid gap-3 border-y border-white/10 py-4 sm:grid-cols-2"
          >
            <label className="space-y-1 text-xs text-slate-400">
              <span>Symbol</span>
              <input
                required
                maxLength={12}
                pattern="[A-Za-z0-9._-]{1,12}"
                value={token.symbol}
                onChange={(event) => setToken({ ...token, symbol: event.target.value })}
                className="w-full border border-white/10 bg-slate-950 px-3 py-2 font-mono text-sm text-white outline-none focus:border-teal-400/60"
              />
            </label>
            <label className="space-y-1 text-xs text-slate-400">
              <span>Name</span>
              <input
                required
                maxLength={48}
                value={token.name}
                onChange={(event) => setToken({ ...token, name: event.target.value })}
                className="w-full border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-teal-400/60"
              />
            </label>
            <label className="space-y-1 text-xs text-slate-400 sm:col-span-2">
              <span>Contract ID</span>
              <input
                required
                pattern="C[A-Z2-7]{55}"
                maxLength={56}
                value={token.contractId}
                onChange={(event) => setToken({ ...token, contractId: event.target.value.toUpperCase() })}
                className="w-full border border-white/10 bg-slate-950 px-3 py-2 font-mono text-xs text-white outline-none focus:border-teal-400/60"
              />
            </label>
            <label className="space-y-1 text-xs text-slate-400">
              <span>Decimals</span>
              <input
                type="number"
                min={0}
                max={18}
                required
                value={token.decimals}
                onChange={(event) => setToken({ ...token, decimals: event.target.value })}
                className="w-full border border-white/10 bg-slate-950 px-3 py-2 font-mono text-sm text-white outline-none focus:border-teal-400/60"
              />
            </label>
            <label className="space-y-1 text-xs text-slate-400">
              <span>Market asset code (optional)</span>
              <input
                maxLength={12}
                value={token.marketAssetCode}
                onChange={(event) => setToken({ ...token, marketAssetCode: event.target.value })}
                className="w-full border border-white/10 bg-slate-950 px-3 py-2 font-mono text-sm text-white outline-none focus:border-teal-400/60"
              />
            </label>
            <label className="space-y-1 text-xs text-slate-400 sm:col-span-2">
              <span>Market asset issuer (optional)</span>
              <input
                pattern="G[A-Z2-7]{55}"
                maxLength={56}
                value={token.marketAssetIssuer}
                onChange={(event) => setToken({ ...token, marketAssetIssuer: event.target.value.toUpperCase() })}
                className="w-full border border-white/10 bg-slate-950 px-3 py-2 font-mono text-xs text-white outline-none focus:border-teal-400/60"
              />
            </label>
            {(formError || sacError) && (
              <p className="text-xs text-rose-300 sm:col-span-2" role="alert">
                {formError ?? sacError}
              </p>
            )}
            <div className="flex gap-2 sm:col-span-2">
              <button
                type="submit"
                className="inline-flex items-center gap-2 bg-teal-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-teal-400"
              >
                <Plus size={14} />
                Add contract
              </button>
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                className="border border-white/10 px-4 py-2 text-xs text-slate-300 hover:bg-white/5"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {trackedSacs.length > 0 && (
          <p className="text-[11px] text-slate-500">
            Tracking {trackedSacs.length} of 20 custom contracts for this account.
          </p>
        )}
      </div>
    </section>
  );
}