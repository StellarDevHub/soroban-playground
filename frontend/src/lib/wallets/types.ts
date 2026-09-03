export type WalletType =
  | "freighter"
  | "xbull"
  | "albedo"
  | "hana"
  | "walletconnect"
  | "rango"
  | "soroban-wallet";

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "error"
  | "unavailable";

export interface WalletAccount {
  address: string;
  name?: string;
  isMultisig?: boolean;
}

export interface ConnectResult {
  address: string;
  network?: string;
  allAccounts?: WalletAccount[];
}

export interface SignTransactionOptions {
  networkPassphrase?: string;
  network?: string;
  accountToSign?: string;
}

export interface WalletAdapter {
  id: WalletType;
  name: string;
  description: string;
  iconName: string;
  typeBadge: string;
  installUrl: string;

  isAvailable(): Promise<boolean> | boolean;
  connect(auto?: boolean): Promise<ConnectResult>;
  disconnect(): Promise<void> | void;
  signTransaction(
    xdr: string,
    options?: SignTransactionOptions,
  ): Promise<string | null>;
  getNetwork?(): Promise<string | null>;
  onAccountChange?(callback: (address: string) => void): () => void;
  onNetworkChange?(callback: (network: string) => void): () => void;
}
