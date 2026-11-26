"use client";

import React, { useId, useMemo, useState } from "react";
import {
  ArrowUpDown,
  CheckCircle2,
  Coins,
  Copy,
  DollarSign,
  Globe,
  Info,
  RefreshCw,
  Sparkles,
  Wallet,
} from "lucide-react";
import {
  formatFiatValue,
  formatMultiCurrencyValue,
  formatStroopAmount,
  stroopToXlm,
  xlmToStroop,
  type FormattedBalanceResult,
} from "@/utils/formatters";

export interface AssetBalanceCardProps {
  initialStroops?: string | number | bigint;
  assetCode?: string;
  assetIssuer?: string;
  exchangeRateUsd?: number;
  onBalanceChange?: (result: FormattedBalanceResult) => void;
}

export default function AssetBalanceCard({
  initialStroops = 12505000000n, // Default 1,250.5000000 XLM
  assetCode = "XLM",
  assetIssuer,
  exchangeRateUsd = 0.125,
  onBalanceChange,
}: AssetBalanceCardProps) {
  const [stroops, setStroops] = useState<string>(String(initialStroops));
  const [fiatCurrency, setFiatCurrency] = useState<"USD" | "EUR" | "GBP">("USD");
  const [locale, setLocale] = useState<string>("en-US");
  const [showFullPrecision, setShowFullPrecision] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Compute formatted balance
  const balanceResult = useMemo(() => {
    const res = formatMultiCurrencyValue(stroops, {
      assetCode,
      exchangeRateUsd,
      fiatCurrency,
      locale,
      stripTrailingZeros: !showFullPrecision,
    });
    if (onBalanceChange) onBalanceChange(res);
    return res;
  }, [stroops, assetCode, exchangeRateUsd, fiatCurrency, locale, showFullPrecision, onBalanceChange]);

  const handleCopy = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(`${balanceResult.tokenFormatted} ${assetCode}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleRefreshRate = () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 600);
  };

  return (
    <div
      className="w-full max-w-xl rounded-2xl border border-slate-800 bg-slate-950/80 p-5 shadow-2xl backdrop-blur-xl"
      data-testid="asset-balance-card"
    >
      {/* Header with Asset Identity and Currency Switcher */}
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/10 text-teal-400 border border-teal-500/20">
            <Coins size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-white tracking-wide">{assetCode} Balance</h3>
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-400">
                Stellar Native
              </span>
            </div>
            <p className="text-[11px] font-mono text-slate-500 truncate max-w-[14rem]">
              {assetIssuer ? `Issuer: ${assetIssuer}` : "Native Lumens (10^7 Stroops)"}
            </p>
          </div>
        </div>

        {/* Currency & Locale Selector */}
        <div className="flex items-center gap-2">
          {/* Fiat Currency Selector */}
          <div className="flex rounded-lg border border-slate-800 bg-slate-900/60 p-0.5">
            {(["USD", "EUR", "GBP"] as const).map((curr) => (
              <button
                key={curr}
                onClick={() => setFiatCurrency(curr)}
                className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-all ${
                  fiatCurrency === curr
                    ? "bg-teal-500/20 text-teal-300 shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
                data-testid={`fiat-toggle-${curr.toLowerCase()}`}
              >
                {curr}
              </button>
            ))}
          </div>

          {/* Locale Selector */}
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
            className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-[11px] text-slate-300 focus:outline-none focus:border-teal-500"
            data-testid="locale-select"
            aria-label="Select Locale"
          >
            <option value="en-US">en-US (1,234.56)</option>
            <option value="de-DE">de-DE (1.234,56)</option>
            <option value="fr-FR">fr-FR (1 234,56)</option>
            <option value="ar-SA">ar-SA (العربية)</option>
          </select>
        </div>
      </div>

      {/* Main Balance Display */}
      <div className="my-5 flex flex-col items-center justify-center text-center">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-1">
          Available Balance
        </span>
        <div className="flex items-baseline gap-2">
          <span
            className="font-mono text-3xl font-extrabold text-white tracking-tight sm:text-4xl"
            data-testid="token-balance-text"
          >
            {balanceResult.tokenFormatted}
          </span>
          <span className="text-base font-bold text-teal-400">{assetCode}</span>
        </div>

        {/* Fiat Equivalent Badge */}
        <div className="mt-2 flex items-center gap-1.5 rounded-full border border-teal-500/30 bg-teal-500/10 px-3 py-1">
          <span className="text-xs font-semibold text-teal-300" data-testid="fiat-balance-text">
            ≈ {balanceResult.fiatFormatted}
          </span>
          <span className="text-[10px] text-teal-400/70">
            (@ ${exchangeRateUsd.toFixed(3)}/XLM)
          </span>
          <button
            onClick={handleRefreshRate}
            className={`text-teal-400/70 hover:text-teal-300 transition-colors ml-1 ${
              isRefreshing ? "animate-spin" : ""
            }`}
            title="Refresh exchange rate"
          >
            <RefreshCw size={11} />
          </button>
        </div>
      </div>

      {/* Raw Stroop Information & Action Bar */}
      <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-3">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 text-slate-400">
            <Info size={13} className="text-teal-400" />
            <span className="font-mono text-[11px]" data-testid="raw-stroops-text">
              Raw: {stroops} Stroops
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowFullPrecision(!showFullPrecision)}
              className="rounded-md border border-slate-800 bg-slate-800/60 px-2 py-0.5 text-[10px] text-slate-300 hover:text-white transition-colors"
            >
              {showFullPrecision ? "7 Decimals" : "Compact"}
            </button>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 rounded-md border border-slate-800 bg-slate-800/60 px-2 py-0.5 text-[10px] text-slate-300 hover:text-white transition-colors"
              data-testid="copy-balance-btn"
            >
              {copied ? <CheckCircle2 size={11} className="text-emerald-400" /> : <Copy size={11} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      </div>

      {/* Interactive Stroop Slider / Quick Test Buttons */}
      <div className="mt-4 pt-3 border-t border-slate-800/60">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 block mb-2">
          Test Amount Presets
        </span>
        <div className="flex flex-wrap gap-1.5">
          {[
            { label: "1 Stroop", val: "1" },
            { label: "1 XLM", val: "10000000" },
            { label: "100 XLM", val: "1000000000" },
            { label: "1,250.5 XLM", val: "12505000000" },
            { label: "1,000,000 XLM", val: "10000000000000" },
          ].map((preset) => (
            <button
              key={preset.label}
              onClick={() => setStroops(preset.val)}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all ${
                stroops === preset.val
                  ? "bg-teal-500/20 text-teal-300 border border-teal-500/40"
                  : "bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200"
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
