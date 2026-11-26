import type { xdr } from "@stellar/stellar-sdk";

export type StorageDurability = "persistent" | "temporary" | "instance";

export type StorageDiffKind = "added" | "removed" | "changed" | "unchanged";

export type TtlHealthStatus = "healthy" | "expiring" | "critical" | "archived";

export interface TtlStatus {
  status: TtlHealthStatus;
  currentLedger: number;
  liveUntilLedgerSeq: number;
  ledgersRemaining: number;
  estimatedTimeRemaining: string; // e.g. "4.2h", "15m", "6.5d", "Archived"
  isExpiring: boolean; // ledgersRemaining <= 17280 (~24 hours)
  isCritical: boolean; // ledgersRemaining <= 3000 (~4.1 hours)
  canBump: boolean; // persistent entry that can be extended
}

export interface DecodedStorageValue {
  type: string; // e.g. "Struct(AllowanceKey)", "Enum(ContractState)", "i128", "symbol", "address"
  displayValue: string; // human-readable string representation
  nativeValue: unknown; // underlying native JS value (object, array, primitive)
  rawXdr: string; // base64 encoded ScVal
  typeName?: string; // struct or enum identifier if matched
  isUdt?: boolean; // true if decoded from contract ABI UDT
  structFields?: Array<{ name: string; type: string; value: unknown }>;
  enumVariant?: { name: string; value?: number; tag?: string };
}

export interface StorageBrowserEntry {
  id: string;
  contractId: string;
  durability: StorageDurability;
  keyRaw: string; // base64 XDR
  keyDecoded: DecodedStorageValue;
  valRaw: string; // base64 XDR
  valDecoded: DecodedStorageValue;
  ttl: TtlStatus | null;
  lastModifiedLedgerSeq?: number;
  diff: StorageDiffKind;
}

export interface BumpTtlParams {
  contractId: string;
  keyXdr: string;
  durability: StorageDurability;
  extendToLedgers: number;
  sourceAccount?: string;
}

export interface BumpTtlResult {
  success: boolean;
  transactionXdr?: string;
  txHash?: string;
  previousLiveUntil?: number;
  newLiveUntil?: number;
  ledgersExtended?: number;
  error?: string;
}
