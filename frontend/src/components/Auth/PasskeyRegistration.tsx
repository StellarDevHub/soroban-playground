"use client";

/**
 * PasskeyRegistration — UI component for registering a new WebAuthn passkey credential.
 *
 * Guides the user through:
 *   1. Initiating a platform authenticator (TouchID / FaceID / Windows Hello) credential.
 *   2. Displaying the returned P-256 public key to store in the Soroban
 *      account-abstraction smart account.
 *   3. Surfacing FIDO2 device information (AAGUID) for auditing.
 */

import React, { useState, useCallback } from "react";
import {
  Fingerprint,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Check,
  Loader2,
  Key,
  Info,
} from "lucide-react";
import {
  PasskeyAdapter,
  PasskeyRegistrationResult,
} from "../../lib/wallets/PasskeyAdapter";

export interface PasskeyRegistrationProps {
  /** Called with the registration result when successful. */
  onSuccess?: (result: PasskeyRegistrationResult) => void;
  /** Called when the user cancels or an error occurs. */
  onError?: (error: Error) => void;
  /** Override the RP ID (defaults to window.location.hostname). */
  rpId?: string;
  /** Override the RP display name. */
  rpName?: string;
  className?: string;
}

type RegistrationState =
  | { status: "idle" }
  | { status: "waiting" }
  | { status: "success"; result: PasskeyRegistrationResult }
  | { status: "error"; message: string };

export default function PasskeyRegistration({
  onSuccess,
  onError,
  rpId,
  rpName,
  className = "",
}: PasskeyRegistrationProps) {
  const [state, setState] = useState<RegistrationState>({ status: "idle" });
  const [displayName, setDisplayName] = useState("");
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const adapter = React.useMemo(
    () =>
      new PasskeyAdapter({
        rpId,
        rpName,
        userVerification: "required",
      }),
    [rpId, rpName],
  );

  const handleRegister = useCallback(async () => {
    if (!displayName.trim()) return;
    setState({ status: "waiting" });

    try {
      const result = await adapter.registerCredential({
        displayName: displayName.trim(),
        userVerification: "required",
      });
      setState({ status: "success", result });
      onSuccess?.(result);
    } catch (err) {
      const error =
        err instanceof Error
          ? err
          : new Error("Passkey registration failed");
      setState({ status: "error", message: error.message });
      onError?.(error);
    }
  }, [adapter, displayName, onSuccess, onError]);

  const copy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const isAvailable = adapter.isAvailable();

  return (
    <div
      className={`rounded-xl border border-slate-700 bg-slate-900/80 p-5 space-y-5 ${className}`}
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-teal-500/10 border border-teal-500/20">
          <Fingerprint size={22} className="text-teal-400" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-slate-100">
            Register Passkey Credential
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Creates a secp256r1 P-256 key pair secured by your device biometrics.
          </p>
        </div>
      </div>

      {/* Availability warning */}
      {!isAvailable && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-950/40 border border-amber-700/50 p-3 text-xs text-amber-300">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>
            WebAuthn is not available in this environment. Use a modern browser
            with platform authenticator support (Chrome, Safari, Firefox, Edge).
          </span>
        </div>
      )}

      {/* Registration form */}
      {state.status !== "success" && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1 font-medium">
              Display Name
              <span className="text-rose-400 ml-1">*</span>
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. My Soroban Account"
              disabled={state.status === "waiting" || !isAvailable}
              className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:opacity-50"
            />
          </div>

          <div className="flex items-start gap-2 rounded-lg bg-blue-950/30 border border-blue-800/40 p-3 text-xs text-blue-300">
            <Info size={13} className="shrink-0 mt-0.5" />
            <span>
              Your browser will prompt for biometric authentication (TouchID,
              FaceID, or Windows Hello). The resulting P-256 public key is
              stored on-chain in the Soroban smart account.
            </span>
          </div>

          <button
            onClick={handleRegister}
            disabled={
              !displayName.trim() ||
              state.status === "waiting" ||
              !isAvailable
            }
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:bg-slate-700 disabled:text-slate-500 text-sm font-semibold text-white transition-colors"
          >
            {state.status === "waiting" ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                <span>Waiting for biometric…</span>
              </>
            ) : (
              <>
                <Fingerprint size={15} />
                <span>Register Passkey</span>
              </>
            )}
          </button>

          {state.status === "error" && (
            <div className="flex items-start gap-2 rounded-lg bg-rose-950/40 border border-rose-700/50 p-3 text-xs text-rose-300">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              <span>{state.message}</span>
            </div>
          )}
        </div>
      )}

      {/* Success result */}
      {state.status === "success" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium text-emerald-400">
            <CheckCircle2 size={16} />
            <span>Passkey registered successfully</span>
          </div>

          {/* Credential ID */}
          <FieldRow
            label="Credential ID (base64url)"
            value={state.result.credentialId}
            field="credentialId"
            copiedField={copiedField}
            onCopy={copy}
            icon={<Key size={12} />}
          />

          {/* Public key uncompressed */}
          {state.result.publicKeyUncompressedHex && (
            <FieldRow
              label="P-256 Public Key (04 || X || Y, hex)"
              value={state.result.publicKeyUncompressedHex}
              field="pubkey"
              copiedField={copiedField}
              onCopy={copy}
              mono
              description="Store the 32-byte X component as the owner key in contracts/account-abstraction → initialize(owner, ...)"
            />
          )}

          {/* AAGUID */}
          {state.result.aaguid && state.result.aaguid !== "00000000-0000-0000-0000-000000000000" && (
            <FieldRow
              label="Authenticator AAGUID"
              value={state.result.aaguid}
              field="aaguid"
              copiedField={copiedField}
              onCopy={copy}
              description="Identifies the authenticator model (TouchID, FaceID, YubiKey, etc.)"
            />
          )}

          <button
            onClick={() => setState({ status: "idle" })}
            className="text-xs text-slate-500 hover:text-slate-300 underline"
          >
            Register another credential
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface FieldRowProps {
  label: string;
  value: string;
  field: string;
  copiedField: string | null;
  onCopy: (value: string, field: string) => void;
  mono?: boolean;
  description?: string;
  icon?: React.ReactNode;
}

function FieldRow({
  label,
  value,
  field,
  copiedField,
  onCopy,
  mono = false,
  description,
  icon,
}: FieldRowProps) {
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

      <div
        className={`text-xs break-all leading-relaxed ${
          mono ? "font-mono text-teal-300" : "text-slate-300"
        }`}
      >
        {value}
      </div>

      {description && (
        <p className="text-[11px] text-slate-500 leading-snug">{description}</p>
      )}
    </div>
  );
}
