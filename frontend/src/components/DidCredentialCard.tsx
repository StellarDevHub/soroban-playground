// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * @file DidCredentialCard.tsx
 * Customizable W3C Verifiable Credential card with:
 *  - Issuer attestation display (name, DID, proof type)
 *  - Validity timestamps with live expiry countdown
 *  - SVG QR code encoding a VP_TOKEN claim (OpenID4VP)
 *  - 5-theme color-scheme picker
 *  - One-click export to Apple Wallet pass.json and Google Wallet JWT payload
 *  - Copy-to-clipboard for the raw VP token
 */

"use client";

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import {
  ShieldCheck,
  ShieldAlert,
  Copy,
  Check,
  Download,
  QrCode,
  Wallet,
  Clock,
  Calendar,
  User,
  Building2,
  Fingerprint,
  Palette,
  X,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Smartphone,
} from "lucide-react";

import type {
  VerifiableCredential,
  VerifiablePresentation,
  CardTheme,
  CardColorScheme,
  QrCodeResult,
  VpQrPayload,
} from "@/types/did";
import { buildVpToken, generateQrSvg } from "@/lib/did/qrEncoder";
import {
  downloadApplePassJson,
  downloadGoogleWalletPayload,
} from "@/lib/did/walletPass";

// ---------------------------------------------------------------------------
// Theme definitions
// ---------------------------------------------------------------------------

interface ThemeTokens {
  card: string;
  cardBorder: string;
  header: string;
  accentBar: string;
  titleText: string;
  subtitleText: string;
  bodyText: string;
  mutedText: string;
  fieldBg: string;
  fieldBorder: string;
  badgeValid: string;
  badgeExpired: string;
  badgePending: string;
  btnPrimary: string;
  btnSecondary: string;
  qrBg: string;
  qrDark: string;
  sectionDivider: string;
}

const THEMES: Record<CardColorScheme, ThemeTokens> = {
  "stellar-dark": {
    card: "bg-slate-900",
    cardBorder: "border-slate-700",
    header: "bg-gradient-to-r from-slate-800 to-slate-900",
    accentBar: "bg-gradient-to-r from-teal-500 to-cyan-400",
    titleText: "text-white",
    subtitleText: "text-teal-300",
    bodyText: "text-slate-200",
    mutedText: "text-slate-400",
    fieldBg: "bg-slate-800",
    fieldBorder: "border-slate-600",
    badgeValid: "bg-teal-900/50 text-teal-300 border-teal-700",
    badgeExpired: "bg-red-900/50 text-red-300 border-red-700",
    badgePending: "bg-yellow-900/50 text-yellow-300 border-yellow-700",
    btnPrimary: "bg-teal-600 hover:bg-teal-500 text-white",
    btnSecondary: "bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600",
    qrBg: "#0f172a",
    qrDark: "#2dd4bf",
    sectionDivider: "border-slate-700",
  },
  "midnight-purple": {
    card: "bg-purple-950",
    cardBorder: "border-purple-800",
    header: "bg-gradient-to-r from-purple-900 to-indigo-950",
    accentBar: "bg-gradient-to-r from-purple-500 to-indigo-400",
    titleText: "text-white",
    subtitleText: "text-purple-300",
    bodyText: "text-purple-100",
    mutedText: "text-purple-400",
    fieldBg: "bg-purple-900/60",
    fieldBorder: "border-purple-700",
    badgeValid: "bg-purple-900/50 text-purple-200 border-purple-600",
    badgeExpired: "bg-red-950 text-red-300 border-red-700",
    badgePending: "bg-yellow-950 text-yellow-300 border-yellow-700",
    btnPrimary: "bg-purple-600 hover:bg-purple-500 text-white",
    btnSecondary: "bg-purple-900 hover:bg-purple-800 text-purple-200 border border-purple-700",
    qrBg: "#1e1b4b",
    qrDark: "#c084fc",
    sectionDivider: "border-purple-800",
  },
  emerald: {
    card: "bg-emerald-950",
    cardBorder: "border-emerald-800",
    header: "bg-gradient-to-r from-emerald-900 to-teal-950",
    accentBar: "bg-gradient-to-r from-emerald-400 to-teal-400",
    titleText: "text-white",
    subtitleText: "text-emerald-300",
    bodyText: "text-emerald-100",
    mutedText: "text-emerald-400",
    fieldBg: "bg-emerald-900/50",
    fieldBorder: "border-emerald-700",
    badgeValid: "bg-emerald-900/50 text-emerald-200 border-emerald-600",
    badgeExpired: "bg-red-950 text-red-300 border-red-700",
    badgePending: "bg-yellow-950 text-yellow-300 border-yellow-700",
    btnPrimary: "bg-emerald-600 hover:bg-emerald-500 text-white",
    btnSecondary: "bg-emerald-900 hover:bg-emerald-800 text-emerald-200 border border-emerald-700",
    qrBg: "#022c22",
    qrDark: "#34d399",
    sectionDivider: "border-emerald-800",
  },
  gold: {
    card: "bg-amber-950",
    cardBorder: "border-amber-800",
    header: "bg-gradient-to-r from-amber-900 to-orange-950",
    accentBar: "bg-gradient-to-r from-amber-400 to-orange-400",
    titleText: "text-white",
    subtitleText: "text-amber-300",
    bodyText: "text-amber-100",
    mutedText: "text-amber-400",
    fieldBg: "bg-amber-900/40",
    fieldBorder: "border-amber-700",
    badgeValid: "bg-amber-900/50 text-amber-200 border-amber-600",
    badgeExpired: "bg-red-950 text-red-300 border-red-700",
    badgePending: "bg-yellow-950 text-yellow-300 border-yellow-800",
    btnPrimary: "bg-amber-600 hover:bg-amber-500 text-white",
    btnSecondary: "bg-amber-900 hover:bg-amber-800 text-amber-200 border border-amber-700",
    qrBg: "#1c1004",
    qrDark: "#fbbf24",
    sectionDivider: "border-amber-800",
  },
  "mono-light": {
    card: "bg-white",
    cardBorder: "border-slate-200",
    header: "bg-gradient-to-r from-slate-50 to-white",
    accentBar: "bg-gradient-to-r from-slate-800 to-slate-600",
    titleText: "text-slate-900",
    subtitleText: "text-slate-600",
    bodyText: "text-slate-700",
    mutedText: "text-slate-500",
    fieldBg: "bg-slate-50",
    fieldBorder: "border-slate-200",
    badgeValid: "bg-green-50 text-green-700 border-green-200",
    badgeExpired: "bg-red-50 text-red-700 border-red-200",
    badgePending: "bg-yellow-50 text-yellow-700 border-yellow-200",
    btnPrimary: "bg-slate-800 hover:bg-slate-700 text-white",
    btnSecondary: "bg-white hover:bg-slate-50 text-slate-700 border border-slate-300",
    qrBg: "#ffffff",
    qrDark: "#0f172a",
    sectionDivider: "border-slate-200",
  },
};

const SCHEME_LABELS: Record<CardColorScheme, string> = {
  "stellar-dark": "Stellar Dark",
  "midnight-purple": "Midnight Purple",
  emerald: "Emerald",
  gold: "Gold",
  "mono-light": "Light",
};

const ALL_SCHEMES = Object.keys(SCHEME_LABELS) as CardColorScheme[];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DidCredentialCardProps {
  /** The W3C Verifiable Credential to display. */
  credential: VerifiableCredential;
  /**
   * Optional pre-built Verifiable Presentation to encode into the QR code.
   * When omitted the card wraps `credential` in a minimal VP automatically.
   */
  presentation?: VerifiablePresentation;
  /** Initial card theme. Defaults to "stellar-dark". */
  initialTheme?: CardTheme;
  /** Hide the theme picker (useful when embedding in a fixed-theme parent). */
  hideThemePicker?: boolean;
  /** Called whenever the user copies the VP token to the clipboard. */
  onCopyToken?: (token: string) => void;
  /** Called when the user triggers an Apple Wallet export. */
  onExportApple?: (passJson: string) => void;
  /** Called when the user triggers a Google Wallet export. */
  onExportGoogle?: (payloadJson: string) => void;
  className?: string;
}

type ValidityStatus = "valid" | "expired" | "not-yet-valid" | "no-expiry";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getIssuerDisplay(vc: VerifiableCredential): {
  name: string;
  did: string;
} {
  if (typeof vc.issuer === "string") {
    return { name: vc.issuer, did: vc.issuer };
  }
  return {
    name: vc.issuer.name ?? vc.issuer.id,
    did: vc.issuer.id,
  };
}

function credentialTypes(vc: VerifiableCredential): string[] {
  return vc.type.filter((t) => t !== "VerifiableCredential");
}

function computeValidity(vc: VerifiableCredential): ValidityStatus {
  const now = new Date();
  if (vc.validFrom && new Date(vc.validFrom) > now) return "not-yet-valid";
  if (!vc.validUntil) return "no-expiry";
  return new Date(vc.validUntil) >= now ? "valid" : "expired";
}

function formatTimestamp(iso: string | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return iso;
  }
}

/** Returns "Xd Yh Zm" remaining or "Expired" string. */
function timeRemaining(validUntil: string | undefined): string {
  if (!validUntil) return "";
  const diff = new Date(validUntil).getTime() - Date.now();
  if (diff <= 0) return "Expired";
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  if (days > 0) return `${days}d ${hours}h remaining`;
  if (hours > 0) return `${hours}h ${mins}m remaining`;
  return `${mins}m remaining`;
}

function wrapInPresentation(vc: VerifiableCredential): VerifiablePresentation {
  return {
    "@context": [
      "https://www.w3.org/ns/credentials/v2",
      "https://www.w3.org/ns/credentials/examples/v2",
    ],
    type: ["VerifiablePresentation"],
    holder: vc.credentialSubject.id,
    verifiableCredential: [vc],
  };
}

function truncate(str: string, max = 36): string {
  return str.length <= max ? str : str.slice(0, max - 3) + "…";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({
  status,
  tokens,
}: {
  status: ValidityStatus;
  tokens: ThemeTokens;
}) {
  const cfg: Record<ValidityStatus, { cls: string; icon: React.ReactNode; label: string }> = {
    valid: {
      cls: tokens.badgeValid,
      icon: <ShieldCheck className="w-3.5 h-3.5" />,
      label: "Valid",
    },
    expired: {
      cls: tokens.badgeExpired,
      icon: <ShieldAlert className="w-3.5 h-3.5" />,
      label: "Expired",
    },
    "not-yet-valid": {
      cls: tokens.badgePending,
      icon: <Clock className="w-3.5 h-3.5" />,
      label: "Not Yet Valid",
    },
    "no-expiry": {
      cls: tokens.badgeValid,
      icon: <ShieldCheck className="w-3.5 h-3.5" />,
      label: "No Expiry",
    },
  };
  const { cls, icon, label } = cfg[status];
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}
    >
      {icon}
      {label}
    </span>
  );
}

function FieldRow({
  icon,
  label,
  value,
  mono = false,
  tokens,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
  tokens: ThemeTokens;
}) {
  return (
    <div
      className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border ${tokens.fieldBg} ${tokens.fieldBorder}`}
    >
      <span className={`mt-0.5 flex-shrink-0 ${tokens.mutedText}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className={`text-[10px] uppercase tracking-widest font-semibold mb-0.5 ${tokens.mutedText}`}>
          {label}
        </p>
        <p
          className={`text-sm break-all ${mono ? "font-mono" : "font-medium"} ${tokens.bodyText}`}
          title={value}
        >
          {value}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function DidCredentialCard({
  credential,
  presentation,
  initialTheme,
  hideThemePicker = false,
  onCopyToken,
  onExportApple,
  onExportGoogle,
  className = "",
}: DidCredentialCardProps) {
  const [scheme, setScheme] = useState<CardColorScheme>(
    initialTheme?.colorScheme ?? "stellar-dark"
  );
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [showQr, setShowQr] = useState(initialTheme?.showQr ?? true);
  const [showProof, setShowProof] = useState(false);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState<"apple" | "google" | null>(null);
  const [remaining, setRemaining] = useState(() =>
    timeRemaining(credential.validUntil)
  );

  const tk = THEMES[scheme];

  // Build VP + QR lazily, keyed on credential id + scheme
  const { vpPayload, qr } = useMemo<{
    vpPayload: VpQrPayload;
    qr: QrCodeResult;
  }>(() => {
    const vp = presentation ?? wrapInPresentation(credential);
    const payload = buildVpToken(vp, {
      label: credentialTypes(credential).join(" · ") || "Verifiable Credential",
    });
    const result = generateQrSvg(payload.raw, {
      size: 200,
      darkColor: tk.qrDark,
      lightColor: tk.qrBg,
    });
    return { vpPayload: payload, qr: result };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credential.id, scheme]);

  // Live countdown ticker
  useEffect(() => {
    if (!credential.validUntil) return;
    const id = setInterval(() => {
      setRemaining(timeRemaining(credential.validUntil));
    }, 30_000);
    return () => clearInterval(id);
  }, [credential.validUntil]);

  const validity = computeValidity(credential);
  const issuer = getIssuerDisplay(credential);
  const types = credentialTypes(credential);

  // Copy VP token
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(vpPayload.raw);
      setCopied(true);
      onCopyToken?.(vpPayload.raw);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (non-secure context)
    }
  }, [vpPayload.raw, onCopyToken]);

  // Apple Wallet export
  const handleAppleExport = useCallback(() => {
    setExporting("apple");
    try {
      const bgColors: Record<CardColorScheme, string> = {
        "stellar-dark": "#0f172a",
        "midnight-purple": "#1e1b4b",
        emerald: "#022c22",
        gold: "#1c1004",
        "mono-light": "#ffffff",
      };
      downloadApplePassJson(credential, vpPayload.raw, {
        backgroundColor: bgColors[scheme],
      });
      onExportApple?.(JSON.stringify(credential));
    } finally {
      setTimeout(() => setExporting(null), 1500);
    }
  }, [credential, vpPayload.raw, scheme, onExportApple]);

  // Google Wallet export
  const handleGoogleExport = useCallback(() => {
    setExporting("google");
    try {
      const bgColors: Record<CardColorScheme, string> = {
        "stellar-dark": "#0f172a",
        "midnight-purple": "#1e1b4b",
        emerald: "#022c22",
        gold: "#1c1004",
        "mono-light": "#f8fafc",
      };
      downloadGoogleWalletPayload(credential, vpPayload.raw, undefined, {
        backgroundColor: bgColors[scheme],
      });
      onExportGoogle?.(JSON.stringify(credential));
    } finally {
      setTimeout(() => setExporting(null), 1500);
    }
  }, [credential, vpPayload.raw, scheme, onExportGoogle]);

  const svgRef = useRef<HTMLDivElement>(null);

  return (
    <article
      data-testid="did-credential-card"
      className={`rounded-2xl border overflow-hidden shadow-2xl w-full max-w-sm ${tk.card} ${tk.cardBorder} ${className}`}
      aria-label={`Credential card: ${types.join(", ") || "Verifiable Credential"}`}
    >
      {/* ── Accent bar ── */}
      <div className={`h-1.5 w-full ${tk.accentBar}`} />

      {/* ── Header ── */}
      <header className={`px-5 pt-4 pb-3 ${tk.header}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className={`text-[10px] uppercase tracking-widest font-semibold ${tk.mutedText}`}>
              Verifiable Credential
            </p>
            <h2
              className={`mt-0.5 text-lg font-bold leading-tight truncate ${tk.titleText}`}
              data-testid="credential-type-heading"
            >
              {types[0] ?? "Identity Credential"}
            </h2>
            {types.length > 1 && (
              <p className={`text-xs mt-0.5 ${tk.subtitleText}`}>
                {types.slice(1).join(" · ")}
              </p>
            )}
          </div>

          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
            <StatusBadge status={validity} tokens={tk} />
            {remaining && validity !== "expired" && (
              <span
                className={`text-[10px] font-medium ${tk.mutedText}`}
                data-testid="time-remaining"
              >
                {remaining}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="px-5 pb-4 space-y-2.5">
        {/* Issuer */}
        <FieldRow
          icon={<Building2 className="w-4 h-4" />}
          label="Issuer"
          value={issuer.name}
          tokens={tk}
        />

        {/* Holder */}
        <FieldRow
          icon={<User className="w-4 h-4" />}
          label="Holder"
          value={truncate(credential.credentialSubject.id, 42)}
          mono
          tokens={tk}
        />

        {/* Valid From */}
        <FieldRow
          icon={<Calendar className="w-4 h-4" />}
          label="Valid From"
          value={formatTimestamp(credential.validFrom)}
          tokens={tk}
        />

        {/* Expires */}
        {credential.validUntil && (
          <FieldRow
            icon={<Clock className="w-4 h-4" />}
            label="Expires"
            value={formatTimestamp(credential.validUntil)}
            tokens={tk}
          />
        )}

        {/* Issuer DID (if different from display name) */}
        {issuer.did !== issuer.name && (
          <FieldRow
            icon={<Fingerprint className="w-4 h-4" />}
            label="Issuer DID"
            value={truncate(issuer.did, 42)}
            mono
            tokens={tk}
          />
        )}

        {/* ── Proof section (collapsible) ── */}
        {credential.proof && (
          <>
            <div className={`border-t pt-2 ${tk.sectionDivider}`}>
              <button
                type="button"
                onClick={() => setShowProof((p) => !p)}
                className={`flex items-center gap-1.5 text-xs font-semibold ${tk.subtitleText} hover:opacity-80 transition-opacity`}
                aria-expanded={showProof}
                data-testid="toggle-proof-btn"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Attestation Proof
                {showProof ? (
                  <ChevronUp className="w-3 h-3" />
                ) : (
                  <ChevronDown className="w-3 h-3" />
                )}
              </button>
            </div>

            {showProof && (
              <div
                className="space-y-2"
                data-testid="proof-panel"
              >
                <FieldRow
                  icon={<ShieldCheck className="w-4 h-4" />}
                  label="Proof Type"
                  value={credential.proof.type}
                  tokens={tk}
                />
                <FieldRow
                  icon={<Calendar className="w-4 h-4" />}
                  label="Proof Created"
                  value={formatTimestamp(credential.proof.created)}
                  tokens={tk}
                />
                <FieldRow
                  icon={<Fingerprint className="w-4 h-4" />}
                  label="Verification Method"
                  value={truncate(credential.proof.verificationMethod, 44)}
                  mono
                  tokens={tk}
                />
                <div
                  className={`px-3 py-2.5 rounded-lg border ${tk.fieldBg} ${tk.fieldBorder}`}
                >
                  <p className={`text-[10px] uppercase tracking-widest font-semibold mb-1 ${tk.mutedText}`}>
                    Proof Value
                  </p>
                  <p
                    className={`text-xs font-mono break-all ${tk.bodyText}`}
                    data-testid="proof-value-display"
                  >
                    {credential.proof.proofValue}
                  </p>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── QR Code panel ── */}
        <div className={`border-t pt-3 ${tk.sectionDivider}`}>
          <button
            type="button"
            onClick={() => setShowQr((q) => !q)}
            className={`flex items-center gap-1.5 text-xs font-semibold ${tk.subtitleText} hover:opacity-80 transition-opacity`}
            aria-expanded={showQr}
            data-testid="toggle-qr-btn"
          >
            <QrCode className="w-3.5 h-3.5" />
            Verifiable Presentation QR
            {showQr ? (
              <ChevronUp className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
          </button>
        </div>

        {showQr && (
          <div
            className="flex flex-col items-center gap-3"
            data-testid="qr-panel"
          >
            {/* SVG QR code */}
            <div
              ref={svgRef}
              className="rounded-xl overflow-hidden shadow-inner p-2"
              style={{ background: tk.qrBg }}
              data-testid="qr-svg-container"
              aria-label="QR code encoding verifiable presentation token"
              dangerouslySetInnerHTML={{ __html: qr.svg }}
            />

            <p className={`text-[10px] text-center leading-relaxed max-w-[200px] ${tk.mutedText}`}>
              {vpPayload.label}
            </p>

            {/* Nonce + expiry meta */}
            <div className="flex gap-3 text-[10px]">
              <span className={tk.mutedText}>
                Nonce:{" "}
                <span className={`font-mono ${tk.bodyText}`}>
                  {vpPayload.nonce.slice(0, 8)}…
                </span>
              </span>
              <span className={tk.mutedText}>
                Expires in{" "}
                <span className={`font-mono ${tk.bodyText}`}>
                  {vpPayload.expiresIn}s
                </span>
              </span>
            </div>

            {/* Copy VP token */}
            <button
              type="button"
              onClick={handleCopy}
              data-testid="copy-token-btn"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${tk.btnSecondary}`}
              aria-label="Copy VP token to clipboard"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Copy VP Token
                </>
              )}
            </button>
          </div>
        )}

        {/* ── Wallet export buttons ── */}
        <div className={`border-t pt-3 ${tk.sectionDivider}`}>
          <p className={`text-[10px] uppercase tracking-widest font-semibold mb-2.5 ${tk.mutedText}`}>
            Export to Wallet
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleAppleExport}
              disabled={exporting === "apple"}
              data-testid="export-apple-btn"
              className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all disabled:opacity-60 ${tk.btnSecondary}`}
              aria-label="Export to Apple Wallet"
            >
              {exporting === "apple" ? (
                <span className="animate-pulse">Exporting…</span>
              ) : (
                <>
                  <Smartphone className="w-3.5 h-3.5" />
                  Apple Wallet
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleGoogleExport}
              disabled={exporting === "google"}
              data-testid="export-google-btn"
              className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all disabled:opacity-60 ${tk.btnSecondary}`}
              aria-label="Export to Google Wallet"
            >
              {exporting === "google" ? (
                <span className="animate-pulse">Exporting…</span>
              ) : (
                <>
                  <Wallet className="w-3.5 h-3.5" />
                  Google Wallet
                </>
              )}
            </button>
          </div>
        </div>

        {/* ── Theme picker ── */}
        {!hideThemePicker && (
          <div className={`border-t pt-3 ${tk.sectionDivider}`}>
            <button
              type="button"
              onClick={() => setShowThemePicker((p) => !p)}
              className={`flex items-center gap-1.5 text-xs font-semibold ${tk.subtitleText} hover:opacity-80 transition-opacity`}
              aria-expanded={showThemePicker}
              data-testid="toggle-theme-btn"
            >
              <Palette className="w-3.5 h-3.5" />
              Card Theme
              {showThemePicker ? (
                <ChevronUp className="w-3 h-3" />
              ) : (
                <ChevronDown className="w-3 h-3" />
              )}
            </button>

            {showThemePicker && (
              <div
                className="mt-2.5 flex flex-wrap gap-2"
                role="radiogroup"
                aria-label="Card color scheme"
                data-testid="theme-picker"
              >
                {ALL_SCHEMES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={scheme === s}
                    onClick={() => setScheme(s)}
                    data-testid={`theme-option-${s}`}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                      scheme === s
                        ? `${tk.btnPrimary} border-transparent ring-2 ring-offset-1 ring-current`
                        : `${tk.btnSecondary}`
                    }`}
                  >
                    {SCHEME_LABELS[s]}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <footer
        className={`px-5 py-3 border-t flex items-center justify-between ${tk.sectionDivider} ${tk.fieldBg}`}
      >
        <span className={`text-[10px] font-mono truncate max-w-[180px] ${tk.mutedText}`}>
          {truncate(credential.id, 36)}
        </span>
        <a
          href={`https://www.w3.org/TR/vc-data-model-2.0/`}
          target="_blank"
          rel="noopener noreferrer"
          className={`flex items-center gap-1 text-[10px] flex-shrink-0 ${tk.mutedText} hover:${tk.subtitleText} transition-colors`}
          aria-label="W3C VC Data Model specification"
        >
          W3C VC <ExternalLink className="w-3 h-3" />
        </a>
      </footer>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Named exports for unit-testable logic (re-exported from this module for
// convenience so tests import a single file).
// ---------------------------------------------------------------------------
export { buildVpToken, generateQrSvg, parseVpToken } from "@/lib/did/qrEncoder";
export {
  buildAppleWalletPass,
  buildGoogleWalletPayload,
} from "@/lib/did/walletPass";
export type { CardColorScheme, CardTheme };
