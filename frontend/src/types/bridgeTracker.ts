export type BridgeStage =
  | "source_confirmed"
  | "relayer_picked_up"
  | "proof_generated"
  | "destination_minted";

export type StageStatus = "pending" | "in_progress" | "completed" | "failed";

export type BridgeNetwork =
  | "stellar-testnet"
  | "stellar-mainnet"
  | "ethereum-sepolia"
  | "ethereum-mainnet"
  | "polygon-amoy";

export interface StageDetail {
  id: BridgeStage;
  label: string;
  description: string;
  network: "source" | "relayer" | "attestation" | "destination";
}

export const BRIDGE_STAGES: StageDetail[] = [
  {
    id: "source_confirmed",
    label: "Source Transaction Confirmed",
    description: "Tokens locked in Soroban escrow vault contract on Stellar.",
    network: "source",
  },
  {
    id: "relayer_picked_up",
    label: "Relayer Picked Up",
    description: "Bridge relayer daemon detected event and queued attestation.",
    network: "relayer",
  },
  {
    id: "proof_generated",
    label: "Proof Generated / Attested",
    description: "Multi-signature threshold signature or ZK state proof produced.",
    network: "attestation",
  },
  {
    id: "destination_minted",
    label: "Destination Minted",
    description: "Wrapped ERC-20 tokens minted or released on destination network.",
    network: "destination",
  },
];

export interface BridgeSession {
  id: string;
  depositId?: number;
  token: string;
  amount: number;
  sourceNetwork: BridgeNetwork;
  destinationNetwork: BridgeNetwork;
  sourceTxHash: string;
  destTxHash?: string;
  currentStage: BridgeStage;
  stageStatuses: Record<BridgeStage, StageStatus>;
  stageTimestamps: Record<BridgeStage, number | null>;
  createdAt: number;
  updatedAt: number;
  estimatedTotalSeconds: number;
  errorMessage?: string;
}

export function getExplorerUrl(network: BridgeNetwork, txHash: string): string {
  if (!txHash) return "#";
  switch (network) {
    case "stellar-testnet":
      return `https://stellar.expert/explorer/testnet/tx/${txHash}`;
    case "stellar-mainnet":
      return `https://stellar.expert/explorer/public/tx/${txHash}`;
    case "ethereum-sepolia":
      return `https://sepolia.etherscan.io/tx/${txHash}`;
    case "ethereum-mainnet":
      return `https://etherscan.io/tx/${txHash}`;
    case "polygon-amoy":
      return `https://amoy.polygonscan.com/tx/${txHash}`;
    default:
      return `https://stellar.expert/explorer/testnet/tx/${txHash}`;
  }
}
