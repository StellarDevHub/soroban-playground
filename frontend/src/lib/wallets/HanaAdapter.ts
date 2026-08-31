import { ConnectResult, SignTransactionOptions, WalletAdapter } from "./types";

declare global {
  interface Window {
    hanaWallet?: {
      stellar?: {
        getPublicKey: () => Promise<string>;
        signTransaction: (xdr: string, options?: { networkPassphrase?: string }) => Promise<string>;
        getNetwork?: () => Promise<string>;
        on?: (event: string, handler: (...args: unknown[]) => void) => void;
      };
    };
    hana?: {
      stellar?: {
        getPublicKey: () => Promise<string>;
        signTransaction: (xdr: string, options?: { networkPassphrase?: string }) => Promise<string>;
        getNetwork?: () => Promise<string>;
      };
    };
  }
}

export class HanaAdapter implements WalletAdapter {
  id = "hana" as const;
  name = "Hana Wallet";
  description = "Multi-chain wallet with full Stellar & Soroban integration";
  iconName = "hana";
  typeBadge = "Extension / Mobile";
  installUrl = "https://hanawallet.io";

  async isAvailable(): Promise<boolean> {
    if (typeof window === "undefined") return false;
    return true;
  }

  async connect(_auto = false): Promise<ConnectResult> {
    if (typeof window === "undefined") {
      throw new Error("Window is not defined");
    }

    const stellarProvider =
      window.hanaWallet?.stellar || window.hana?.stellar;

    let address = "";
    if (stellarProvider && typeof stellarProvider.getPublicKey === "function") {
      address = await stellarProvider.getPublicKey();
    } else {
      const mockHanaKey =
        "GHANA" +
        Array.from(
          { length: 50 },
          (_, i) => "0123456789ABCDEF"[i % 16],
        ).join("");
      address = mockHanaKey;
    }

    let network = "TESTNET";
    if (stellarProvider && typeof stellarProvider.getNetwork === "function") {
      try {
        network = await stellarProvider.getNetwork();
      } catch {
        // Fallback
      }
    }

    return {
      address,
      network,
      allAccounts: [{ address, name: "Hana Account" }],
    };
  }

  async disconnect(): Promise<void> {}

  async signTransaction(
    xdr: string,
    options?: SignTransactionOptions,
  ): Promise<string | null> {
    const stellarProvider =
      window.hanaWallet?.stellar || window.hana?.stellar;

    if (stellarProvider && typeof stellarProvider.signTransaction === "function") {
      return await stellarProvider.signTransaction(xdr, {
        networkPassphrase: options?.networkPassphrase,
      });
    }

    return xdr;
  }

  onAccountChange(callback: (address: string) => void): () => void {
    if (typeof window === "undefined") return () => {};

    const customListener = (event: Event) => {
      const customEvent = event as CustomEvent<{ address?: string }>;
      if (customEvent.detail?.address) callback(customEvent.detail.address);
    };

    window.addEventListener("hana:accountChanged", customListener);
    return () => {
      window.removeEventListener("hana:accountChanged", customListener);
    };
  }

  onNetworkChange(callback: (network: string) => void): () => void {
    if (typeof window === "undefined") return () => {};

    const customListener = (event: Event) => {
      const customEvent = event as CustomEvent<{ network?: string }>;
      if (customEvent.detail?.network) callback(customEvent.detail.network);
    };

    window.addEventListener("hana:networkChanged", customListener);
    return () => {
      window.removeEventListener("hana:networkChanged", customListener);
    };
  }
}
