export type Chain = "Stellar Soroban" | "EVM" | "Cosmos";

export type BridgeDirection =
  | "stellar-to-evm"
  | "stellar-to-cosmos"
  | "evm-to-stellar"
  | "cosmos-to-stellar";

export type BridgeMode = "lock-and-mint" | "burn-and-unlock";

export type FailureScenario =
  | "signature-expired"
  | "replay-attack"
  | "relayer-timeout";

export type BridgePhase =
  | "idle"
  | "source_locked"
  | "relayer_proof_pending"
  | "proof_generated"
  | "destination_minted"
  | "unlocked"
  | "completed"
  | "failed_signature_expired"
  | "failed_replay_detected"
  | "failed_relayer_timeout";

export type BridgeStep = Exclude<BridgePhase, "idle">;

export interface BridgeHistoryEntry {
  phase: BridgeStep;
  timestamp: number;
  message: string;
}

export interface BridgeTransactionInput {
  id: string;
  nonce: string;
  amount: string;
  asset: string;
  direction: BridgeDirection;
  mode: BridgeMode;
}

export interface BridgeTransaction extends BridgeTransactionInput {
  sourceChain: Chain;
  destinationChain: Chain;
  createdAt: number;
  timestamps: Partial<Record<BridgeStep, number>>;
  history: BridgeHistoryEntry[];
}

export interface BridgeMachineState {
  phase: BridgePhase;
  transaction: BridgeTransaction | null;
  consumedNonces: readonly string[];
  clockMs: number;
  speed: 1 | 2 | 5;
  paused: boolean;
  failureScenario: FailureScenario | null;
}

export interface ProofSibling {
  hash: string;
  position: "left" | "right";
}

export interface MerkleProof {
  leaf: string;
  root: string;
  siblings: ProofSibling[];
  index: number;
  leafCount: number;
}