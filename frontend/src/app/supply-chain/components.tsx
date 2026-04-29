"use client";

import React from "react";
import {
  Package,
  MapPin,
  ShieldCheck,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  Truck,
  Warehouse,
} from "lucide-react";
import type { Product, ProductStatus } from "./types";

// ── Status helpers ────────────────────────────────────────────────────────────

export const STATUS_COLOR: Record<ProductStatus, string> = {
  Registered: "text-slate-300",
  InTransit: "text-cyan-300",
  AtWarehouse: "text-blue-300",
  QualityCheck: "text-amber-300",
  Approved: "text-emerald-300",
  Rejected: "text-rose-300",
  Delivered: "text-teal-300",
  Recalled: "text-red-400",
};

export const STATUS_BG: Record<ProductStatus, string> = {
  Registered: "bg-slate-400/10 border-slate-400/20",
  InTransit: "bg-cyan-400/10 border-cyan-400/20",
  AtWarehouse: "bg-blue-400/10 border-blue-400/20",
  QualityCheck: "bg-amber-400/10 border-amber-400/20",
  Approved: "bg-emerald-400/10 border-emerald-400/20",
  Rejected: "bg-rose-400/10 border-rose-400/20",
  Delivered: "bg-teal-400/10 border-teal-400/20",
  Recalled: "bg-red-400/10 border-red-400/20",
};

export const STATUS_ICON: Record<ProductStatus, React.ReactNode> = {
  Registered: <Package size={12} />,
  InTransit: <Truck size={12} />,
  AtWarehouse: <Warehouse size={12} />,
  QualityCheck: <ShieldCheck size={12} />,
  Approved: <CheckCircle size={12} />,
  Rejected: <XCircle size={12} />,
  Delivered: <CheckCircle size={12} />,
  Recalled: <AlertTriangle size={12} />,
};

export function short(addr: string) {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

export function fmtTime(ts: number) {
  return new Date(ts * 1000).toLocaleString();
}

// ── ProductCard ───────────────────────────────────────────────────────────────

interface ProductCardProps {
  product: Product;
  onRecall: (id: number) => void;
  onMarkDelivered: (id: number) => void;
  disabled: boolean;
}

export function ProductCard({ product, onRecall, onMarkDelivered, disabled }: ProductCardProps) {
  const { id, name, owner, status, createdAt, checkpointCount } = product as Product & {
    checkpointCount?: number;
  };

  return (
    <article
      className="rounded-xl border border-white/8 bg-slate-950/60 p-3 text-xs"
      aria-label={`Product ${id}: ${name}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="font-semibold text-slate-100">
            #{id} {name}
          </span>
          <p className="mt-0.5 text-slate-500">Owner: {short(owner)}</p>
          <p className="text-slate-600">Created: {fmtTime(createdAt)}</p>
          {(checkpointCount ?? 0) > 0 && (
            <p className="text-slate-500">
              <MapPin size={10} className="mr-0.5 inline" />
              {checkpointCount} checkpoint{checkpointCount !== 1 ? "s" : ""}
            </p>
          )}
        </div>
        <span
          className={`flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium ${STATUS_COLOR[status]} ${STATUS_BG[status]}`}
        >
          {STATUS_ICON[status]}
          {status}
        </span>
      </div>

      {status !== "Recalled" && (
        <div className="mt-2 flex gap-2">
          {status !== "Delivered" && (
            <button
              disabled={disabled}
              onClick={() => onMarkDelivered(id)}
              className="rounded-lg border border-teal-400/30 bg-teal-400/10 px-2 py-1 text-[10px] text-teal-200 transition hover:bg-teal-400/20 disabled:opacity-40"
              aria-label={`Mark product ${id} as delivered`}
            >
              Mark Delivered
            </button>
          )}
          <button
            disabled={disabled}
            onClick={() => onRecall(id)}
            className="rounded-lg border border-red-400/30 bg-red-400/10 px-2 py-1 text-[10px] text-red-300 transition hover:bg-red-400/20 disabled:opacity-40"
            aria-label={`Recall product ${id}`}
          >
            Recall
          </button>
        </div>
      )}
    </article>
  );
}

// ── StatusBadge ───────────────────────────────────────────────────────────────

export function PausedBanner() {
  return (
    <div
      role="alert"
      className="mb-3 flex items-center gap-2 rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-300"
    >
      <AlertTriangle size={14} />
      Contract is paused — mutations are disabled.
    </div>
  );
}

// ── Input helpers ─────────────────────────────────────────────────────────────

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export function Field({ label, error, id, ...rest }: InputProps) {
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div>
      <label htmlFor={inputId} className="mb-1 block text-[10px] text-slate-500">
        {label}
      </label>
      <input
        id={inputId}
        {...rest}
        aria-invalid={!!error}
        aria-describedby={error ? `${inputId}-err` : undefined}
        className={`w-full rounded-xl border bg-slate-950/70 px-3 py-2 text-xs text-slate-200 outline-none placeholder:text-slate-600 ${
          error ? "border-red-400/50" : "border-white/10"
        }`}
      />
      {error && (
        <p id={`${inputId}-err`} role="alert" className="mt-0.5 text-[10px] text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

export function SubmitButton({
  children,
  disabled,
  color = "cyan",
}: {
  children: React.ReactNode;
  disabled?: boolean;
  color?: "cyan" | "blue" | "emerald" | "rose" | "amber";
}) {
  const colors = {
    cyan: "border-cyan-400/30 bg-cyan-400/10 text-cyan-200 hover:bg-cyan-400/20",
    blue: "border-blue-400/30 bg-blue-400/10 text-blue-200 hover:bg-blue-400/20",
    emerald: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20",
    rose: "border-rose-400/30 bg-rose-400/10 text-rose-200 hover:bg-rose-400/20",
    amber: "border-amber-400/30 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20",
  };
  return (
    <button
      type="submit"
      disabled={disabled}
      className={`flex w-full items-center justify-center gap-2 rounded-xl border py-2 text-xs font-medium transition disabled:opacity-40 ${colors[color]}`}
    >
      {children}
    </button>
  );
}
