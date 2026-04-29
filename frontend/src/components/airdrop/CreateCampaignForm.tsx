"use client";

import React, { useState } from "react";
import { PlusCircle, X } from "lucide-react";
import type { Campaign } from "../hooks/useAirdrop";

interface Props {
  walletAddress: string | null;
  onSubmit: (data: Omit<Campaign, "id" | "claimedAmount" | "remainingAmount" | "claimCount" | "allowlistSize" | "createdAt">) => Promise<void>;
  onCancel: () => void;
}

const now = () => Math.floor(Date.now() / 1000);

export default function CreateCampaignForm({ walletAddress, onSubmit, onCancel }: Props) {
  const [form, setForm] = useState({
    name: "",
    description: "",
    token: "",
    amountPerClaim: "",
    totalAmount: "",
    startTimestamp: now() + 60,
    endTimestamp: now() + 86400 * 7,
    requireAllowlist: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function set(key: string, value: unknown) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => { const n = { ...e }; delete n[key]; return n; });
  }

  function validate() {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Name is required";
    if (!form.token.trim()) e.token = "Token address is required";
    if (!form.amountPerClaim || Number(form.amountPerClaim) <= 0) e.amountPerClaim = "Must be > 0";
    if (!form.totalAmount || Number(form.totalAmount) <= 0) e.totalAmount = "Must be > 0";
    if (Number(form.totalAmount) < Number(form.amountPerClaim)) e.totalAmount = "Must be ≥ amount per claim";
    if (form.endTimestamp <= form.startTimestamp) e.endTimestamp = "Must be after start";
    return e;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }

    setSubmitting(true);
    try {
      await onSubmit({
        admin: walletAddress || "demo-admin",
        token: form.token,
        name: form.name,
        description: form.description,
        amountPerClaim: Number(form.amountPerClaim),
        totalAmount: Number(form.totalAmount),
        startTimestamp: form.startTimestamp,
        endTimestamp: form.endTimestamp,
        requireAllowlist: form.requireAllowlist,
        status: "active",
      });
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls = (field: string) =>
    `w-full bg-gray-800 border rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
      errors[field] ? "border-red-500" : "border-gray-700"
    }`;

  return (
    <form onSubmit={handleSubmit} className="space-y-4" aria-label="Create airdrop campaign">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <PlusCircle className="w-5 h-5 text-indigo-400" aria-hidden="true" />
          New Campaign
        </h3>
        <button type="button" onClick={onCancel} aria-label="Cancel" className="text-gray-400 hover:text-white">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-gray-400 mb-1" htmlFor="camp-name">Campaign Name</label>
          <input id="camp-name" className={inputCls("name")} value={form.name}
            onChange={(e) => set("name", e.target.value)} placeholder="My Airdrop" />
          {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name}</p>}
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1" htmlFor="camp-token">Token Address</label>
          <input id="camp-token" className={inputCls("token")} value={form.token}
            onChange={(e) => set("token", e.target.value)} placeholder="C..." />
          {errors.token && <p className="text-red-400 text-xs mt-1">{errors.token}</p>}
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1" htmlFor="camp-per-claim">Amount Per Claim</label>
          <input id="camp-per-claim" type="number" min="1" className={inputCls("amountPerClaim")}
            value={form.amountPerClaim} onChange={(e) => set("amountPerClaim", e.target.value)} placeholder="100" />
          {errors.amountPerClaim && <p className="text-red-400 text-xs mt-1">{errors.amountPerClaim}</p>}
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1" htmlFor="camp-total">Total Amount</label>
          <input id="camp-total" type="number" min="1" className={inputCls("totalAmount")}
            value={form.totalAmount} onChange={(e) => set("totalAmount", e.target.value)} placeholder="10000" />
          {errors.totalAmount && <p className="text-red-400 text-xs mt-1">{errors.totalAmount}</p>}
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1" htmlFor="camp-start">Start (unix timestamp)</label>
          <input id="camp-start" type="number" className={inputCls("startTimestamp")}
            value={form.startTimestamp} onChange={(e) => set("startTimestamp", Number(e.target.value))} />
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1" htmlFor="camp-end">End (unix timestamp)</label>
          <input id="camp-end" type="number" className={inputCls("endTimestamp")}
            value={form.endTimestamp} onChange={(e) => set("endTimestamp", Number(e.target.value))} />
          {errors.endTimestamp && <p className="text-red-400 text-xs mt-1">{errors.endTimestamp}</p>}
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1" htmlFor="camp-desc">Description</label>
        <textarea id="camp-desc" rows={2} className={inputCls("description")}
          value={form.description} onChange={(e) => set("description", e.target.value)}
          placeholder="Optional description..." />
      </div>

      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input type="checkbox" className="w-4 h-4 accent-indigo-500"
          checked={form.requireAllowlist} onChange={(e) => set("requireAllowlist", e.target.checked)} />
        <span className="text-sm text-gray-300">Require allowlist</span>
      </label>

      <div className="flex gap-3 pt-2">
        <button type="submit" disabled={submitting}
          className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors">
          {submitting ? "Creating…" : "Create Campaign"}
        </button>
        <button type="button" onClick={onCancel}
          className="flex-1 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium py-2 rounded-lg transition-colors">
          Cancel
        </button>
      </div>
    </form>
  );
}
