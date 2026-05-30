"use client";

import React, { useState } from "react";
import {
  Award,
  BadgeCheck,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  ShieldOff,
  Star,
  UserPlus,
  XCircle,
} from "lucide-react";

export interface CredentialData {
  id: number;
  subject: string;
  issuer: string;
  schemaHash: number;
  dataHash: number;
  status: "Active" | "Revoked";
  issuedAt: number;
  expiresAt: number;
}

export interface IdentityData {
  owner: string;
  did: string;
  metadataHash: number;
  reputation: number;
  active: boolean;
  credentials: CredentialData[];
}

interface IdentityPortalProps {
  contractId?: string;
  walletAddress?: string;
  identities: IdentityData[];
  isLoading: boolean;
  onRegister: (did: string, metadataHash: number) => Promise<void>;
  onUpdateMetadata: (owner: string, metadataHash: number) => Promise<void>;
  onDeactivate: (owner: string) => Promise<void>;
  onIssueCredential: (params: {
    issuer: string;
    subject: string;
    schemaHash: number;
    dataHash: number;
    expiresAt: number;
  }) => Promise<void>;
  onRevokeCredential: (credentialId: number) => Promise<void>;
  onAdjustReputation: (subject: string, delta: number) => Promise<void>;
}

export default function IdentityPortal({
  contractId,
  walletAddress,
  identities,
  isLoading,
  onRegister,
  onUpdateMetadata,
  onDeactivate,
  onIssueCredential,
  onRevokeCredential,
  onAdjustReputation,
}: IdentityPortalProps) {
  const [tab, setTab] = useState<"identities" | "register" | "credential">("identities");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  // Register form
  const [regDid, setRegDid] = useState("");
  const [regHash, setRegHash] = useState("");

  // Issue credential form
  const [credIssuer, setCredIssuer] = useState("");
  const [credSubject, setCredSubject] = useState("");
  const [credSchema, setCredSchema] = useState("");
  const [credData, setCredData] = useState("");
  const [credExpiry, setCredExpiry] = useState("0");

  // Reputation delta
  const [repDeltas, setRepDeltas] = useState<Record<string, string>>({});

  const parseInteger = (raw: string, label: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      throw new Error(`${label} is required.`);
    }

    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error(`${label} must be a whole number.`);
    }

    return parsed;
  };

  const showSuccess = (message: string) => {
    setFeedback({ kind: "success", message });
  };

  const showError = (error: unknown) => {
    setFeedback({
      kind: "error",
      message: error instanceof Error ? error.message : "Something unexpected happened.",
    });
  };

  const handleRegister = async () => {
    const did = regDid.trim();
    if (!did) {
      showError(new Error("DID String is required."));
      return;
    }

    try {
      const metadataHash = parseInteger(regHash, "Metadata Hash");
      await onRegister(did, metadataHash);
      setRegDid("");
      setRegHash("");
      showSuccess("Identity registered successfully.");
    } catch (error) {
      showError(error);
    }
  };

  const handleIssueCredential = async () => {
    const issuer = credIssuer.trim();
    const subject = credSubject.trim();
    if (!issuer || !subject) {
      showError(new Error("Issuer and subject addresses are required."));
      return;
    }

    try {
      await onIssueCredential({
        issuer,
        subject,
        schemaHash: parseInteger(credSchema, "Schema Hash"),
        dataHash: parseInteger(credData, "Data Hash"),
        expiresAt: parseInteger(credExpiry, "Expires At"),
      });
      setCredIssuer("");
      setCredSubject("");
      setCredSchema("");
      setCredData("");
      setCredExpiry("0");
      showSuccess("Credential issued successfully.");
    } catch (error) {
      showError(error);
    }
  };

  if (!contractId) {
    return (
      <div className="flex flex-col space-y-3 p-5 bg-gray-900 border border-gray-800 rounded-xl shadow-lg">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-widest flex items-center gap-2">
          <ShieldCheck size={16} className="text-emerald-400" />
          Identity Portal
        </h3>
        <p className="text-xs text-gray-500 italic">
          Deploy the DID registry contract to manage identities.
        </p>
      </div>
    );
  }

  const handleRevokeCredential = async (credentialId: number) => {
    try {
      await onRevokeCredential(credentialId);
      showSuccess(`Credential #${credentialId} revoked.`);
    } catch (error) {
      showError(error);
    }
  };

  const handleAdjustReputation = async (owner: string) => {
    const raw = repDeltas[owner] ?? "";
    const parsed = Number(raw.trim());

    if (!Number.isInteger(parsed) || parsed === 0) {
      showError(new Error("Reputation delta must be a non-zero whole number."));
      return;
    }

    try {
      await onAdjustReputation(owner, parsed);
      setRepDeltas((current) => ({ ...current, [owner]: "" }));
      showSuccess("Reputation updated.");
    } catch (error) {
      showError(error);
    }
  };

  const handleDeactivateIdentity = async (owner: string) => {
    try {
      await onDeactivate(owner);
      showSuccess("Identity deactivated.");
    } catch (error) {
      showError(error);
    }
  };

  return (
    <div className="flex flex-col space-y-4 p-5 bg-gray-900 border border-gray-800 rounded-xl shadow-lg">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-widest flex items-center gap-2">
          <ShieldCheck size={16} className="text-emerald-400" />
          Identity Portal
        </h3>
        {walletAddress && (
          <span className="text-xs text-gray-500 font-mono">
            {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}
          </span>
        )}
      </div>

      {feedback && (
        <p
          role={feedback.kind === "error" ? "alert" : "status"}
          aria-live="polite"
          className={`rounded-lg border px-3 py-2 text-xs ${
            feedback.kind === "error"
              ? "border-rose-800/60 bg-rose-950/40 text-rose-200"
              : "border-emerald-800/60 bg-emerald-950/40 text-emerald-200"
          }`}
        >
          {feedback.message}
        </p>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-800 pb-2">
        {(["identities", "register", "credential"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
              tab === t
                ? "bg-emerald-600/20 text-emerald-300 border border-emerald-500/30"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {t === "identities"
              ? `DIDs (${identities.length})`
              : t === "register"
              ? "Register"
              : "Issue Credential"}
          </button>
        ))}
      </div>

      {/* Identities tab */}
      {tab === "identities" && (
        <div className="space-y-3">
          {identities.length === 0 ? (
            <p className="text-xs text-gray-500 italic text-center py-4">
              No identities registered yet.
            </p>
          ) : (
            identities.map((identity) => (
              <div
                key={identity.owner}
                className="border border-gray-800 rounded-lg overflow-hidden"
              >
                <button
                  onClick={() =>
                    setExpanded(expanded === identity.owner ? null : identity.owner)
                  }
                  className="w-full flex items-start justify-between p-3 text-left hover:bg-gray-800/50 transition-colors"
                >
                  <div className="flex-1 min-w-0 pr-2">
                    <div className="flex items-center gap-2">
                      {identity.active ? (
                        <ShieldCheck size={12} className="text-emerald-400 shrink-0" />
                      ) : (
                        <ShieldOff size={12} className="text-rose-400 shrink-0" />
                      )}
                      <span className="text-xs font-mono text-gray-200 truncate">
                        {identity.did}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="flex items-center gap-1 text-[10px] text-amber-300">
                        <Star size={10} />
                        {identity.reputation}
                      </span>
                      <span className="text-[10px] text-gray-500">
                        {identity.credentials.length} credential
                        {identity.credentials.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>
                  {expanded === identity.owner ? (
                    <ChevronUp size={14} className="text-gray-500 shrink-0 mt-1" />
                  ) : (
                    <ChevronDown size={14} className="text-gray-500 shrink-0 mt-1" />
                  )}
                </button>

                {expanded === identity.owner && (
                  <div className="border-t border-gray-800 p-3 space-y-3 bg-gray-950/50">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <InfoRow
                        label="Owner"
                        value={`${identity.owner.slice(0, 8)}…${identity.owner.slice(-4)}`}
                      />
                      <InfoRow label="Metadata Hash" value={String(identity.metadataHash)} />
                      <InfoRow
                        label="Status"
                        value={identity.active ? "Active" : "Deactivated"}
                      />
                      <InfoRow label="Reputation" value={String(identity.reputation)} />
                    </div>

                    {/* Credentials list */}
                    {identity.credentials.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] text-gray-500 uppercase tracking-wider">
                          Credentials
                        </p>
                        {identity.credentials.map((cred) => (
                          <div
                            key={cred.id}
                            className="flex items-center justify-between p-2 rounded bg-gray-900 border border-gray-800"
                          >
                            <div className="flex items-center gap-2">
                              {cred.status === "Active" ? (
                                <BadgeCheck size={12} className="text-emerald-400" />
                              ) : (
                                <XCircle size={12} className="text-rose-400" />
                              )}
                              <span className="text-xs text-gray-300">
                                #{cred.id} · schema:{cred.schemaHash}
                              </span>
                            </div>
                            {cred.status === "Active" && (
                              <button
                                onClick={() => void handleRevokeCredential(cred.id)}
                                disabled={isLoading}
                                className="text-[10px] px-2 py-0.5 bg-rose-900/30 hover:bg-rose-900/50 border border-rose-800/50 text-rose-400 rounded transition-colors"
                              >
                                Revoke
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Reputation adjustment */}
                    {identity.active && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] text-gray-500 uppercase tracking-wider">
                          Adjust Reputation
                        </p>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            value={repDeltas[identity.owner] ?? ""}
                            onChange={(e) =>
                              setRepDeltas((p) => ({
                                ...p,
                                [identity.owner]: e.target.value,
                              }))
                            }
                            aria-label={`Reputation delta for ${identity.did}`}
                            placeholder="±delta"
                            className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-emerald-500"
                          />
                          <button
                            onClick={() => void handleAdjustReputation(identity.owner)}
                            disabled={isLoading}
                            className="px-3 py-1.5 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/30 text-amber-300 text-xs rounded transition-colors flex items-center gap-1"
                          >
                            <Award size={12} />
                            Apply
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Deactivate */}
                    {identity.active && (
                      <button
                        onClick={() => void handleDeactivateIdentity(identity.owner)}
                        disabled={isLoading}
                        className="w-full py-1.5 bg-rose-900/20 hover:bg-rose-900/40 border border-rose-800/40 text-rose-400 text-xs rounded transition-colors flex items-center justify-center gap-1"
                      >
                        <ShieldOff size={12} />
                        Deactivate Identity
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Register tab */}
      {tab === "register" && (
        <div className="space-y-3">
          <Field label="DID String" htmlFor="identity-register-did">
            <input
              id="identity-register-did"
              value={regDid}
              onChange={(e) => setRegDid(e.target.value)}
              placeholder={`did:soroban:${walletAddress ?? "G..."}`}
              className={inputCls}
            />
          </Field>
          <Field label="Metadata Hash (u64)" htmlFor="identity-register-metadata-hash">
            <input
              id="identity-register-metadata-hash"
              type="number"
              value={regHash}
              onChange={(e) => setRegHash(e.target.value)}
              placeholder="0"
              className={inputCls}
            />
          </Field>
          <button
            onClick={handleRegister}
            disabled={isLoading || !regDid}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-800 disabled:text-gray-600 text-white transition-colors"
          >
            {isLoading ? (
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-b-transparent border-white" />
            ) : (
              <UserPlus size={16} />
            )}
            Register Identity
          </button>
        </div>
      )}

      {/* Issue credential tab */}
      {tab === "credential" && (
        <div className="space-y-3">
          <Field label="Issuer Address" htmlFor="identity-issuer-address">
            <input
              id="identity-issuer-address"
              value={credIssuer}
              onChange={(e) => setCredIssuer(e.target.value)}
              placeholder="G..."
              className={inputCls}
            />
          </Field>
          <Field label="Subject Address" htmlFor="identity-subject-address">
            <input
              id="identity-subject-address"
              value={credSubject}
              onChange={(e) => setCredSubject(e.target.value)}
              placeholder="G..."
              className={inputCls}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Schema Hash" htmlFor="identity-schema-hash">
              <input
                id="identity-schema-hash"
                type="number"
                value={credSchema}
                onChange={(e) => setCredSchema(e.target.value)}
                placeholder="0"
                className={inputCls}
              />
            </Field>
            <Field label="Data Hash" htmlFor="identity-data-hash">
              <input
                id="identity-data-hash"
                type="number"
                value={credData}
                onChange={(e) => setCredData(e.target.value)}
                placeholder="0"
                className={inputCls}
              />
            </Field>
          </div>
          <Field label="Expires At (unix ts, 0 = never)" htmlFor="identity-expires-at">
            <input
              id="identity-expires-at"
              type="number"
              value={credExpiry}
              onChange={(e) => setCredExpiry(e.target.value)}
              className={inputCls}
            />
          </Field>
          <button
            onClick={handleIssueCredential}
            disabled={isLoading || !credIssuer || !credSubject}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-800 disabled:text-gray-600 text-white transition-colors"
          >
            {isLoading ? (
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-b-transparent border-white" />
            ) : (
              <BadgeCheck size={16} />
            )}
            Issue Credential
          </button>
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const inputCls =
  "w-full bg-gray-950 border border-gray-800 rounded-md py-1.5 px-2 text-xs text-gray-200 focus:outline-none focus:border-emerald-500 font-mono";

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</p>
      <p className="text-xs text-gray-300 font-mono truncate">{value}</p>
    </div>
  );
}
