"use client";

// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * @file app/did/page.tsx
 * Decentralized Identity (DID) management page.
 *
 * Displays a credential card gallery for all credentials held by the
 * connected wallet, with per-card QR VP export and wallet-pass download.
 * Also provides a form to issue demo credentials for local testing.
 */

import React, { useState, useCallback, useMemo } from "react";
import {
  ShieldCheck,
  Plus,
  RefreshCw,
  Fingerprint,
  AlertCircle,
  Info,
  X,
} from "lucide-react";
import DidCredentialCard from "@/components/DidCredentialCard";
import type {
  VerifiableCredential,
  CardColorScheme,
} from "@/components/DidCredentialCard";
import type { CredentialSubject } from "@/types/did";

// ---------------------------------------------------------------------------
// Sample / demo credential factory
// (In production these come from the on-chain DID contract via the backend.)
// ---------------------------------------------------------------------------

let _demoSeq = 0;

function makeDemoCredential(overrides: {
  type: string;
  subjectDid: string;
  issuerDid: string;
  issuerName: string;
  claims?: Record<string, unknown>;
  expiresInDays?: number;
}): VerifiableCredential {
  const id = `did:stellar:${overrides.issuerDid}#vc-demo-${++_demoSeq}`;
  const now = new Date();
  const validFrom = now.toISOString();
  const validUntil = overrides.expiresInDays
    ? new Date(
        now.getTime() + overrides.expiresInDays * 86_400_000
      ).toISOString()
    : undefined;

  const subject: CredentialSubject = {
    id: `did:stellar:${overrides.subjectDid}`,
    ...(overrides.claims ?? {}),
  };

  return {
    "@context": [
      "https://www.w3.org/ns/credentials/v2",
      "https://www.w3.org/ns/credentials/examples/v2",
    ],
    id,
    type: ["VerifiableCredential", overrides.type],
    issuer: { id: `did:stellar:${overrides.issuerDid}`, name: overrides.issuerName },
    validFrom,
    ...(validUntil ? { validUntil } : {}),
    credentialSubject: subject,
    proof: {
      type: "Ed25519Signature2020",
      created: validFrom,
      verificationMethod: `did:stellar:${overrides.issuerDid}#key-1`,
      proofPurpose: "assertionMethod",
      proofValue:
        "z4oey5q2M3XKaxup3tmzN4A23kcAEe8oApB9pK7mH7a6TEcJGzQUcSjJBnmNnJWy",
    },
  };
}

const DEFAULT_CREDENTIALS: VerifiableCredential[] = [
  makeDemoCredential({
    type: "StellarDeveloperCredential",
    subjectDid: "GABC1234567890ABCDEFGHIJ",
    issuerDid: "GISSUER000STELLARDEVHUB",
    issuerName: "StellarDevHub",
    claims: { developerScore: 92, tier: "Senior" },
    expiresInDays: 365,
  }),
  makeDemoCredential({
    type: "KYCVerificationCredential",
    subjectDid: "GABC1234567890ABCDEFGHIJ",
    issuerDid: "GKYC00PROVIDER00STELLAR",
    issuerName: "Stellar KYC Provider",
    claims: { verificationLevel: "Enhanced", jurisdiction: "US" },
    expiresInDays: 180,
  }),
  makeDemoCredential({
    type: "AccreditedInvestorCredential",
    subjectDid: "GABC1234567890ABCDEFGHIJ",
    issuerDid: "GFINANCE0REGULATOR0STLR",
    issuerName: "Stellar Finance Authority",
    claims: { accreditationType: "IndividualNetWorth", annualIncome: ">200k" },
    // No expiry
  }),
];

// ---------------------------------------------------------------------------
// Issue-credential form
// ---------------------------------------------------------------------------

interface IssueFormState {
  credentialType: string;
  subjectDid: string;
  issuerDid: string;
  issuerName: string;
  claimsJson: string;
  expiresInDays: string;
}

const FORM_DEFAULTS: IssueFormState = {
  credentialType: "StellarDeveloperCredential",
  subjectDid: "GABC1234567890ABCDEFGHIJ",
  issuerDid: "GISSUER000STELLARDEVHUB",
  issuerName: "StellarDevHub",
  claimsJson: '{"developerScore": 85, "tier": "Mid-Level"}',
  expiresInDays: "365",
};

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function DidPage() {
  const [credentials, setCredentials] = useState<VerifiableCredential[]>(
    DEFAULT_CREDENTIALS
  );
  const [globalScheme, setGlobalScheme] = useState<CardColorScheme>("stellar-dark");
  const [showIssueForm, setShowIssueForm] = useState(false);
  const [form, setForm] = useState<IssueFormState>(FORM_DEFAULTS);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Show a brief toast notification
  const notify = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Simulate a network refresh of credentials
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await new Promise((r) => setTimeout(r, 800));
    setIsRefreshing(false);
    notify("Credentials refreshed from chain");
  }, [notify]);

  // Issue a new local demo credential
  const handleIssue = useCallback(() => {
    setFormError(null);
    let claims: Record<string, unknown> = {};
    if (form.claimsJson.trim()) {
      try {
        claims = JSON.parse(form.claimsJson) as Record<string, unknown>;
      } catch {
        setFormError("Claims JSON is invalid — check your syntax.");
        return;
      }
    }
    const days = parseInt(form.expiresInDays, 10);
    const vc = makeDemoCredential({
      type: form.credentialType.trim() || "VerifiableCredential",
      subjectDid: form.subjectDid.trim(),
      issuerDid: form.issuerDid.trim(),
      issuerName: form.issuerName.trim(),
      claims,
      expiresInDays: isNaN(days) || days <= 0 ? undefined : days,
    });
    setCredentials((prev) => [vc, ...prev]);
    setShowIssueForm(false);
    setForm(FORM_DEFAULTS);
    notify(`Issued "${vc.type.slice(-1)[0]}" credential`);
  }, [form, notify]);

  const handleRemove = useCallback((id: string) => {
    setCredentials((prev) => prev.filter((c) => c.id !== id));
    notify("Credential removed");
  }, [notify]);

  const schemeOptions: { value: CardColorScheme; label: string }[] = useMemo(
    () => [
      { value: "stellar-dark",     label: "Stellar Dark" },
      { value: "midnight-purple",  label: "Midnight Purple" },
      { value: "emerald",          label: "Emerald" },
      { value: "gold",             label: "Gold" },
      { value: "mono-light",       label: "Light" },
    ],
    []
  );

  return (
    <main
      id="main-content"
      className="min-h-screen bg-slate-950 text-white px-4 py-8 md:px-10"
    >
      {/* ── Page header ── */}
      <header className="max-w-5xl mx-auto mb-8">
        <div className="flex items-center gap-3 mb-2">
          <span className="p-2 rounded-xl bg-teal-900/50 border border-teal-700">
            <Fingerprint className="w-6 h-6 text-teal-400" />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-white">
              Decentralized Identity
            </h1>
            <p className="text-slate-400 text-sm">
              W3C Verifiable Credentials · QR Export · Wallet Passes
            </p>
          </div>
        </div>

        {/* Info banner */}
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-teal-800/50 bg-teal-900/20 px-4 py-3 text-sm text-teal-300">
          <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <p>
            Each card encodes a{" "}
            <span className="font-semibold">W3C Verifiable Presentation</span>{" "}
            (VP_TOKEN) into a QR code that any OpenID4VP-compatible mobile
            wallet can scan. Use the export buttons to download Apple Wallet or
            Google Wallet pass payloads.
          </p>
        </div>
      </header>

      {/* ── Toolbar ── */}
      <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-2">
          {/* Global theme picker */}
          <label
            htmlFor="global-theme-select"
            className="text-xs text-slate-400 font-medium"
          >
            All cards:
          </label>
          <select
            id="global-theme-select"
            value={globalScheme}
            onChange={(e) =>
              setGlobalScheme(e.target.value as CardColorScheme)
            }
            className="bg-slate-800 border border-slate-600 text-white text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-500"
            aria-label="Apply color theme to all cards"
            data-testid="global-theme-select"
          >
            {schemeOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 text-xs font-medium transition-colors disabled:opacity-60"
            aria-label="Refresh credentials from chain"
            data-testid="refresh-btn"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`}
            />
            {isRefreshing ? "Refreshing…" : "Refresh"}
          </button>

          <button
            type="button"
            onClick={() => setShowIssueForm((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-600 text-white text-xs font-semibold transition-colors"
            aria-label="Issue a new demo credential"
            data-testid="issue-credential-btn"
          >
            <Plus className="w-3.5 h-3.5" />
            Issue Credential
          </button>
        </div>
      </div>

      {/* ── Issue credential form ── */}
      {showIssueForm && (
        <div
          className="max-w-5xl mx-auto mb-6 rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-xl"
          data-testid="issue-form"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-teal-400" />
              <h2 className="text-sm font-semibold text-white">
                Issue Demo Credential
              </h2>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowIssueForm(false);
                setFormError(null);
              }}
              className="text-slate-500 hover:text-slate-300 transition-colors"
              aria-label="Close issue form"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {formError && (
            <div
              className="mb-3 flex items-start gap-2 rounded-lg border border-red-700 bg-red-900/30 px-3 py-2.5 text-xs text-red-300"
              role="alert"
              data-testid="form-error"
            >
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              {formError}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(
              [
                { key: "credentialType", label: "Credential Type", placeholder: "e.g. StellarDeveloperCredential" },
                { key: "issuerName",     label: "Issuer Name",     placeholder: "e.g. StellarDevHub" },
                { key: "issuerDid",      label: "Issuer DID / Key", placeholder: "e.g. GISSUER000STELLAR" },
                { key: "subjectDid",     label: "Holder DID / Key", placeholder: "e.g. GABC1234567890" },
              ] as const
            ).map(({ key, label, placeholder }) => (
              <div key={key} className="flex flex-col gap-1">
                <label
                  htmlFor={`form-${key}`}
                  className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold"
                >
                  {label}
                </label>
                <input
                  id={`form-${key}`}
                  type="text"
                  value={form[key]}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, [key]: e.target.value }))
                  }
                  placeholder={placeholder}
                  className="bg-slate-800 border border-slate-600 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-teal-500 font-mono placeholder-slate-600"
                  data-testid={`form-${key}`}
                />
              </div>
            ))}

            {/* Claims JSON */}
            <div className="md:col-span-2 flex flex-col gap-1">
              <label
                htmlFor="form-claimsJson"
                className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold"
              >
                Claims JSON
              </label>
              <textarea
                id="form-claimsJson"
                value={form.claimsJson}
                onChange={(e) =>
                  setForm((f) => ({ ...f, claimsJson: e.target.value }))
                }
                rows={3}
                placeholder='{"score": 90}'
                className="bg-slate-800 border border-slate-600 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-teal-500 font-mono placeholder-slate-600 resize-none"
                data-testid="form-claimsJson"
              />
            </div>

            {/* Expiry */}
            <div className="flex flex-col gap-1">
              <label
                htmlFor="form-expiresInDays"
                className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold"
              >
                Expires in (days, 0 = no expiry)
              </label>
              <input
                id="form-expiresInDays"
                type="number"
                min="0"
                value={form.expiresInDays}
                onChange={(e) =>
                  setForm((f) => ({ ...f, expiresInDays: e.target.value }))
                }
                className="bg-slate-800 border border-slate-600 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-teal-500"
                data-testid="form-expiresInDays"
              />
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowIssueForm(false);
                setFormError(null);
              }}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 text-xs font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleIssue}
              className="px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-600 text-white text-xs font-semibold transition-colors"
              data-testid="submit-issue-btn"
            >
              Issue &amp; Add Card
            </button>
          </div>
        </div>
      )}

      {/* ── Credential card gallery ── */}
      {credentials.length === 0 ? (
        <div className="max-w-5xl mx-auto flex flex-col items-center justify-center gap-4 py-20 text-center">
          <Fingerprint className="w-12 h-12 text-slate-700" />
          <p className="text-slate-500 text-sm">
            No credentials yet. Issue one above or connect a wallet.
          </p>
        </div>
      ) : (
        <div
          className="max-w-5xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
          data-testid="credential-gallery"
        >
          {credentials.map((vc) => (
            <div key={vc.id} className="relative group">
              <DidCredentialCard
                credential={vc}
                initialTheme={{ colorScheme: globalScheme, showQr: true, showAvatar: false, showIssuerLogo: false }}
                hideThemePicker
                onCopyToken={() => notify("VP Token copied to clipboard")}
                onExportApple={() => notify("Apple Wallet pass.json downloaded")}
                onExportGoogle={() => notify("Google Wallet payload downloaded")}
              />
              {/* Remove button (shown on hover) */}
              <button
                type="button"
                onClick={() => handleRemove(vc.id)}
                className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-full bg-slate-800/80 border border-slate-600 text-slate-400 hover:text-red-400 hover:border-red-700"
                aria-label={`Remove credential ${vc.id}`}
                data-testid={`remove-credential-${vc.id}`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Toast notification ── */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full border border-teal-700 bg-slate-900 px-4 py-2 text-sm text-teal-300 shadow-xl"
          data-testid="toast"
        >
          <ShieldCheck className="w-4 h-4" />
          {toast}
        </div>
      )}
    </main>
  );
}
