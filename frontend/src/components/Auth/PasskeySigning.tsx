"use client";

/**
 * PasskeySigning — UI component for signing Soroban transactions with a passkey.
 *
 * Shows:
 *   • FIDO2 flag validation status (UP / UV)
 *   • The IEEE P1363 signature and XDR payload
 *   • Integration guidance for contracts/account-abstraction
 */

import React, { useState, useCallback } from "react";
import {
  Fingerprint,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Check,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  FileCode,
} from "lucide-react";
import {
  PasskeyAdapter,
  PasskeySignaturePayload,
  assemblePasskeyXdrPayload,
} from "../../lib/wallets/PasskeyAdapter";

export interface PasskeySigningProps {
  /** Base64-encoded XDR of the transaction to sign. */
  transactionXdr: string;
  /** Override the RP ID (defaults to window.location.hostname). */
  rpId?: string;
  /** Called with the parsed signature payload on success. */
  onSuccess?: (payload: PasskeySignaturePayload, xdrHex: string) => void;
  /** Called when the user cancels or an error occurs. */
  onError?: (error: Error) => void;
  className?: string;
}

type SigningState =
  | { status: "idle" }
  | { status: "waiting" }
  | {
      status: "success";
      payload: PasskeySignaturePayload;
      xdrHex: string;
    }
  | { status: "error"; message: string };

export default function PasskeySigning({
  transactionXdr,
  rpId,
  onSuccess,
  onError,
  className = "",
}: PasskeySigningProps) {
  const [state, setState] = useState<SigningState>({ status: "idle" });
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const adapter = React.useMemo(
    () =>
      new PasskeyAdapter({
        rpId,
        userVerification: "required",
      }),
    [rpId],
  );

  const handleSign = useCallback(async () => {
    if (!transactionXdr) return;
    setState({ status: "waiting" });

    try {
      const resultJson = await adapter.signTransaction(transactionXdr);
      if (!resultJson) {
        throw new Error("No signature returned from passkey adapter");
      }
      const payload: PasskeySignaturePayload = JSON.parse(resultJson);
      const xdrHex = assemblePasskeyXdrPayload(payload);
      setState({ status: "success", payload, xdrHex });
      onSuccess?.(payload, xdrHex);
    } catch (err) {
      const error =
        err instanceof Error ? err : new Error("Passkey signing failed");
      setState({ status: "error", message: error.message });
      onError?.(error);
    }
  }, [adapter, transactionXdr, onSuccess, onError]);

  const copy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const isAvailable = adapter.isAvailable();
  const hasCredential = adapter.hasStoredCredential();

  return (
    <div
      className={`rounded-xl border border-slate-700 bg-slate-900/80 p-5 space-y-4 ${className}`}
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-violet-500/10 border border-violet-500/20">
          <Fingerprint size={22} className="text-violet-400" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-slate-100">
            Sign with Passkey
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Biometric signing — TouchID / FaceID / Windows Hello
          </p>
        </div>
      </div>

      {/* Availability / credential status */}
      {!isAvailable && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-950/40 border border-amber-700/50 p-3 text-xs text-amber-300">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>
            WebAuthn is not available in this browser. Use Chrome, Safari, Firefox,
            or Edge on a device with biometric support.
          </span>
        </div>
      )}

      {isAvailable && !hasCredential && state.status !== "success" && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-950/40 border border-amber-700/50 p-3 text-xs text-amber-300">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>
            No passkey credential registered. Use{" "}
            <strong>Register Passkey</strong> in the Auth settings first.
          </span>
        </div>
      )}

      {/* Transaction preview */}
      {transactionXdr && (
        <div className="rounded-lg bg-slate-950/50 border border-slate-800 p-3 space-y-1">
          <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wide">
            Transaction XDR
          </p>
          <p className="font-mono text-xs text-slate-400 break-all leading-relaxed line-clamp-3">
            {transactionXdr}
          </p>
        </div>
      )}

      {/* Sign button */}
      {state.status !== "success" && (
        <button
          onClick={handleSign}
          disabled={
            !transactionXdr ||
            !isAvailable ||
            !hasCredential ||
            state.status === "waiting"
          }
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:text-slate-500 text-sm font-semibold text-white transition-colors"
        >
          {state.status === "waiting" ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              <span>Waiting for biometric…</span>
            </>
          ) : (
            <>
              <Fingerprint size={15} />
              <span>Sign Transaction</span>
            </>
          )}
        </button>
      )}

      {/* Error */}
      {state.status === "error" && (
        <div className="flex items-start gap-2 rounded-lg bg-rose-950/40 border border-rose-700/50 p-3 text-xs text-rose-300">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <span>{state.message}</span>
        </div>
      )}

      {/* Success payload */}
      {state.status === "success" && (
        <div className="space-y-4">
          {/* FIDO2 flags badge */}
          <div className="flex flex-wrap gap-2">
            <FlagBadge
              label="User Presence (UP)"
              value={state.payload.flags.userPresence}
            />
            <FlagBadge
              label="User Verification (UV)"
              value={state.payload.flags.userVerification}
            />
          </div>

          <div className="flex items-center gap-2 text-sm font-medium text-emerald-400">
            <CheckCircle2 size={16} />
            <span>Transaction signed successfully</span>
          </div>

          {/* P1363 signature */}
          <SignatureField
            label="IEEE P1363 Signature (R || S, 64 bytes)"
            value={state.payload.signatureHex}
            field="sig"
            copiedField={copiedField}
            onCopy={copy}
            description="secp256r1 ECDSA — ready for Soroban __check_auth BytesN<64>"
          />

          {/* XDR payload */}
          <SignatureField
            label="Soroban XDR Bytes Payload"
            value={state.xdrHex}
            field="xdr"
            copiedField={copiedField}
            onCopy={copy}
            description="Length-prefixed sig || authenticatorData || clientDataJSON — pass to xdr.ScVal.scvBytes()"
            icon={<FileCode size={12} />}
          />

          {/* Raw fields toggle */}
          <button
            onClick={() => setShowRaw((p) => !p)}
            className="text-xs text-slate-500 hover:text-slate-300 underline"
          >
            {showRaw ? "Hide" : "Show"} raw authenticatorData / clientDataJSON
          </button>

          {showRaw && (
            <div className="space-y-3">
              <SignatureField
                label="authenticatorData (hex)"
                value={state.payload.authenticatorDataHex}
                field="authdata"
                copiedField={copiedField}
                onCopy={copy}
              />
              <SignatureField
                label="clientDataJSON (hex)"
                value={state.payload.clientDataJSONHex}
                field="cdjson"
                copiedField={copiedField}
                onCopy={copy}
              />
            </div>
          )}

          <button
            onClick={() => setState({ status: "idle" })}
            className="text-xs text-slate-500 hover:text-slate-300 underline"
          >
            Sign another transaction
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FlagBadge({
  label,
  value,
}: {
  label: string;
  value: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border ${
        value
          ? "bg-emerald-950/40 border-emerald-700/50 text-emerald-300"
          : "bg-rose-950/40 border-rose-700/50 text-rose-300"
      }`}
    >
      {value ? (
        <ShieldCheck size={11} />
      ) : (
        <ShieldAlert size={11} />
      )}
      <span>{label}</span>
    </div>
  );
}

interface SignatureFieldProps {
  label: string;
  value: string;
  field: string;
  copiedField: string | null;
  onCopy: (value: string, field: string) => void;
  description?: string;
  icon?: React.ReactNode;
}

function SignatureField({
  label,
  value,
  field,
  copiedField,
  onCopy,
  description,
  icon,
}: SignatureFieldProps) {
  return (
    <div className="rounded-lg bg-slate-950/60 border border-slate-800 p-3 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-medium uppercase tracking-wide">
          {icon}
          <span>{label}</span>
        </div>
        <button
          onClick={() => onCopy(value, field)}
          className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-teal-400 transition-colors"
          title="Copy to clipboard"
        >
          {copiedField === field ? (
            <Check size={12} className="text-emerald-400" />
          ) : (
            <Copy size={12} />
          )}
          <span>{copiedField === field ? "Copied" : "Copy"}</span>
        </button>
      </div>

      <div className="font-mono text-xs text-teal-300 break-all leading-relaxed">
        {value}
      </div>

      {description && (
        <p className="text-[11px] text-slate-500">{description}</p>
      )}
    </div>
  );
}
