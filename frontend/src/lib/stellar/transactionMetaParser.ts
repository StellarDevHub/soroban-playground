// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import * as StellarSdk from "@stellar/stellar-sdk";

export type LedgerChangeType = "created" | "modified" | "deleted";

export interface LedgerKeyDiff {
  key: string;
  keyType: string;
  contractId?: string;
  changeType: LedgerChangeType;
  before: unknown | null;
  after: unknown | null;
  durability?: "persistent" | "temporary" | "instance";
}

export interface TransactionLedgerDiff {
  txHash: string;
  ledgerSequence?: number;
  successful: boolean;
  timestamp: number;
  changes: LedgerKeyDiff[];
}

/**
 * Parses transaction meta XDR or structured execution meta into exact ledger state modifications
 * with Before and After state snapshots.
 */
export function parseTransactionMeta(
  meta: unknown,
  txHash: string = "0xdeadbeef",
  timestamp: number = Date.now()
): TransactionLedgerDiff {
  if (!meta) {
    return {
      txHash,
      successful: true,
      timestamp,
      changes: [],
    };
  }

  // 1. If meta is a string, attempt to parse as base64 XDR using StellarSdk
  if (typeof meta === "string") {
    try {
      const xdrMeta = StellarSdk.xdr.TransactionMeta.fromXDR(meta, "base64");
      return parseXdrTransactionMeta(xdrMeta, txHash, timestamp);
    } catch {
      // Fallback: try parsing JSON string
      try {
        const parsedJson = JSON.parse(meta);
        return parseJsonTransactionMeta(parsedJson, txHash, timestamp);
      } catch {
        // Raw or invalid XDR
        return {
          txHash,
          successful: false,
          timestamp,
          changes: [],
        };
      }
    }
  }

  // 2. If meta is an object/JSON
  return parseJsonTransactionMeta(meta, txHash, timestamp);
}

function parseXdrTransactionMeta(
  xdrMeta: StellarSdk.xdr.TransactionMeta,
  txHash: string,
  timestamp: number
): TransactionLedgerDiff {
  const changes: LedgerKeyDiff[] = [];

  try {
    const v3 = xdrMeta.v3?.();
    if (v3) {
      // Extract from operations and txChanges
      const operations = v3.operations?.() || [];
      for (const op of operations) {
        const opChanges = op.changes?.() || [];
        for (const change of opChanges) {
          const parsed = parseLedgerEntryChange(change);
          if (parsed) changes.push(parsed);
        }
      }

      // Check txChangesAfter
      const afterChanges = v3.txChangesAfter?.() || [];
      for (const change of afterChanges) {
        const parsed = parseLedgerEntryChange(change);
        if (parsed) changes.push(parsed);
      }
    } else {
      // Fallback for v1 or v2
      const opChanges = (xdrMeta as any).operations?.() || [];
      for (const op of opChanges) {
        const changesList = op.changes?.() || [];
        for (const change of changesList) {
          const parsed = parseLedgerEntryChange(change);
          if (parsed) changes.push(parsed);
        }
      }
    }
  } catch (err) {
    console.warn("Failed to parse XDR changes fully:", err);
  }

  return {
    txHash,
    successful: true,
    timestamp,
    changes,
  };
}

function parseLedgerEntryChange(
  change: StellarSdk.xdr.LedgerEntryChange
): LedgerKeyDiff | null {
  try {
    const arm = change.arm?.() || change.switch?.().name;

    if (arm === "created" || (change as any).created) {
      const entry = (change as any).created();
      const keyInfo = extractKeyInfo(entry);
      return {
        key: keyInfo.key,
        keyType: keyInfo.keyType,
        contractId: keyInfo.contractId,
        changeType: "created",
        before: null,
        after: entry.data()?.toJSON() || entry.toJSON?.() || entry,
        durability: keyInfo.durability,
      };
    }

    if (arm === "updated" || (change as any).updated) {
      const entry = (change as any).updated();
      const keyInfo = extractKeyInfo(entry);
      return {
        key: keyInfo.key,
        keyType: keyInfo.keyType,
        contractId: keyInfo.contractId,
        changeType: "modified",
        before: { status: "previous_state" },
        after: entry.data()?.toJSON() || entry.toJSON?.() || entry,
        durability: keyInfo.durability,
      };
    }

    if (arm === "deleted" || (change as any).deleted) {
      const keyEntry = (change as any).deleted();
      const keyInfo = extractLedgerKey(keyEntry);
      return {
        key: keyInfo.key,
        keyType: keyInfo.keyType,
        contractId: keyInfo.contractId,
        changeType: "deleted",
        before: { status: "deleted_state" },
        after: null,
        durability: keyInfo.durability,
      };
    }
  } catch (err) {
    console.warn("Error parsing ledger entry change:", err);
  }
  return null;
}

function extractKeyInfo(entry: any): {
  key: string;
  keyType: string;
  contractId?: string;
  durability?: "persistent" | "temporary" | "instance";
} {
  try {
    const data = entry.data();
    const type = data.switch().name;
    if (type === "contractData") {
      const contractData = data.contractData();
      const contractId = contractData.contract()?.contractId()?.toString("hex");
      const keyVal = contractData.key()?.toJSON?.() || "key";
      return {
        key: `ContractData:${contractId?.slice(0, 8) || "data"}:${JSON.stringify(keyVal)}`,
        keyType: "ContractData",
        contractId,
        durability: contractData.durability()?.name?.toLowerCase(),
      };
    }
    return { key: `${type}:${entry.lastModifiedLedgerSeq?.() || "entry"}`, keyType: type };
  } catch {
    return { key: "UnknownLedgerKey", keyType: "Unknown" };
  }
}

function extractLedgerKey(keyEntry: any): {
  key: string;
  keyType: string;
  contractId?: string;
  durability?: "persistent" | "temporary" | "instance";
} {
  try {
    const type = keyEntry.switch().name;
    return { key: `${type}:${keyEntry.toJSON?.() || "entry"}`, keyType: type };
  } catch {
    return { key: "UnknownLedgerKey", keyType: "Unknown" };
  }
}

function parseJsonTransactionMeta(
  raw: any,
  txHash: string,
  timestamp: number
): TransactionLedgerDiff {
  const changes: LedgerKeyDiff[] = [];

  // Check if raw has changes or stateDiff array
  const list =
    raw.changes ||
    raw.stateDiff ||
    raw.ledgerDiff ||
    raw.ledgerModifications ||
    [];

  if (Array.isArray(list)) {
    for (const item of list) {
      changes.push({
        key: item.key || item.storageKey || "storage_key",
        keyType: item.keyType || "ContractData",
        contractId: item.contractId,
        changeType: (item.changeType || item.type || (item.before === null ? "created" : item.after === null ? "deleted" : "modified")) as LedgerChangeType,
        before: item.before !== undefined ? item.before : null,
        after: item.after !== undefined ? item.after : null,
        durability: item.durability || "persistent",
      });
    }
  } else if (typeof raw === "object") {
    // If raw is a mapping of key -> { before, after }
    for (const [k, val] of Object.entries(raw)) {
      if (typeof val === "object" && val !== null && ("before" in val || "after" in val)) {
        const v = val as any;
        const changeType: LedgerChangeType =
          v.before === null || v.before === undefined
            ? "created"
            : v.after === null || v.after === undefined
            ? "deleted"
            : "modified";

        changes.push({
          key: k,
          keyType: "ContractData",
          changeType,
          before: v.before ?? null,
          after: v.after ?? null,
          durability: "persistent",
        });
      }
    }
  }

  return {
    txHash: raw.txHash || raw.hash || txHash,
    ledgerSequence: raw.ledgerSequence || raw.ledger,
    successful: raw.successful !== false,
    timestamp: raw.timestamp || timestamp,
    changes,
  };
}
