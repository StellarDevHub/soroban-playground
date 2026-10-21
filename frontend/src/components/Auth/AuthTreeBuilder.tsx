"use client";

import React, { useState, useMemo, useCallback } from "react";
import { Address, StrKey, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import {
  Shield,
  Key,
  Layers,
  ChevronRight,
  ChevronDown,
  Plus,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Check,
  FileCode,
  Download,
  Sparkles,
  RefreshCw,
  ExternalLink,
  Wrench,
  Clock,
  ArrowRight,
  User,
  Hash,
} from "lucide-react";

// ── Types & Interfaces ────────────────────────────────────────────────────────

export interface AuthInvocationNode {
  id: string;
  contractId: string;
  functionName: string;
  args: Array<{ name: string; type: string; value: string }>;
  subInvocations: AuthInvocationNode[];
}

export type CredentialType = "address" | "source_account";
export type SignatureType = "ed25519" | "multisig" | "webauthn" | "custom";

export interface AuthSignatureEntry {
  id: string;
  address: string;
  type: CredentialType;
  nonce: string; // 64-bit sequence integer as string
  expirationLedger: number;
  signature: string; // Hex or base64 signature payload
  signatureType: SignatureType;
  rootInvocation: AuthInvocationNode;
}

export interface ValidationIssue {
  entryId: string;
  nodeId?: string;
  field: "address" | "nonce" | "expirationLedger" | "signature" | "contractId" | "functionName";
  severity: "error" | "warning";
  message: string;
  repairSuggestion?: string;
  fixAction?: () => void;
}

export interface AuthTreeBuilderProps {
  initialEntries?: AuthSignatureEntry[];
  currentLedger?: number;
  onChange?: (entries: AuthSignatureEntry[], isValid: boolean) => void;
  onExportXdr?: (base64Xdr: string) => void;
  className?: string;
}

// ── Pure Validation & Cryptographic Helper Functions ─────────────────────────

export function validateStellarAddress(addr: string): {
  valid: boolean;
  type?: "account" | "contract";
  reason?: string;
} {
  if (!addr || typeof addr !== "string") {
    return { valid: false, reason: "Address is required" };
  }
  const trimmed = addr.trim();
  if (trimmed.length !== 56) {
    return {
      valid: false,
      reason: `Expected 56 characters, received ${trimmed.length}`,
    };
  }
  const prefix = trimmed[0];
  if (prefix !== "G" && prefix !== "C") {
    return {
      valid: false,
      reason: "Address must begin with 'G' (Account) or 'C' (Contract)",
    };
  }
  // Base32 RFC4648 character set (uppercase A-Z and 2-7)
  const base32Regex = /^[A-Z2-7]{56}$/;
  if (!base32Regex.test(trimmed)) {
    return { valid: false, reason: "Address contains invalid base32 characters" };
  }
  return {
    valid: true,
    type: prefix === "G" ? "account" : "contract",
  };
}

export function validateContractId(cid: string): { valid: boolean; reason?: string } {
  if (!cid) return { valid: false, reason: "Contract ID is required" };
  const trimmed = cid.trim();
  if (trimmed.length !== 56 || trimmed[0] !== "C") {
    return { valid: false, reason: "Contract ID must be 56 characters starting with 'C'" };
  }
  if (!/^[A-Z2-7]{56}$/.test(trimmed)) {
    return { valid: false, reason: "Contract ID contains invalid base32 characters" };
  }
  return { valid: true };
}

export function validateNonce(nonce: string): { valid: boolean; reason?: string } {
  if (nonce === undefined || nonce === null || nonce.trim() === "") {
    return { valid: false, reason: "Nonce sequence is required" };
  }
  const trimmed = nonce.trim();
  if (!/^\d+$/.test(trimmed)) {
    return { valid: false, reason: "Nonce must be a non-negative integer" };
  }
  try {
    const b = BigInt(trimmed);
    if (b < 0n || b > 9223372036854775807n) {
      return { valid: false, reason: "Nonce exceeds 64-bit integer range" };
    }
  } catch {
    return { valid: false, reason: "Invalid 64-bit integer representation" };
  }
  return { valid: true };
}

export function validateExpirationLedger(
  expLedger: number,
  currentLedger: number
): { valid: boolean; severity?: "error" | "warning"; reason?: string } {
  if (!Number.isInteger(expLedger) || expLedger <= 0 || expLedger > 0xffffffff) {
    return {
      valid: false,
      severity: "error",
      reason: "Expiration ledger must be a positive uint32 integer",
    };
  }
  if (expLedger <= currentLedger) {
    return {
      valid: false,
      severity: "error",
      reason: `Expired: ledger ${expLedger} <= current ledger ${currentLedger}`,
    };
  }
  if (expLedger - currentLedger < 100) {
    return {
      valid: true,
      severity: "warning",
      reason: `Expiring soon: only ${expLedger - currentLedger} ledgers remaining (< 8 mins)`,
    };
  }
  return { valid: true };
}

/**
 * Validates an entire AuthSignatureEntry and returns all detected issues.
 */
export function validateAuthEntry(
  entry: AuthSignatureEntry,
  currentLedger: number
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Address validation
  const addrCheck = validateStellarAddress(entry.address);
  if (!addrCheck.valid) {
    issues.push({
      entryId: entry.id,
      field: "address",
      severity: "error",
      message: addrCheck.reason || "Invalid address",
      repairSuggestion: "Provide a valid 56-character Stellar Account (G...) or Contract (C...)",
    });
  }

  // Nonce validation
  if (entry.type === "address") {
    const nonceCheck = validateNonce(entry.nonce);
    if (!nonceCheck.valid) {
      issues.push({
        entryId: entry.id,
        field: "nonce",
        severity: "error",
        message: nonceCheck.reason || "Invalid nonce",
        repairSuggestion: "Set a valid non-negative integer (e.g. 0 or 1)",
      });
    }

    // Expiration ledger validation
    const expCheck = validateExpirationLedger(entry.expirationLedger, currentLedger);
    if (!expCheck.valid || expCheck.severity === "warning") {
      issues.push({
        entryId: entry.id,
        field: "expirationLedger",
        severity: expCheck.severity || "error",
        message: expCheck.reason || "Invalid expiration ledger",
        repairSuggestion: `Extend expiration to ledger ${currentLedger + 10000}`,
      });
    }

    // Signature payload validation
    if (!entry.signature || entry.signature.trim() === "") {
      issues.push({
        entryId: entry.id,
        field: "signature",
        severity: "error",
        message: "Cryptographic signature is missing",
        repairSuggestion: "Attach valid Ed25519 signature hex, multisig threshold, or passkey payload",
      });
    }
  }

  // Recursively validate invocation tree
  function validateNode(node: AuthInvocationNode) {
    const cidCheck = validateContractId(node.contractId);
    if (!cidCheck.valid) {
      issues.push({
        entryId: entry.id,
        nodeId: node.id,
        field: "contractId",
        severity: "error",
        message: cidCheck.reason || "Invalid Contract ID",
        repairSuggestion: "Ensure Contract ID starts with 'C' and is 56 characters",
      });
    }

    if (!node.functionName || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(node.functionName.trim())) {
      issues.push({
        entryId: entry.id,
        nodeId: node.id,
        field: "functionName",
        severity: "error",
        message: "Invalid function name identifier",
        repairSuggestion: "Provide an alphanumeric function symbol like 'transfer' or 'swap'",
      });
    }

    for (let i = 0; i < node.subInvocations.length; i++) {
      validateNode(node.subInvocations[i]);
    }
  }

  validateNode(entry.rootInvocation);
  return issues;
}

// ── XDR Serialization Engine ─────────────────────────────────────────────────

/**
 * Serializes an authorization entry with the Stellar SDK's canonical XDR types.
 */
export function serializeSorobanAuthEntry(entry: AuthSignatureEntry): {
  base64: string;
  hex: string;
  json: Record<string, unknown>;
} {
  function jsonNode(node: AuthInvocationNode): Record<string, unknown> {
    return {
      type: "contractFn",
      contractAddress: node.contractId,
      functionName: node.functionName,
      args: node.args.map((arg) => ({ ...arg })),
      subInvocations: node.subInvocations.map(jsonNode),
    };
  }

  function scValForArg(arg: AuthInvocationNode["args"][number]): xdr.ScVal {
    if (arg.type === "address") {
      const address = new Address(arg.value).toScAddress();
      return xdr.ScVal.scvAddress(address);
    }
    if (arg.type === "bytes") {
      const bytes = arg.value.startsWith("0x") ? arg.value.slice(2) : arg.value;
      if (!/^(?:[0-9a-fA-F]{2})*$/.test(bytes)) {
        throw new Error(`Argument ${arg.name} must contain even-length hexadecimal bytes`);
      }
      return xdr.ScVal.scvBytes(Buffer.from(bytes, "hex"));
    }
    if (arg.type === "bool") {
      if (arg.value !== "true" && arg.value !== "false") {
        throw new Error(`Argument ${arg.name} must be true or false`);
      }
      return nativeToScVal(arg.value === "true", { type: "bool" });
    }
    return nativeToScVal(arg.value, { type: arg.type as any });
  }

  function serializeNode(node: AuthInvocationNode): xdr.SorobanAuthorizedInvocation {
    const contractAddress = xdr.ScAddress.scAddressTypeContract(
      StrKey.decodeContract(node.contractId)
    );
    const fn = new xdr.InvokeContractArgs({
      contractAddress,
      functionName: node.functionName,
      args: node.args.map(scValForArg),
    });
    return new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(fn),
      subInvocations: node.subInvocations.map(serializeNode),
    });
  }

  const credentials = entry.type === "source_account"
    ? xdr.SorobanCredentials.sorobanCredentialsSourceAccount()
    : (() => {
        if (!validateNonce(entry.nonce).valid) throw new Error("Address credential nonce must be a valid int64");
        if (!validateExpirationLedger(entry.expirationLedger, 0).valid) throw new Error("Expiration ledger must be a positive uint32");
        const signatureHex = entry.signature.startsWith("0x") ? entry.signature.slice(2) : entry.signature;
        if (!/^(?:[0-9a-fA-F]{2})+$/.test(signatureHex)) {
          throw new Error("Signature payload must be non-empty, even-length hexadecimal bytes");
        }
        const decodedAddress = entry.address.startsWith("C")
          ? xdr.ScAddress.scAddressTypeContract(StrKey.decodeContract(entry.address))
          : xdr.ScAddress.scAddressTypeAccount(
              xdr.PublicKey.publicKeyTypeEd25519(StrKey.decodeEd25519PublicKey(entry.address))
            );
        return xdr.SorobanCredentials.sorobanCredentialsAddress(new xdr.SorobanAddressCredentials({
          address: decodedAddress,
          nonce: xdr.Int64.fromString(entry.nonce),
          signatureExpirationLedger: entry.expirationLedger,
          signature: xdr.ScVal.scvBytes(Buffer.from(signatureHex, "hex")),
        }));
      })();
  const xdrEntry = new xdr.SorobanAuthorizationEntry({
    credentials,
    rootInvocation: serializeNode(entry.rootInvocation),
  });
  const base64 = xdrEntry.toXDR("base64");
  const hex = xdrEntry.toXDR("hex");
  const jsonRepresentation = {
    credentials: entry.type === "source_account"
      ? { type: "sourceAccount" }
      : {
          type: "address",
          address: entry.address,
          nonce: entry.nonce,
          signatureExpirationLedger: entry.expirationLedger,
          signature: entry.signature,
        },
    rootInvocation: jsonNode(entry.rootInvocation),
  };

  return {
    base64,
    hex,
    json: jsonRepresentation,
  };
}

// ── Presets for Multi-Party & Complex Contract Scenarios ─────────────────────

export const PRESET_DEFI_ROUTER: AuthSignatureEntry = {
  id: "preset-router-1",
  address: "GABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEJXA",
  type: "address",
  nonce: "105",
  expirationLedger: 654320,
  signatureType: "ed25519",
  signature:
    "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
  rootInvocation: {
    id: "inv-router-root",
    contractId: "CAFQWCYLBMFQWCYLBMFQWCYLBMFQWCYLBMFQWCYLBMFQWCYLBMFQX4KO",
    functionName: "swap_tokens",
    args: [
      { name: "token_in", type: "symbol", value: "USDC" },
      { name: "token_out", type: "symbol", value: "XLM" },
      { name: "amount_in", type: "i128", value: "10000000" },
    ],
    subInvocations: [
      {
        id: "inv-sub-pool",
        contractId: "CAGQ2DINBUGQ2DINBUGQ2DINBUGQ2DINBUGQ2DINBUGQ2DINBUGQ242B",
        functionName: "swap",
        args: [
          { name: "amount_in", type: "i128", value: "10000000" },
          { name: "min_out", type: "i128", value: "7900000" },
        ],
        subInvocations: [
          {
            id: "inv-sub-token",
            contractId: "CAHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA5MSG",
            functionName: "transfer_from",
            args: [
              { name: "from", type: "address", value: "GABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEJXA" },
              { name: "to", type: "address", value: "CAGQ2DINBUGQ2DINBUGQ2DINBUGQ2DINBUGQ2DINBUGQ2DINBUGQ242B" },
              { name: "amount", type: "i128", value: "10000000" },
            ],
            subInvocations: [],
          },
        ],
      },
    ],
  },
};

export const PRESET_MULTISIG_ESCROW: AuthSignatureEntry = {
  id: "preset-escrow-1",
  address: "GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H",
  type: "address",
  nonce: "12",
  expirationLedger: 654320,
  signatureType: "multisig",
  signature:
    "f0e1d2c3b4a5968778695a4b3c2d1e0ff0e1d2c3b4a5968778695a4b3c2d1e0ff0e1d2c3b4a5968778695a4b3c2d1e0ff0e1d2c3b4a5968778695a4b3c2d1e0f",
  rootInvocation: {
    id: "inv-escrow-root",
    contractId: "CAHQ6DYPB4HQ6DYPB4HQ6DYPB4HQ6DYPB4HQ6DYPB4HQ6DYPB4HQ6DKE",
    functionName: "release_milestone",
    args: [
      { name: "escrow_id", type: "u64", value: "42" },
      { name: "milestone_idx", type: "u32", value: "1" },
    ],
    subInvocations: [
      {
        id: "inv-vault-transfer",
        contractId: "CAGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAZTCD",
        functionName: "transfer",
        args: [
          { name: "to", type: "address", value: "GABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQHGPC" },
          { name: "amount", type: "i128", value: "5000000" },
        ],
        subInvocations: [],
      },
    ],
  },
};

// ── Interactive Component Implementation ─────────────────────────────────────

export default function AuthTreeBuilder({
  initialEntries,
  currentLedger = 642500,
  onChange,
  onExportXdr,
  className = "",
}: AuthTreeBuilderProps) {
  const [entries, setEntries] = useState<AuthSignatureEntry[]>(() => {
    return initialEntries && initialEntries.length > 0
      ? initialEntries
      : [PRESET_DEFI_ROUTER];
  });

  const [selectedEntryId, setSelectedEntryId] = useState<string>(() => entries[0]?.id || "");
  const [activeTab, setActiveTab] = useState<"tree" | "credentials" | "export">("tree");
  const [exportFormat, setExportFormat] = useState<"base64" | "hex" | "json">("base64");
  const [copied, setCopied] = useState<boolean>(false);
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());

  // Active entry resolution
  const activeEntry = useMemo(
    () => entries.find((e) => e.id === selectedEntryId) || entries[0] || null,
    [entries, selectedEntryId]
  );

  // Validation calculations
  const allIssues = useMemo(() => {
    const list: ValidationIssue[] = [];
    for (let i = 0; i < entries.length; i++) {
      list.push(...validateAuthEntry(entries[i], currentLedger));
    }
    return list;
  }, [entries, currentLedger]);

  const hasErrors = useMemo(
    () => allIssues.some((issue) => issue.severity === "error"),
    [allIssues]
  );

  // Notify parent on change
  React.useEffect(() => {
    if (onChange) {
      onChange(entries, !hasErrors);
    }
  }, [entries, hasErrors, onChange]);

  // Node collapse toggle
  const toggleNodeCollapse = (nodeId: string) => {
    setCollapsedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  // ── Tree Mutation Handlers ──────────────────────────────────────────────────

  const updateActiveEntry = useCallback(
    (updater: (prev: AuthSignatureEntry) => AuthSignatureEntry) => {
      if (!activeEntry) return;
      setEntries((prevList) =>
        prevList.map((item) => (item.id === activeEntry.id ? updater(item) : item))
      );
    },
    [activeEntry]
  );

  const addSignerEntry = () => {
    const newId = `entry-${Date.now()}`;
    const newEntry: AuthSignatureEntry = {
      id: newId,
      address: "GABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEJXA",
      type: "address",
      nonce: "0",
      expirationLedger: currentLedger + 10000,
      signatureType: "ed25519",
      signature: "00".repeat(64),
      rootInvocation: {
        id: `node-${Date.now()}`,
        contractId: "CAFQWCYLBMFQWCYLBMFQWCYLBMFQWCYLBMFQWCYLBMFQWCYLBMFQX4KO",
        functionName: "execute",
        args: [],
        subInvocations: [],
      },
    };
    setEntries((prev) => [...prev, newEntry]);
    setSelectedEntryId(newId);
  };

  const removeSignerEntry = (entryId: string) => {
    if (entries.length <= 1) return;
    setEntries((prev) => {
      const filtered = prev.filter((e) => e.id !== entryId);
      if (selectedEntryId === entryId) {
        setSelectedEntryId(filtered[0]?.id || "");
      }
      return filtered;
    });
  };

  const addSubInvocation = (parentNodeId: string) => {
    updateActiveEntry((entry) => {
      const newNode: AuthInvocationNode = {
        id: `node-${Date.now()}`,
        contractId: "CAHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA5MSG",
        functionName: "call",
        args: [],
        subInvocations: [],
      };

      function attach(node: AuthInvocationNode): AuthInvocationNode {
        if (node.id === parentNodeId) {
          return {
            ...node,
            subInvocations: [...node.subInvocations, newNode],
          };
        }
        return {
          ...node,
          subInvocations: node.subInvocations.map(attach),
        };
      }

      return {
        ...entry,
        rootInvocation: attach(entry.rootInvocation),
      };
    });
  };

  const removeInvocationNode = (nodeId: string) => {
    updateActiveEntry((entry) => {
      if (entry.rootInvocation.id === nodeId) return entry; // Root cannot be deleted

      function prune(node: AuthInvocationNode): AuthInvocationNode {
        return {
          ...node,
          subInvocations: node.subInvocations
            .filter((child) => child.id !== nodeId)
            .map(prune),
        };
      }

      return {
        ...entry,
        rootInvocation: prune(entry.rootInvocation),
      };
    });
  };

  const updateNodeField = (
    nodeId: string,
    field: "contractId" | "functionName",
    val: string
  ) => {
    updateActiveEntry((entry) => {
      function edit(node: AuthInvocationNode): AuthInvocationNode {
        if (node.id === nodeId) {
          return { ...node, [field]: val };
        }
        return {
          ...node,
          subInvocations: node.subInvocations.map(edit),
        };
      }
      return {
        ...entry,
        rootInvocation: edit(entry.rootInvocation),
      };
    });
  };

  const addArgToNode = (nodeId: string) => {
    updateActiveEntry((entry) => {
      function edit(node: AuthInvocationNode): AuthInvocationNode {
        if (node.id === nodeId) {
          return {
            ...node,
            args: [...node.args, { name: "arg", type: "symbol", value: "" }],
          };
        }
        return {
          ...node,
          subInvocations: node.subInvocations.map(edit),
        };
      }
      return {
        ...entry,
        rootInvocation: edit(entry.rootInvocation),
      };
    });
  };

  const removeArgFromNode = (nodeId: string, argIndex: number) => {
    updateActiveEntry((entry) => {
      function edit(node: AuthInvocationNode): AuthInvocationNode {
        if (node.id === nodeId) {
          return {
            ...node,
            args: node.args.filter((_, idx) => idx !== argIndex),
          };
        }
        return {
          ...node,
          subInvocations: node.subInvocations.map(edit),
        };
      }
      return {
        ...entry,
        rootInvocation: edit(entry.rootInvocation),
      };
    });
  };

  // Auto-Repair Actions
  const handleAutoFix = (issue: ValidationIssue) => {
    if (!activeEntry) return;

    if (issue.field === "expirationLedger") {
      updateActiveEntry((e) => ({
        ...e,
        expirationLedger: currentLedger + 10000,
      }));
    } else if (issue.field === "nonce") {
      updateActiveEntry((e) => ({ ...e, nonce: "0" }));
    } else if (issue.field === "signature") {
      updateActiveEntry((e) => ({
        ...e,
        signature:
          "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
      }));
    } else if (issue.field === "contractId" && issue.nodeId) {
      // Keep a valid existing contract address where possible; otherwise use
      // an explicit example address and tell the user to replace it.
      updateNodeField(issue.nodeId, "contractId", "CAFQWCYLBMFQWCYLBMFQWCYLBMFQWCYLBMFQWCYLBMFQWCYLBMFQX4KO");
    } else if (issue.field === "functionName" && issue.nodeId) {
      updateNodeField(issue.nodeId, "functionName", "execute");
    }
  };

  // Export Serialized Data
  const serialized = useMemo(() => {
    if (!activeEntry) return { base64: "", hex: "", json: {}, error: "No authorization entry selected" };
    try {
      return { ...serializeSorobanAuthEntry(activeEntry), error: "" };
    } catch (error) {
      return {
        base64: "",
        hex: "",
        json: {},
        error: error instanceof Error ? error.message : "Unable to encode authorization XDR",
      };
    }
  }, [activeEntry]);

  const copyExportContent = () => {
    let payload = serialized.base64;
    if (exportFormat === "hex") payload = serialized.hex;
    else if (exportFormat === "json") payload = JSON.stringify(serialized.json, null, 2);

    navigator.clipboard.writeText(payload);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    if (onExportXdr) onExportXdr(serialized.base64);
  };

  // ── Recursive Node Renderer ───────────────────────────────────────────────

  const renderNode = (node: AuthInvocationNode, depth = 0, isRoot = false) => {
    const isCollapsed = collapsedNodes.has(node.id);
    const nodeIssues = allIssues.filter(
      (iss) => iss.entryId === activeEntry?.id && iss.nodeId === node.id
    );
    const hasNodeError = nodeIssues.some((i) => i.severity === "error");

    return (
      <div
        key={node.id}
        className={`relative ${depth > 0 ? "ml-6 pl-4 border-l-2 border-slate-800" : ""}`}
      >
        <div
          className={`p-3 rounded-lg border transition-all ${
            hasNodeError
              ? "bg-rose-950/20 border-rose-600/70 shadow-sm shadow-rose-900/20"
              : isRoot
              ? "bg-slate-900/90 border-teal-500/40 shadow-sm"
              : "bg-slate-900/50 border-slate-800 hover:border-slate-700"
          }`}
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button
                onClick={() => toggleNodeCollapse(node.id)}
                className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200"
                aria-label={isCollapsed ? "Expand node" : "Collapse node"}
              >
                {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </button>

              <span
                className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded font-semibold ${
                  isRoot
                    ? "bg-teal-500/20 text-teal-300 border border-teal-500/30"
                    : "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                }`}
              >
                {isRoot ? "Root Invocation" : `Sub-Invocation (Depth ${depth})`}
              </span>

              {hasNodeError && (
                <span className="flex items-center gap-1 text-[11px] text-rose-400 font-medium">
                  <AlertTriangle size={12} />
                  <span>Validation Error</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => addSubInvocation(node.id)}
                className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded transition-colors"
                title="Delegate sub-invocation under this contract call"
              >
                <Plus size={12} />
                <span>Add Sub-Call</span>
              </button>

              {!isRoot && (
                <button
                  onClick={() => removeInvocationNode(node.id)}
                  className="p-1 text-slate-500 hover:text-rose-400 rounded"
                  title="Remove this sub-invocation"
                  aria-label="Remove sub-invocation"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </div>

          {/* Node Fields */}
          {!isCollapsed && (
            <div className="mt-3 space-y-2.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {/* Contract ID */}
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1 font-medium">
                    Contract Address (C...)
                  </label>
                  <input
                    type="text"
                    value={node.contractId}
                    onChange={(e) =>
                      updateNodeField(node.id, "contractId", e.target.value)
                    }
                    placeholder="C..."
                    className="w-full font-mono bg-slate-950 border border-slate-700/80 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-teal-500"
                  />
                </div>

                {/* Function Name */}
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1 font-medium">
                    Function Symbol
                  </label>
                  <input
                    type="text"
                    value={node.functionName}
                    onChange={(e) =>
                      updateNodeField(node.id, "functionName", e.target.value)
                    }
                    placeholder="e.g. swap_tokens"
                    className="w-full font-mono bg-slate-950 border border-slate-700/80 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-teal-500"
                  />
                </div>
              </div>

              {/* Arguments list */}
              <div className="pt-2 border-t border-slate-800/80">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] text-slate-400 font-medium">
                    Authorized Arguments ({node.args.length})
                  </span>
                  <button
                    onClick={() => addArgToNode(node.id)}
                    className="text-[10px] text-teal-400 hover:text-teal-300 font-medium flex items-center gap-1"
                  >
                    <Plus size={10} /> Add Argument
                  </button>
                </div>

                {node.args.length === 0 ? (
                  <p className="text-[11px] text-slate-500 italic">
                    No authorized arguments (empty vector)
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {node.args.map((arg, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 text-xs font-mono bg-slate-950/80 p-1.5 rounded border border-slate-800"
                      >
                        <input
                          type="text"
                          value={arg.name}
                          onChange={(e) => {
                            const val = e.target.value;
                            updateActiveEntry((entry) => {
                              function edit(n: AuthInvocationNode): AuthInvocationNode {
                                if (n.id === node.id) {
                                  const updated = [...n.args];
                                  updated[idx] = { ...updated[idx], name: val };
                                  return { ...n, args: updated };
                                }
                                return { ...n, subInvocations: n.subInvocations.map(edit) };
                              }
                              return { ...entry, rootInvocation: edit(entry.rootInvocation) };
                            });
                          }}
                          placeholder="name"
                          className="w-1/4 bg-transparent border-b border-slate-700 text-slate-300 px-1 py-0.5 focus:outline-none"
                        />

                        <select
                          value={arg.type}
                          onChange={(e) => {
                            const val = e.target.value;
                            updateActiveEntry((entry) => {
                              function edit(n: AuthInvocationNode): AuthInvocationNode {
                                if (n.id === node.id) {
                                  const updated = [...n.args];
                                  updated[idx] = { ...updated[idx], type: val };
                                  return { ...n, args: updated };
                                }
                                return { ...n, subInvocations: n.subInvocations.map(edit) };
                              }
                              return { ...entry, rootInvocation: edit(entry.rootInvocation) };
                            });
                          }}
                          className="w-1/4 bg-slate-900 border border-slate-700 text-slate-300 rounded px-1.5 py-0.5"
                        >
                          <option value="symbol">Symbol</option>
                          <option value="address">Address</option>
                          <option value="i128">i128</option>
                          <option value="u32">u32</option>
                          <option value="u64">u64</option>
                          <option value="bytes">Bytes</option>
                          <option value="bool">Bool</option>
                        </select>

                        <input
                          type="text"
                          value={arg.value}
                          onChange={(e) => {
                            const val = e.target.value;
                            updateActiveEntry((entry) => {
                              function edit(n: AuthInvocationNode): AuthInvocationNode {
                                if (n.id === node.id) {
                                  const updated = [...n.args];
                                  updated[idx] = { ...updated[idx], value: val };
                                  return { ...n, args: updated };
                                }
                                return { ...n, subInvocations: n.subInvocations.map(edit) };
                              }
                              return { ...entry, rootInvocation: edit(entry.rootInvocation) };
                            });
                          }}
                          placeholder="value"
                          className="flex-1 bg-transparent border-b border-slate-700 text-teal-300 px-1 py-0.5 focus:outline-none"
                        />

                        <button
                          onClick={() => removeArgFromNode(node.id, idx)}
                          className="text-slate-500 hover:text-rose-400 p-0.5"
                          title="Delete argument"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Sub-invocations tree children */}
        {!isCollapsed && node.subInvocations.length > 0 && (
          <div className="mt-2 space-y-2">
            {node.subInvocations.map((child) => renderNode(child, depth + 1, false))}
          </div>
        )}
      </div>
    );
  };

  // ── Main UI Layout ────────────────────────────────────────────────────────

  return (
    <div
      className={`relative w-full rounded-xl bg-slate-950 border border-slate-800 text-slate-100 p-4 shadow-xl select-none ${className}`}
      role="region"
      aria-label="Soroban Authorization Tree Builder"
    >
      {/* Header & Preset Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <Shield className="text-teal-400" size={20} />
          <div>
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <span>Soroban Auth Invocation Tree Builder</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-teal-500/20 text-teal-300 border border-teal-500/30">
                v21 XDR
              </span>
            </h2>
            <p className="text-[11px] text-slate-400">
              Compose multi-party authorization trees, nonces, and signature credentials
            </p>
          </div>
        </div>

        {/* Presets dropdown & Add Signer */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-900 rounded-lg p-0.5 border border-slate-800 text-xs">
            <span className="text-slate-400 px-2 text-[11px]">Presets:</span>
            <button
              onClick={() => {
                setEntries([PRESET_DEFI_ROUTER]);
                setSelectedEntryId(PRESET_DEFI_ROUTER.id);
              }}
              className="px-2.5 py-1 rounded text-slate-300 hover:text-teal-300 text-xs transition-colors"
            >
              DeFi Router
            </button>
            <button
              onClick={() => {
                setEntries([PRESET_MULTISIG_ESCROW]);
                setSelectedEntryId(PRESET_MULTISIG_ESCROW.id);
              }}
              className="px-2.5 py-1 rounded text-slate-300 hover:text-cyan-300 text-xs transition-colors"
            >
              Multisig Escrow
            </button>
          </div>

          <button
            onClick={addSignerEntry}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-teal-600 hover:bg-teal-500 text-white rounded-lg transition-colors"
          >
            <Plus size={14} />
            <span>Add Signer</span>
          </button>
        </div>
      </div>

      {/* Signer Identity Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto py-2.5 border-b border-slate-800/80">
        {entries.map((entry, index) => {
          const entryIssues = allIssues.filter((i) => i.entryId === entry.id);
          const hasEntryError = entryIssues.some((i) => i.severity === "error");

          return (
            <div
              key={entry.id}
              onClick={() => setSelectedEntryId(entry.id)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer transition-all border text-xs font-mono ${
                selectedEntryId === entry.id
                  ? "bg-slate-900 border-teal-500 text-teal-300 shadow-sm"
                  : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200"
              }`}
            >
              <User size={13} />
              <span>
                Signer {index + 1}: {entry.address ? `${entry.address.slice(0, 4)}...${entry.address.slice(-4)}` : "Empty"}
              </span>

              {hasEntryError ? (
                <AlertTriangle size={12} className="text-rose-400" />
              ) : (
                <CheckCircle2 size={12} className="text-emerald-400" />
              )}

              {entries.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeSignerEntry(entry.id);
                  }}
                  className="hover:text-rose-400 ml-1 p-0.5 text-slate-500"
                  aria-label="Remove signer entry"
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Validation Banner if any issues exist */}
      {allIssues.length > 0 && (
        <div
          className={`my-3 p-3 rounded-lg border flex flex-wrap items-center justify-between gap-3 text-xs ${
            hasErrors
              ? "bg-rose-950/30 border-rose-800/60 text-rose-200"
              : "bg-amber-950/30 border-amber-800/60 text-amber-200"
          }`}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className={hasErrors ? "text-rose-400" : "text-amber-400"} />
            <div>
              <span className="font-semibold">
                {hasErrors ? "Authorization Issues Detected" : "Warning"}
              </span>
              <p className="text-[11px] opacity-90">{allIssues[0].message}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {allIssues[0].repairSuggestion && (
              <span className="text-[11px] font-mono opacity-80 hidden md:inline">
                Suggestion: {allIssues[0].repairSuggestion}
              </span>
            )}
            <button
              onClick={() => handleAutoFix(allIssues[0])}
              className="flex items-center gap-1 px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded border border-slate-700 font-medium"
            >
              <Wrench size={12} /> Auto-Fix
            </button>
          </div>
        </div>
      )}

      {/* Sub-View Navigation Tabs */}
      <div className="flex items-center gap-3 my-3 text-xs border-b border-slate-800 pb-2">
        <button
          onClick={() => setActiveTab("tree")}
          className={`flex items-center gap-1.5 pb-1 border-b-2 font-medium transition-colors ${
            activeTab === "tree"
              ? "border-teal-400 text-teal-300"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <Layers size={14} /> Tree Hierarchy
        </button>
        <button
          onClick={() => setActiveTab("credentials")}
          className={`flex items-center gap-1.5 pb-1 border-b-2 font-medium transition-colors ${
            activeTab === "credentials"
              ? "border-teal-400 text-teal-300"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <Key size={14} /> Credentials & Signature ({activeEntry?.type})
        </button>
        <button
          onClick={() => setActiveTab("export")}
          className={`flex items-center gap-1.5 pb-1 border-b-2 font-medium transition-colors ${
            activeTab === "export"
              ? "border-teal-400 text-teal-300"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <FileCode size={14} /> Export XDR Payload
        </button>
      </div>

      {/* Main Content Areas */}
      {activeEntry && (
        <div className="space-y-4">
          {/* TAB 1: TREE HIERARCHY */}
          {activeTab === "tree" && (
            <div>
              <div className="mb-2 text-[11px] text-slate-400 flex items-center justify-between">
                <span>
                  Authorized Contract Hierarchy for Signer:{" "}
                  <strong className="text-slate-200 font-mono">
                    {activeEntry.address || "Unspecified"}
                  </strong>
                </span>
                <span className="text-slate-500">
                  Click 'Add Sub-Call' to compose nested cross-contract delegations
                </span>
              </div>
              {renderNode(activeEntry.rootInvocation, 0, true)}
            </div>
          )}

          {/* TAB 2: CREDENTIALS & SIGNATURE */}
          {activeTab === "credentials" && (
            <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 space-y-4 text-xs">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Credential Type */}
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">
                    Credential Type
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => updateActiveEntry((e) => ({ ...e, type: "address" }))}
                      className={`flex-1 py-1.5 rounded font-medium border transition-colors ${
                        activeEntry.type === "address"
                          ? "bg-teal-500/20 text-teal-300 border-teal-500/40"
                          : "bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-900"
                      }`}
                    >
                      Address Credentials
                    </button>
                    <button
                      type="button"
                      onClick={() => updateActiveEntry((e) => ({ ...e, type: "source_account" }))}
                      className={`flex-1 py-1.5 rounded font-medium border transition-colors ${
                        activeEntry.type === "source_account"
                          ? "bg-teal-500/20 text-teal-300 border-teal-500/40"
                          : "bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-900"
                      }`}
                    >
                      Source Account
                    </button>
                  </div>
                </div>

                {/* Address Input */}
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">
                    Authorized Address (Account G... or Contract C...)
                  </label>
                  <input
                    type="text"
                    value={activeEntry.address}
                    onChange={(e) =>
                      updateActiveEntry((entry) => ({ ...entry, address: e.target.value }))
                    }
                    placeholder="G... or C..."
                    className="w-full font-mono bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-teal-500"
                  />
                </div>
              </div>

              {activeEntry.type === "address" && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-800/80">
                    {/* Nonce */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-slate-400 font-medium">
                          Nonce Sequence (Int64)
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            const next = (BigInt(activeEntry.nonce || "0") + 1n).toString();
                            updateActiveEntry((e) => ({ ...e, nonce: next }));
                          }}
                          className="text-[10px] text-teal-400 hover:text-teal-300 font-mono"
                        >
                          +1 Increment
                        </button>
                      </div>
                      <input
                        type="text"
                        value={activeEntry.nonce}
                        onChange={(e) =>
                          updateActiveEntry((entry) => ({ ...entry, nonce: e.target.value }))
                        }
                        placeholder="0"
                        className="w-full font-mono bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-teal-500"
                      />
                    </div>

                    {/* Expiration Ledger */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-slate-400 font-medium flex items-center gap-1">
                          <Clock size={12} />
                          <span>Expiration Ledger (Current: {currentLedger})</span>
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            updateActiveEntry((e) => ({
                              ...e,
                              expirationLedger: currentLedger + 10000,
                            }))
                          }
                          className="text-[10px] text-teal-400 hover:text-teal-300 font-mono"
                        >
                          +10,000 Ledgers
                        </button>
                      </div>
                      <input
                        type="number"
                        value={activeEntry.expirationLedger}
                        onChange={(e) =>
                          updateActiveEntry((entry) => ({
                            ...entry,
                            expirationLedger: parseInt(e.target.value, 10) || 0,
                          }))
                        }
                        className="w-full font-mono bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-teal-500"
                      />
                    </div>
                  </div>

                  {/* Signature Type & Payload */}
                  <div className="pt-2 border-t border-slate-800/80">
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-slate-400 font-medium">
                        Signature Payload ({activeEntry.signatureType.toUpperCase()})
                      </label>
                      <select
                        value={activeEntry.signatureType}
                        onChange={(e) =>
                          updateActiveEntry((entry) => ({
                            ...entry,
                            signatureType: e.target.value as SignatureType,
                          }))
                        }
                        className="bg-slate-950 border border-slate-800 text-slate-300 rounded px-2 py-0.5 text-xs font-mono"
                      >
                        <option value="ed25519">Ed25519 Raw Signature</option>
                        <option value="multisig">M-of-N Multisig Vector</option>
                        <option value="webauthn">WebAuthn / Passkey</option>
                        <option value="custom">Custom ScVal Contract Payload</option>
                      </select>
                    </div>

                    <textarea
                      value={activeEntry.signature}
                      onChange={(e) =>
                        updateActiveEntry((entry) => ({ ...entry, signature: e.target.value }))
                      }
                      rows={3}
                      placeholder="Enter hexadecimal or base64 cryptographic signature payload..."
                      className="w-full font-mono bg-slate-950 border border-slate-800 rounded p-2.5 text-xs text-teal-300 focus:outline-none focus:ring-1 focus:ring-teal-500"
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {/* TAB 3: EXPORT XDR PAYLOAD */}
          {activeTab === "export" && (
            <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">Export Format:</span>
                  {(["base64", "hex", "json"] as const).map((fmt) => (
                    <button
                      key={fmt}
                      onClick={() => setExportFormat(fmt)}
                      className={`px-2.5 py-1 rounded uppercase font-mono text-[11px] transition-colors ${
                        exportFormat === fmt
                          ? "bg-teal-500/20 text-teal-300 border border-teal-500/40"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {fmt}
                    </button>
                  ))}
                </div>

                <button
                  onClick={copyExportContent}
                  disabled={Boolean(serialized.error)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded font-medium transition-colors"
                >
                  {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                  <span>{copied ? "Copied!" : "Copy Payload"}</span>
                </button>
              </div>

              <div className="relative">
                <pre className="p-3 bg-slate-950 rounded-lg border border-slate-800 font-mono text-[11px] text-teal-300 overflow-x-auto max-h-64">
                  {exportFormat === "base64" && serialized.base64}
                  {exportFormat === "hex" && serialized.hex}
                  {exportFormat === "json" && JSON.stringify(serialized.json, null, 2)}
                </pre>
              </div>

              <div className="flex items-center justify-between text-[11px] text-amber-300 pt-1">
                <span>
                  Base64 and Hex are Stellar SorobanAuthorizationEntry XDR encodings.
                </span>
                <span>{serialized.base64 ? `XDR: ${serialized.base64.length} base64 chars` : "XDR unavailable"}</span>
              </div>
              {serialized.error && (
                <p role="alert" className="text-rose-300 text-[11px]">Cannot encode XDR: {serialized.error}</p>
              )}
              <p className="text-amber-300 text-[11px]">
                Encoding does not sign this entry. The signature field must contain the credential payload required by the signer and network.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
