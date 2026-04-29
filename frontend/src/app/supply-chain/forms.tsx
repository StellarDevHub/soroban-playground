"use client";

import React, { useState } from "react";
import { Plus, MapPin, ShieldCheck, CheckCircle, XCircle, Clock } from "lucide-react";
import type { QualityResult } from "./types";
import { Field, SubmitButton } from "./components";

// ── Register Product Form ─────────────────────────────────────────────────────

interface RegisterFormProps {
  disabled: boolean;
  onSubmit: (name: string, metadataHash: number) => Promise<void>;
}

export function RegisterForm({ disabled, onSubmit }: RegisterFormProps) {
  const [name, setName] = useState("");
  const [hash, setHash] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError("Product name is required"); return; }
    setError("");
    setBusy(true);
    try {
      await onSubmit(name.trim(), parseInt(hash) || 0);
      setName("");
      setHash("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to register product");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2" aria-label="Register product form">
      <Field
        label="Product name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Widget A"
        error={error}
        required
      />
      <Field
        label="Metadata hash"
        type="number"
        value={hash}
        onChange={(e) => setHash(e.target.value)}
        placeholder="SHA-256 hash (numeric)"
      />
      <SubmitButton disabled={disabled || busy || !name.trim()} color="cyan">
        <Plus size={12} />
        {busy ? "Registering…" : "Register Product"}
      </SubmitButton>
    </form>
  );
}

// ── Add Checkpoint Form ───────────────────────────────────────────────────────

interface CheckpointFormProps {
  disabled: boolean;
  onSubmit: (productId: number, locationHash: number, notesHash: number) => Promise<void>;
}

export function CheckpointForm({ disabled, onSubmit }: CheckpointFormProps) {
  const [productId, setProductId] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productId) { setError("Product ID is required"); return; }
    setError("");
    setBusy(true);
    try {
      await onSubmit(parseInt(productId), parseInt(location) || 0, parseInt(notes) || 0);
      setProductId("");
      setLocation("");
      setNotes("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add checkpoint");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2" aria-label="Add checkpoint form">
      <Field
        label="Product ID"
        type="number"
        value={productId}
        onChange={(e) => setProductId(e.target.value)}
        placeholder="1"
        error={error}
        required
      />
      <Field
        label="Location hash"
        type="number"
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        placeholder="Location identifier"
      />
      <Field
        label="Notes hash"
        type="number"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes identifier"
      />
      <SubmitButton disabled={disabled || busy || !productId} color="blue">
        <MapPin size={12} />
        {busy ? "Adding…" : "Add Checkpoint"}
      </SubmitButton>
    </form>
  );
}

// ── Quality Report Form ───────────────────────────────────────────────────────

interface QualityFormProps {
  disabled: boolean;
  onSubmit: (productId: number, result: QualityResult, reportHash: number) => Promise<void>;
}

export function QualityForm({ disabled, onSubmit }: QualityFormProps) {
  const [productId, setProductId] = useState("");
  const [result, setResult] = useState<QualityResult>("Pass");
  const [hash, setHash] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productId) { setError("Product ID is required"); return; }
    setError("");
    setBusy(true);
    try {
      await onSubmit(parseInt(productId), result, parseInt(hash) || 0);
      setProductId("");
      setHash("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit report");
    } finally {
      setBusy(false);
    }
  };

  const colorMap: Record<QualityResult, "emerald" | "rose" | "amber"> = {
    Pass: "emerald",
    Fail: "rose",
    Pending: "amber",
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2" aria-label="Quality report form">
      <Field
        label="Product ID"
        type="number"
        value={productId}
        onChange={(e) => setProductId(e.target.value)}
        placeholder="1"
        error={error}
        required
      />
      <div>
        <label htmlFor="qa-result" className="mb-1 block text-[10px] text-slate-500">
          Result
        </label>
        <select
          id="qa-result"
          value={result}
          onChange={(e) => setResult(e.target.value as QualityResult)}
          className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-slate-200 outline-none"
        >
          <option value="Pass">Pass</option>
          <option value="Fail">Fail</option>
          <option value="Pending">Pending</option>
        </select>
      </div>
      <Field
        label="Report hash"
        type="number"
        value={hash}
        onChange={(e) => setHash(e.target.value)}
        placeholder="Report identifier"
      />
      <SubmitButton disabled={disabled || busy || !productId} color={colorMap[result]}>
        {result === "Pass" ? <CheckCircle size={12} /> : result === "Fail" ? <XCircle size={12} /> : <Clock size={12} />}
        {busy ? "Submitting…" : "Submit QA Report"}
      </SubmitButton>
    </form>
  );
}

// ── Pause Controls ────────────────────────────────────────────────────────────

interface PauseControlsProps {
  paused: boolean;
  disabled: boolean;
  onPause: () => Promise<void>;
  onUnpause: () => Promise<void>;
}

export function PauseControls({ paused, disabled, onPause, onUnpause }: PauseControlsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handle = async (fn: () => Promise<void>) => {
    setError("");
    setBusy(true);
    try { await fn(); } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-2">
      <p className="text-[10px] text-slate-500">
        Current state:{" "}
        <span className={paused ? "text-red-400" : "text-emerald-400"}>
          {paused ? "Paused" : "Active"}
        </span>
      </p>
      {error && <p role="alert" className="text-[10px] text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button
          disabled={disabled || busy || paused}
          onClick={() => handle(onPause)}
          className="flex-1 rounded-xl border border-red-400/30 bg-red-400/10 py-2 text-xs text-red-300 transition hover:bg-red-400/20 disabled:opacity-40"
          aria-label="Pause contract"
        >
          {busy && paused ? "…" : "Pause"}
        </button>
        <button
          disabled={disabled || busy || !paused}
          onClick={() => handle(onUnpause)}
          className="flex-1 rounded-xl border border-emerald-400/30 bg-emerald-400/10 py-2 text-xs text-emerald-300 transition hover:bg-emerald-400/20 disabled:opacity-40"
          aria-label="Unpause contract"
        >
          {busy && !paused ? "…" : "Unpause"}
        </button>
      </div>
    </div>
  );
}
