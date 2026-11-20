// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * @file DidCredentialCard.tsx
 * Production-ready Decentralized Identity (DID) Credential Card Designer &
 * Verifiable Presentation QR Code Generator for Stellar Soroban.
 *
 * Implements:
 * - ISO/IEC 18004 SVG QR code generator for verifiable presentation claim tokens
 * - Customizable digital credential card UI with dark theme Tailwind
 * - Multi-format one-click export (JSON-LD, Apple Wallet pass, Google Wallet pass, SVG, PNG)
 * - Cryptographic issuer attestation and validity timestamp inspection
 * - In-browser token verification and decoding
 */

"use client";

import React, { useState, useMemo, useCallback } from "react";
import {
  ShieldCheck,
  ShieldAlert,
  QrCode,
  Download,
  Copy,
  Check,
  ExternalLink,
  Sparkles,
  Calendar,
  Building,
  Award,
  Layers,
  Palette,
  Eye,
  EyeOff,
  Cpu,
  RefreshCw,
  FileCode,
  Wallet,
  Smartphone,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

import type {
  VerifiableCredential,
  CardCustomization,
  CardThemePreset,
} from "../types/did";
import { generateQrSvg } from "../lib/did/qrCodeGenerator";
import {
  createVerifiablePresentation,
  encodePresentationClaimToken,
  verifyPresentationClaimToken,
  SAMPLE_CREDENTIALS,
  type VerificationResult,
} from "../lib/did/claimToken";
import {
  exportCredentialJsonLd,
  exportAppleWalletPassFile,
  exportGoogleWalletPassFile,
  exportQrSvgFile,
  exportQrToPngFile,
} from "../lib/did/passExporter";

export interface DidCredentialCardProps {
  credential?: VerifiableCredential;
  initialCustomization?: Partial<CardCustomization>;
  showControls?: boolean;
  onExport?: (format: string, payload: unknown) => void;
  className?: string;
}

const THEME_STYLES: Record<
  CardThemePreset,
  {
    name: string;
    cardBg: string;
    border: string;
    accent: string;
    accentBg: string;
    glow: string;
    qrColor: string;
  }
> = {
  "stellar-cyan": {
    name: "Stellar Cyan",
    cardBg: "bg-gradient-to-br from-slate-900 via-sky-950/60 to-slate-950",
    border: "border-sky-500/40 hover:border-sky-400/70",
    accent: "text-sky-400",
    accentBg: "bg-sky-500/10 border-sky-500/30 text-sky-300",
    glow: "shadow-[0_0_30px_rgba(56,189,248,0.15)]",
    qrColor: "#38bdf8",
  },
  "soroban-purple": {
    name: "Soroban Violet",
    cardBg: "bg-gradient-to-br from-slate-900 via-purple-950/60 to-slate-950",
    border: "border-purple-500/40 hover:border-purple-400/70",
    accent: "text-purple-400",
    accentBg: "bg-purple-500/10 border-purple-500/30 text-purple-300",
    glow: "shadow-[0_0_30px_rgba(192,132,252,0.15)]",
    qrColor: "#c084fc",
  },
  "aurora-emerald": {
    name: "Aurora Emerald",
    cardBg: "bg-gradient-to-br from-slate-900 via-emerald-950/60 to-slate-950",
    border: "border-emerald-500/40 hover:border-emerald-400/70",
    accent: "text-emerald-400",
    accentBg: "bg-emerald-500/10 border-emerald-500/30 text-emerald-300",
    glow: "shadow-[0_0_30px_rgba(52,211,153,0.15)]",
    qrColor: "#34d399",
  },
  "cyber-amber": {
    name: "Cyber Amber",
    cardBg: "bg-gradient-to-br from-slate-900 via-amber-950/60 to-slate-950",
    border: "border-amber-500/40 hover:border-amber-400/70",
    accent: "text-amber-400",
    accentBg: "bg-amber-500/10 border-amber-500/30 text-amber-300",
    glow: "shadow-[0_0_30px_rgba(251,191,36,0.15)]",
    qrColor: "#fbbf24",
  },
  "midnight-obsidian": {
    name: "Midnight Slate",
    cardBg: "bg-gradient-to-br from-slate-900 via-slate-800/80 to-black",
    border: "border-slate-700 hover:border-slate-500",
    accent: "text-slate-300",
    accentBg: "bg-slate-800 border-slate-700 text-slate-200",
    glow: "shadow-[0_0_30px_rgba(148,163,184,0.1)]",
    qrColor: "#94a3b8",
  },
};

export default function DidCredentialCard({
  credential = SAMPLE_CREDENTIALS[0],
  initialCustomization,
  showControls = true,
  onExport,
  className = "",
}: DidCredentialCardProps) {
  const [customization, setCustomization] = useState<CardCustomization>({
    theme: "stellar-cyan",
    showQrCode: true,
    showIssuerAttestation: true,
    showValidityTimestamps: true,
    showSubjectDid: true,
    showHologram: true,
    showChip: true,
    qrSize: 180,
    qrErrorCorrection: "M",
    ...initialCustomization,
  });

  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedDid, setCopiedDid] = useState(false);
  const [verifyModalOpen, setVerifyModalOpen] = useState(false);
  const [inputTokenToVerify, setInputTokenToVerify] = useState("");
  const [manualVerifyResult, setManualVerifyResult] = useState<VerificationResult | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  // Generate W3C Verifiable Presentation & QR Presentation Token
  const presentation = useMemo(() => {
    return createVerifiablePresentation(credential);
  }, [credential]);

  const presentationToken = useMemo(() => {
    return encodePresentationClaimToken(presentation);
  }, [presentation]);

  // Current active theme styles
  const currentTheme = THEME_STYLES[customization.theme] || THEME_STYLES["stellar-cyan"];

  // Generate SVG QR Code string
  const qrSvg = useMemo(() => {
    return generateQrSvg(presentationToken, {
      ecLevel: customization.qrErrorCorrection,
      size: customization.qrSize,
      margin: 2,
      fgColor: currentTheme.qrColor,
      bgColor: "transparent",
      title: `${credential.title} - Presentation Claim QR`,
    });
  }, [presentationToken, customization.qrErrorCorrection, customization.qrSize, currentTheme.qrColor, credential.title]);

  const handleCopyToken = useCallback(() => {
    navigator.clipboard.writeText(presentationToken);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2500);
  }, [presentationToken]);

  const handleCopyDid = useCallback(() => {
    navigator.clipboard.writeText(credential.credentialSubject.id);
    setCopiedDid(true);
    setTimeout(() => setCopiedDid(false), 2000);
  }, [credential.credentialSubject.id]);

  const showTemporaryNotice = (msg: string) => {
    setExportNotice(msg);
    setTimeout(() => setExportNotice(null), 3000);
  };

  // Export handlers
  const handleExportJsonLd = () => {
    exportCredentialJsonLd(credential);
    onExport?.("json-ld", credential);
    showTemporaryNotice("Downloaded W3C JSON-LD Credential (.jsonld)");
  };

  const handleExportAppleWallet = () => {
    exportAppleWalletPassFile(credential, presentationToken);
    onExport?.("apple-wallet", credential);
    showTemporaryNotice("Downloaded Apple Wallet Pass bundle (.json)");
  };

  const handleExportGoogleWallet = () => {
    exportGoogleWalletPassFile(credential, presentationToken);
    onExport?.("google-wallet", credential);
    showTemporaryNotice("Downloaded Google Wallet Pass JSON");
  };

  const handleExportSvg = () => {
    exportQrSvgFile(presentationToken, credential.title, {
      accentColor: currentTheme.qrColor,
      qrErrorCorrection: customization.qrErrorCorrection,
    });
    onExport?.("svg", presentationToken);
    showTemporaryNotice("Downloaded QR Code Vector (.svg)");
  };

  const handleExportPng = async () => {
    try {
      await exportQrToPngFile(presentationToken, credential.title, {
        accentColor: currentTheme.qrColor,
        qrErrorCorrection: customization.qrErrorCorrection,
      });
      onExport?.("png", presentationToken);
      showTemporaryNotice("Downloaded High-Res QR Image (.png)");
    } catch {
      showTemporaryNotice("Failed to generate PNG image.");
    }
  };

  const handleVerifyCurrent = () => {
    setInputTokenToVerify(presentationToken);
    const res = verifyPresentationClaimToken(presentationToken);
    setManualVerifyResult(res);
    setVerifyModalOpen(true);
  };

  const handleManualVerify = (tokenStr: string) => {
    setInputTokenToVerify(tokenStr);
    const res = verifyPresentationClaimToken(tokenStr);
    setManualVerifyResult(res);
  };

  return (
    <div
      data-testid="did-credential-card-container"
      className={`flex flex-col gap-6 text-slate-100 ${className}`}
    >
      {/* Toast Notification */}
      {exportNotice && (
        <div
          data-testid="export-toast"
          className="fixed top-5 right-5 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 border border-sky-500/50 text-sky-200 text-sm shadow-xl animate-fade-in"
        >
          <Sparkles className="w-4 h-4 text-sky-400" />
          <span>{exportNotice}</span>
        </div>
      )}

      {/* Main Grid: Card Preview + Customizer Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT / CENTER: Credential Card Preview */}
        <div className="lg:col-span-7 flex flex-col items-center">
          <div
            data-testid="did-credential-card"
            className={`relative w-full max-w-xl rounded-2xl p-6 sm:p-8 border transition-all duration-300 ${currentTheme.cardBg} ${currentTheme.border} ${currentTheme.glow} backdrop-blur-xl overflow-hidden`}
          >
            {/* Holographic Foil Overlay */}
            {customization.showHologram && (
              <div
                data-testid="card-hologram"
                className="absolute inset-0 pointer-events-none opacity-20 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.4),transparent_70%)]"
              />
            )}

            {/* Top Bar: Network, Chip & Status */}
            <div className="flex items-center justify-between mb-5 relative z-10">
              <div className="flex items-center gap-2.5">
                {customization.showChip && (
                  <div
                    data-testid="card-chip"
                    className="w-10 h-7 rounded border border-amber-400/50 bg-gradient-to-br from-amber-400/20 to-yellow-600/30 flex items-center justify-center shadow-inner"
                    title="Soroban Secure Enclave Chip"
                  >
                    <Cpu className="w-5 h-5 text-amber-300" />
                  </div>
                )}
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono tracking-widest uppercase text-slate-400">
                      STELLAR SOROBAN DID
                    </span>
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-sky-500/20 text-sky-300 border border-sky-500/30 uppercase">
                      {credential.issuer.network ?? "testnet"}
                    </span>
                  </div>
                  <div className="text-xs font-semibold text-slate-200 tracking-wide">
                    {credential.issuer.name}
                  </div>
                </div>
              </div>

              {/* Status Badge */}
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border bg-emerald-500/10 border-emerald-500/30 text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>{credential.status.toUpperCase()}</span>
              </div>
            </div>

            {/* Credential Title & Holder */}
            <div className="mb-5 relative z-10">
              <div className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1">
                <Award className={`w-3.5 h-3.5 ${currentTheme.accent}`} />
                <span>VERIFIABLE CREDENTIAL</span>
              </div>
              <h2
                data-testid="credential-title"
                className="text-xl sm:text-2xl font-bold tracking-tight text-white mb-2"
              >
                {credential.title}
              </h2>
              {credential.description && (
                <p className="text-xs text-slate-400 leading-relaxed max-w-md mb-3">
                  {credential.description}
                </p>
              )}

              {/* Subject Information */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {credential.credentialSubject.name && (
                  <span
                    data-testid="subject-name"
                    className="text-sm font-semibold text-slate-100"
                  >
                    {credential.credentialSubject.name}
                  </span>
                )}
                {credential.credentialSubject.role && (
                  <span
                    data-testid="subject-role"
                    className={`px-2 py-0.5 rounded text-xs font-medium border ${currentTheme.accentBg}`}
                  >
                    {credential.credentialSubject.role}
                  </span>
                )}
                {credential.credentialSubject.tier && (
                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-800 border border-slate-700 text-slate-300">
                    {credential.credentialSubject.tier}
                  </span>
                )}
                {credential.credentialSubject.reputation !== undefined && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-amber-500/10 border border-amber-500/30 text-amber-300">
                    <Sparkles className="w-3 h-3 text-amber-400" />
                    Rep: {credential.credentialSubject.reputation} / 100
                  </span>
                )}
              </div>
            </div>

            {/* Subject DID Row */}
            {customization.showSubjectDid && (
              <div
                data-testid="subject-did-container"
                className="mb-5 p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80 flex items-center justify-between gap-2 relative z-10"
              >
                <div className="overflow-hidden">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                    SUBJECT DID IDENTIFIER
                  </div>
                  <div
                    data-testid="subject-did"
                    className="font-mono text-xs text-slate-300 truncate"
                    title={credential.credentialSubject.id}
                  >
                    {credential.credentialSubject.id}
                  </div>
                </div>
                <button
                  type="button"
                  data-testid="copy-did-button"
                  onClick={handleCopyDid}
                  className="p-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors shrink-0"
                  title="Copy DID"
                  aria-label="Copy Subject DID"
                >
                  {copiedDid ? (
                    <Check className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
            )}

            {/* Middle Section: QR Code & Claims */}
            <div className="flex flex-col sm:flex-row items-center gap-5 my-4 p-4 rounded-xl bg-slate-950/40 border border-slate-800/60 relative z-10">
              {/* SVG QR Code */}
              {customization.showQrCode && (
                <div className="flex flex-col items-center shrink-0">
                  <div
                    data-testid="did-qr-code"
                    className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 shadow-md flex items-center justify-center transition-transform hover:scale-105"
                    dangerouslySetInnerHTML={{ __html: qrSvg }}
                  />
                  <span className="text-[10px] font-mono text-slate-400 mt-1.5 flex items-center gap-1">
                    <QrCode className="w-3 h-3 text-sky-400" />
                    Mobile Proof QR
                  </span>
                </div>
              )}

              {/* Claims & Subject Details */}
              <div className="flex-1 w-full space-y-2 text-xs">
                {credential.credentialSubject.organization && (
                  <div className="flex items-center justify-between pb-1.5 border-b border-slate-800/80">
                    <span className="text-slate-400 flex items-center gap-1">
                      <Building className="w-3 h-3" /> Org:
                    </span>
                    <span className="font-medium text-slate-200">
                      {credential.credentialSubject.organization}
                    </span>
                  </div>
                )}
                {credential.credentialSubject.stellarAddress && (
                  <div className="flex items-center justify-between pb-1.5 border-b border-slate-800/80">
                    <span className="text-slate-400 flex items-center gap-1">
                      <Wallet className="w-3 h-3" /> Wallet:
                    </span>
                    <span
                      className="font-mono text-slate-300 truncate max-w-[150px]"
                      title={credential.credentialSubject.stellarAddress}
                    >
                      {credential.credentialSubject.stellarAddress.slice(0, 6)}…
                      {credential.credentialSubject.stellarAddress.slice(-6)}
                    </span>
                  </div>
                )}
                {credential.credentialSubject.claims &&
                  Object.entries(credential.credentialSubject.claims).map(([k, v]) => (
                    <div
                      key={k}
                      className="flex items-center justify-between pb-1.5 border-b border-slate-800/80"
                    >
                      <span className="text-slate-400 capitalize">
                        {k.replace(/([A-Z])/g, " $1")}:
                      </span>
                      <span className="font-semibold text-slate-200">
                        {typeof v === "boolean" ? (v ? "Verified" : "No") : String(v)}
                      </span>
                    </div>
                  ))}
              </div>
            </div>

            {/* Issuer Attestation Details */}
            {customization.showIssuerAttestation && (
              <div
                data-testid="issuer-attestation-container"
                className="mt-4 pt-3 border-t border-slate-800/80 text-xs space-y-1.5 relative z-10"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    ISSUER ATTESTATION & CONTRACT PROOF
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">
                    {credential.proof.type}
                  </span>
                </div>
                <div className="font-mono text-[11px] text-slate-300 break-all bg-slate-950/80 p-2 rounded border border-slate-800/90">
                  <div className="text-[9px] text-slate-400">PROOF HASH:</div>
                  <span data-testid="attestation-hash">
                    {credential.proof.contractAttestationHash ?? credential.proof.proofValue}
                  </span>
                </div>
              </div>
            )}

            {/* Validity Timestamps */}
            {customization.showValidityTimestamps && (
              <div
                data-testid="validity-timestamps-container"
                className="mt-3 flex items-center justify-between text-[11px] text-slate-400 relative z-10 pt-2 border-t border-slate-800/60"
              >
                <div className="flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-slate-400" />
                  <span>Issued:</span>
                  <span
                    data-testid="timestamp-issued"
                    className="font-medium text-slate-300"
                  >
                    {new Date(credential.issuanceDate).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span>Expires:</span>
                  <span
                    data-testid="timestamp-expires"
                    className="font-medium text-slate-300"
                  >
                    {credential.expirationDate
                      ? new Date(credential.expirationDate).toLocaleDateString()
                      : "Permanent"}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Quick Copy Token Row */}
          <div className="w-full max-w-xl mt-4 flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-900/80 border border-slate-800 text-xs">
            <div className="flex items-center gap-2 overflow-hidden">
              <QrCode className="w-4 h-4 text-sky-400 shrink-0" />
              <span className="text-slate-400 shrink-0">Claim Token:</span>
              <span className="font-mono text-slate-300 truncate max-w-[280px]">
                {presentationToken}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                data-testid="copy-token-button"
                onClick={handleCopyToken}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/40 text-sky-300 text-xs font-medium transition-all"
              >
                {copiedToken ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Token</span>
                  </>
                )}
              </button>
              <button
                type="button"
                data-testid="verify-token-button"
                onClick={handleVerifyCurrent}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-medium transition-all"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Verify</span>
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT: Customizer & Export Panel */}
        {showControls && (
          <div className="lg:col-span-5 flex flex-col gap-5">
            {/* Customization Panel */}
            <div
              data-testid="card-customizer-panel"
              className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 backdrop-blur-md shadow-lg"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-200 mb-4 pb-2 border-b border-slate-800">
                <Palette className="w-4 h-4 text-sky-400" />
                <span>Card Style & Customization</span>
              </div>

              {/* Theme Presets */}
              <div className="mb-4">
                <label className="text-xs font-medium text-slate-400 mb-2 block">
                  Color Theme Presets
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {(Object.keys(THEME_STYLES) as CardThemePreset[]).map((themeKey) => {
                    const themeObj = THEME_STYLES[themeKey];
                    const isSelected = customization.theme === themeKey;
                    return (
                      <button
                        key={themeKey}
                        type="button"
                        data-testid={`theme-option-${themeKey}`}
                        onClick={() =>
                          setCustomization((prev) => ({ ...prev, theme: themeKey }))
                        }
                        className={`px-2.5 py-2 rounded-lg text-xs font-medium border text-left transition-all ${
                          isSelected
                            ? "bg-sky-500/20 border-sky-400 text-white shadow-sm"
                            : "bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700"
                        }`}
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          <span
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: themeObj.qrColor }}
                          />
                          <span className="truncate">{themeObj.name}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Display Element Toggles */}
              <div className="space-y-2.5 pt-2 border-t border-slate-800/80">
                <label className="text-xs font-medium text-slate-400 block mb-1">
                  Card Display Elements
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <button
                    type="button"
                    data-testid="toggle-qr-button"
                    onClick={() =>
                      setCustomization((prev) => ({
                        ...prev,
                        showQrCode: !prev.showQrCode,
                      }))
                    }
                    className={`flex items-center justify-between p-2 rounded-lg border transition-all ${
                      customization.showQrCode
                        ? "bg-slate-800 border-sky-500/50 text-slate-100"
                        : "bg-slate-950/40 border-slate-800 text-slate-400"
                    }`}
                  >
                    <span>SVG QR Code</span>
                    {customization.showQrCode ? (
                      <Eye className="w-3.5 h-3.5 text-sky-400" />
                    ) : (
                      <EyeOff className="w-3.5 h-3.5" />
                    )}
                  </button>

                  <button
                    type="button"
                    data-testid="toggle-hologram-button"
                    onClick={() =>
                      setCustomization((prev) => ({
                        ...prev,
                        showHologram: !prev.showHologram,
                      }))
                    }
                    className={`flex items-center justify-between p-2 rounded-lg border transition-all ${
                      customization.showHologram
                        ? "bg-slate-800 border-sky-500/50 text-slate-100"
                        : "bg-slate-950/40 border-slate-800 text-slate-400"
                    }`}
                  >
                    <span>Holo Overlay</span>
                    {customization.showHologram ? (
                      <Eye className="w-3.5 h-3.5 text-sky-400" />
                    ) : (
                      <EyeOff className="w-3.5 h-3.5" />
                    )}
                  </button>

                  <button
                    type="button"
                    data-testid="toggle-attestation-button"
                    onClick={() =>
                      setCustomization((prev) => ({
                        ...prev,
                        showIssuerAttestation: !prev.showIssuerAttestation,
                      }))
                    }
                    className={`flex items-center justify-between p-2 rounded-lg border transition-all ${
                      customization.showIssuerAttestation
                        ? "bg-slate-800 border-sky-500/50 text-slate-100"
                        : "bg-slate-950/40 border-slate-800 text-slate-400"
                    }`}
                  >
                    <span>Issuer Attestation</span>
                    {customization.showIssuerAttestation ? (
                      <Eye className="w-3.5 h-3.5 text-sky-400" />
                    ) : (
                      <EyeOff className="w-3.5 h-3.5" />
                    )}
                  </button>

                  <button
                    type="button"
                    data-testid="toggle-timestamps-button"
                    onClick={() =>
                      setCustomization((prev) => ({
                        ...prev,
                        showValidityTimestamps: !prev.showValidityTimestamps,
                      }))
                    }
                    className={`flex items-center justify-between p-2 rounded-lg border transition-all ${
                      customization.showValidityTimestamps
                        ? "bg-slate-800 border-sky-500/50 text-slate-100"
                        : "bg-slate-950/40 border-slate-800 text-slate-400"
                    }`}
                  >
                    <span>Validity Timestamps</span>
                    {customization.showValidityTimestamps ? (
                      <Eye className="w-3.5 h-3.5 text-sky-400" />
                    ) : (
                      <EyeOff className="w-3.5 h-3.5" />
                    )}
                  </button>

                  <button
                    type="button"
                    data-testid="toggle-chip-button"
                    onClick={() =>
                      setCustomization((prev) => ({
                        ...prev,
                        showChip: !prev.showChip,
                      }))
                    }
                    className={`flex items-center justify-between p-2 rounded-lg border transition-all ${
                      customization.showChip
                        ? "bg-slate-800 border-sky-500/50 text-slate-100"
                        : "bg-slate-950/40 border-slate-800 text-slate-400"
                    }`}
                  >
                    <span>Smart Enclave Chip</span>
                    {customization.showChip ? (
                      <Eye className="w-3.5 h-3.5 text-sky-400" />
                    ) : (
                      <EyeOff className="w-3.5 h-3.5" />
                    )}
                  </button>

                  <button
                    type="button"
                    data-testid="toggle-did-button"
                    onClick={() =>
                      setCustomization((prev) => ({
                        ...prev,
                        showSubjectDid: !prev.showSubjectDid,
                      }))
                    }
                    className={`flex items-center justify-between p-2 rounded-lg border transition-all ${
                      customization.showSubjectDid
                        ? "bg-slate-800 border-sky-500/50 text-slate-100"
                        : "bg-slate-950/40 border-slate-800 text-slate-400"
                    }`}
                  >
                    <span>Subject DID</span>
                    {customization.showSubjectDid ? (
                      <Eye className="w-3.5 h-3.5 text-sky-400" />
                    ) : (
                      <EyeOff className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {/* Error Correction Selection */}
              <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between">
                <label className="text-xs font-medium text-slate-400">
                  QR Error Correction (Reed-Solomon)
                </label>
                <div className="flex gap-1">
                  {(["L", "M", "Q", "H"] as const).map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      data-testid={`ec-level-${lvl}`}
                      onClick={() =>
                        setCustomization((prev) => ({
                          ...prev,
                          qrErrorCorrection: lvl,
                        }))
                      }
                      className={`px-2 py-0.5 rounded text-xs font-mono font-semibold transition-all ${
                        customization.qrErrorCorrection === lvl
                          ? "bg-sky-500 text-white"
                          : "bg-slate-800 text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {lvl}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* One-Click Export Actions Panel */}
            <div
              data-testid="export-panel"
              className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 backdrop-blur-md shadow-lg"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-200 mb-4 pb-2 border-b border-slate-800">
                <Download className="w-4 h-4 text-sky-400" />
                <span>One-Click Export Formats</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {/* W3C JSON-LD */}
                <button
                  type="button"
                  data-testid="export-jsonld-button"
                  onClick={handleExportJsonLd}
                  className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-950/70 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-left transition-all group"
                >
                  <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/30 flex items-center justify-center shrink-0">
                    <FileCode className="w-4 h-4 text-sky-400" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-200 group-hover:text-white">
                      W3C JSON-LD
                    </div>
                    <div className="text-[10px] text-slate-400">Standard .jsonld bundle</div>
                  </div>
                </button>

                {/* Apple Wallet Pass */}
                <button
                  type="button"
                  data-testid="export-apple-wallet-button"
                  onClick={handleExportAppleWallet}
                  className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-950/70 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-left transition-all group"
                >
                  <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center shrink-0">
                    <Smartphone className="w-4 h-4 text-indigo-400" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-200 group-hover:text-white">
                      Apple Wallet
                    </div>
                    <div className="text-[10px] text-slate-400">PassKit .json format</div>
                  </div>
                </button>

                {/* Google Wallet Pass */}
                <button
                  type="button"
                  data-testid="export-google-wallet-button"
                  onClick={handleExportGoogleWallet}
                  className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-950/70 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-left transition-all group"
                >
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center shrink-0">
                    <Wallet className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-200 group-hover:text-white">
                      Google Wallet
                    </div>
                    <div className="text-[10px] text-slate-400">Generic pass object</div>
                  </div>
                </button>

                {/* Vector SVG */}
                <button
                  type="button"
                  data-testid="export-svg-button"
                  onClick={handleExportSvg}
                  className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-950/70 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-left transition-all group"
                >
                  <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/30 flex items-center justify-center shrink-0">
                    <QrCode className="w-4 h-4 text-purple-400" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-200 group-hover:text-white">
                      Vector SVG
                    </div>
                    <div className="text-[10px] text-slate-400">Scalable vector QR</div>
                  </div>
                </button>

                {/* High-Res PNG */}
                <button
                  type="button"
                  data-testid="export-png-button"
                  onClick={handleExportPng}
                  className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-950/70 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-left transition-all group col-span-1 sm:col-span-2"
                >
                  <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0">
                    <Download className="w-4 h-4 text-amber-400" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-200 group-hover:text-white">
                      High-Resolution PNG
                    </div>
                    <div className="text-[10px] text-slate-400">1024x1024 QR image for print & digital wallet verification</div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Verification & Inspection Modal */}
      {verifyModalOpen && (
        <div
          data-testid="verify-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="verify-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in"
        >
          <div className="w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                <h3 id="verify-modal-title" className="text-base font-bold text-white">
                  Verifiable Presentation Validator
                </h3>
              </div>
              <button
                type="button"
                data-testid="close-verify-modal"
                onClick={() => setVerifyModalOpen(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                Close
              </button>
            </div>

            <div>
              <label className="text-xs font-mono text-slate-400 block mb-1">
                Presentation Claim Token (Base64url or JSON):
              </label>
              <textarea
                data-testid="verify-token-input"
                rows={3}
                value={inputTokenToVerify}
                onChange={(e) => handleManualVerify(e.target.value)}
                className="w-full p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 focus:outline-none focus:border-sky-500"
                placeholder="Paste soroban-vp:v1:... token or JSON presentation"
              />
            </div>

            {manualVerifyResult && (
              <div
                data-testid="verify-result"
                className={`p-4 rounded-xl border ${
                  manualVerifyResult.valid
                    ? "bg-emerald-950/30 border-emerald-500/40"
                    : "bg-red-950/30 border-red-500/40"
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  {manualVerifyResult.valid ? (
                    <>
                      <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                      <span className="text-sm font-semibold text-emerald-300">
                        Presentation Authenticated & Valid
                      </span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-5 h-5 text-red-400" />
                      <span className="text-sm font-semibold text-red-300">
                        Verification Failed
                      </span>
                    </>
                  )}
                </div>

                {manualVerifyResult.errors.length > 0 && (
                  <ul className="text-xs text-red-300 space-y-1 list-disc list-inside mb-3">
                    {manualVerifyResult.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                )}

                {manualVerifyResult.claimToken && (
                  <div className="grid grid-cols-2 gap-2 text-xs font-mono pt-2 border-t border-slate-800/80">
                    <div>
                      <span className="text-slate-400">Subject: </span>
                      <span className="text-slate-200 truncate block">
                        {manualVerifyResult.claimToken.subjectDid}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400">Issuer: </span>
                      <span className="text-slate-200 truncate block">
                        {manualVerifyResult.claimToken.issuerDid}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400">Valid Until: </span>
                      <span className="text-slate-200">
                        {manualVerifyResult.claimToken.validUntil}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400">Status: </span>
                      <span className="text-emerald-400">
                        {manualVerifyResult.claimToken.status}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
