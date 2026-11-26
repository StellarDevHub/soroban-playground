import {
  xdr,
  Operation,
  TransactionBuilder,
  Networks,
  Account,
  Keypair,
  Address
} from '@stellar/stellar-sdk';
import type {
  StorageDurability,
  TtlStatus,
  StorageBrowserEntry,
  BumpTtlParams,
  BumpTtlResult
} from '@/types/storageBrowser';
import {
  decodeScValWithAbi,
  parseWasmContractSpec,
  type XdrSpecEntry
} from './wasmXdrParser';

/**
 * Average block/ledger close time in seconds on Stellar.
 */
export const LEDGER_TIME_SECONDS = 5;

/**
 * Calculates detailed TTL status and countdown for a storage entry.
 */
export function calculateTtlStatus(
  liveUntilLedgerSeq: number,
  currentLedger: number,
  durability: StorageDurability
): TtlStatus {
  const ledgersRemaining = liveUntilLedgerSeq - currentLedger;

  if (ledgersRemaining <= 0) {
    return {
      status: 'archived',
      currentLedger,
      liveUntilLedgerSeq,
      ledgersRemaining,
      estimatedTimeRemaining: 'Archived',
      isExpiring: false,
      isCritical: false,
      canBump: false
    };
  }

  const isCritical = ledgersRemaining <= 3000; // ~4.1 hours
  const isExpiring = ledgersRemaining <= 17280; // ~24 hours

  let status: TtlStatus['status'] = 'healthy';
  if (isCritical) {
    status = 'critical';
  } else if (isExpiring) {
    status = 'expiring';
  }

  // Human-readable time estimation
  let estimatedTimeRemaining: string;
  if (ledgersRemaining < 720) {
    const mins = Math.max(1, Math.round((ledgersRemaining * LEDGER_TIME_SECONDS) / 60));
    estimatedTimeRemaining = `${mins}m`;
  } else if (ledgersRemaining < 17280) {
    const hours = ((ledgersRemaining * LEDGER_TIME_SECONDS) / 3600).toFixed(1);
    estimatedTimeRemaining = `${hours}h`;
  } else {
    const days = ((ledgersRemaining * LEDGER_TIME_SECONDS) / 86400).toFixed(1);
    estimatedTimeRemaining = `${days}d`;
  }

  // Persistent entries that are active can be bumped to prevent archival
  const canBump = durability === 'persistent';

  return {
    status,
    currentLedger,
    liveUntilLedgerSeq,
    ledgersRemaining,
    estimatedTimeRemaining,
    isExpiring,
    isCritical,
    canBump
  };
}

/**
 * Builds an ExtendFootprintTtl operation to bump entry TTL.
 */
export function buildBumpTtlOperation(params: BumpTtlParams): xdr.Operation {
  if (params.extendToLedgers <= 0) {
    throw new Error('extendToLedgers must be greater than 0');
  }

  return Operation.extendFootprintTtl({
    extendTo: params.extendToLedgers,
    source: params.sourceAccount
  });
}

export const DEFAULT_SOURCE_ACCOUNT =
  "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";

/**
 * Builds a ready-to-sign transaction containing the ExtendFootprintTtl operation.
 */
export function buildBumpTtlTransaction(
  params: BumpTtlParams,
  opts: {
    sourceAccount?: string;
    sequence?: string;
    fee?: string;
    networkPassphrase?: string;
  } = {}
) {
  const sourcePublicKey =
    opts.sourceAccount || params.sourceAccount || DEFAULT_SOURCE_ACCOUNT;
  const sequence = opts.sequence || '1';
  const networkPassphrase = opts.networkPassphrase || Networks.TESTNET;
  const fee = opts.fee || '100';

  const account = new Account(sourcePublicKey, sequence);
  const operation = buildBumpTtlOperation(params);

  const tx = new TransactionBuilder(account, {
    fee,
    networkPassphrase
  })
    .addOperation(operation)
    .setTimeout(60)
    .build();

  return {
    transaction: tx,
    transactionXdr: tx.toXDR()
  };
}

/**
 * Executes or simulates a Bump TTL transaction, updating the entry TTL countdown.
 */
export async function executeBumpTtl(
  params: BumpTtlParams,
  currentLedger: number,
  opts: {
    signer?: (xdr: string) => Promise<string>;
    networkPassphrase?: string;
  } = {}
): Promise<BumpTtlResult> {
  try {
    const { transactionXdr } = buildBumpTtlTransaction(params, opts);

    if (opts.signer) {
      await opts.signer(transactionXdr);
    }

    // New target expiration ledger is current ledger plus extension amount
    const newLiveUntil = currentLedger + params.extendToLedgers;
    const fakeTxHash = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;

    return {
      success: true,
      transactionXdr,
      txHash: fakeTxHash,
      previousLiveUntil: currentLedger,
      newLiveUntil,
      ledgersExtended: params.extendToLedgers
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Failed to execute Bump TTL transaction'
    };
  }
}

/**
 * Generates sample on-chain storage entries with realistic complex struct keys and enum values.
 */
export function getMockStorageEntries(
  currentLedger: number = 1000000,
  contractId: string = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
  customSpec?: XdrSpecEntry[]
): StorageBrowserEntry[] {
  const specs = customSpec || parseWasmContractSpec(new Uint8Array(0));

  // 1. Complex Struct Key + Struct Value (Expiring Persistent)
  const allowanceKeyXdr =
    'AAAAEQAAAAEAAAACAAAADwAAAARmcm9tAAAAEgAAAAAAAAAAFZ8473AVcvAsFNAflddud7/vamD9+DD9s8N33tAT7OEAAAAPAAAAB3NwZW5kZXIAAAAAEgAAAAAAAAAARpEAM8k6TU2H5MghsV+xJfolziKdjEYYJeFP8T5Tzjg=';
  const allowanceValXdr =
    'AAAAEQAAAAEAAAACAAAADwAAAAZhbW91bnQAAAAAAAoAAAAAAAAAAAAAAABZaC8AAAAADwAAABFleHBpcmF0aW9uX2xlZGdlcgAAAAAAAAMAD0l6';

  // 2. Tagged Union Key + u32 Counter (Critical Expiring Persistent)
  const counterKeyXdr = 'AAAAEAAAAAEAAAABAAAADwAAAAdDb3VudGVyAA==';
  const counterValXdr = 'AAAAAwAAAAo='; // 10

  // 3. Tagged Union Key + Enum Value (Healthy Instance)
  const stateKeyXdr = 'AAAAEAAAAAEAAAABAAAADwAAAAVTdGF0ZQAAAA==';
  const stateValXdr = 'AAAAAwAAAAE='; // Active (1)

  // 4. Complex Struct Key with nested Address + Struct Value (Healthy Persistent)
  const userProfileKeyXdr =
    'AAAAEQAAAAEAAAACAAAADwAAAApmaWVsZF9uYW1lAAAAAAAADwAAAAh1c2VyX2tleQAAAAAPAAAAB3VzZXJfaWQAAAAAEgAAAAAAAAAAFZ8473AVcvAsFNAflddud7/vamD9+DD9s8N33tAT7OE=';
  const userProfileValXdr =
    'AAAAEQAAAAEAAAACAAAADwAAAAZjb25maWcAAAAAAAAPAAAAB2VuYWJsZWQAAAAADwAAAApuYW1lc3BhY2UAAAAAAAEAAAAA';

  // 5. Archived Storage (Persistent entry that expired)
  const archivedKeyXdr = 'AAAAEAAAAAEAAAABAAAADwAAAAlPbGRDb25maWc=';
  const archivedValXdr = 'AAAAAwAAAAA=';

  // 6. Temporary Durability Storage (Expiring Temporary)
  const tempNonceKeyXdr = 'AAAAEAAAAAEAAAABAAAADwAAAAlUZW1wTm9uY2U=';
  const tempNonceValXdr = 'AAAAAwAA+08=';

  return [
    {
      id: 'entry-1',
      contractId,
      durability: 'persistent',
      keyRaw: allowanceKeyXdr,
      keyDecoded: decodeScValWithAbi(allowanceKeyXdr, specs, 'AllowanceKey'),
      valRaw: allowanceValXdr,
      valDecoded: decodeScValWithAbi(allowanceValXdr, specs, 'AllowanceData'),
      ttl: calculateTtlStatus(currentLedger + 1850, currentLedger, 'persistent'), // ~2.6h remaining
      lastModifiedLedgerSeq: currentLedger - 120,
      diff: 'changed'
    },
    {
      id: 'entry-2',
      contractId,
      durability: 'persistent',
      keyRaw: counterKeyXdr,
      keyDecoded: decodeScValWithAbi(counterKeyXdr, specs, 'DataKey'),
      valRaw: counterValXdr,
      valDecoded: decodeScValWithAbi(counterValXdr, specs),
      ttl: calculateTtlStatus(currentLedger + 820, currentLedger, 'persistent'), // ~1.1h critical!
      lastModifiedLedgerSeq: currentLedger - 35,
      diff: 'changed'
    },
    {
      id: 'entry-3',
      contractId,
      durability: 'instance',
      keyRaw: stateKeyXdr,
      keyDecoded: decodeScValWithAbi(stateKeyXdr, specs, 'DataKey'),
      valRaw: stateValXdr,
      valDecoded: decodeScValWithAbi(stateValXdr, specs, 'ContractState'),
      ttl: calculateTtlStatus(currentLedger + 95000, currentLedger, 'instance'), // ~5.5d healthy
      lastModifiedLedgerSeq: currentLedger - 500,
      diff: 'unchanged'
    },
    {
      id: 'entry-4',
      contractId,
      durability: 'persistent',
      keyRaw: userProfileKeyXdr,
      keyDecoded: decodeScValWithAbi(userProfileKeyXdr, specs),
      valRaw: userProfileValXdr,
      valDecoded: decodeScValWithAbi(userProfileValXdr, specs),
      ttl: calculateTtlStatus(currentLedger + 140000, currentLedger, 'persistent'), // ~8.1d healthy
      lastModifiedLedgerSeq: currentLedger - 2100,
      diff: 'added'
    },
    {
      id: 'entry-5',
      contractId,
      durability: 'persistent',
      keyRaw: archivedKeyXdr,
      keyDecoded: decodeScValWithAbi(archivedKeyXdr, specs, 'DataKey'),
      valRaw: archivedValXdr,
      valDecoded: decodeScValWithAbi(archivedValXdr, specs),
      ttl: calculateTtlStatus(currentLedger - 1500, currentLedger, 'persistent'), // Expired at 998,500
      lastModifiedLedgerSeq: currentLedger - 35000,
      diff: 'unchanged'
    },
    {
      id: 'entry-6',
      contractId,
      durability: 'temporary',
      keyRaw: tempNonceKeyXdr,
      keyDecoded: decodeScValWithAbi(tempNonceKeyXdr, specs),
      valRaw: tempNonceValXdr,
      valDecoded: decodeScValWithAbi(tempNonceValXdr, specs),
      ttl: calculateTtlStatus(currentLedger + 4200, currentLedger, 'temporary'), // ~5.8h temporary
      lastModifiedLedgerSeq: currentLedger - 10,
      diff: 'unchanged'
    }
  ];
}
