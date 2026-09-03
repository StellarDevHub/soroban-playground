import { ConnectResult, SignTransactionOptions, WalletAdapter } from "./types";

declare global {
  interface Window {
    xBullSDK?: {
      getPublicKey: () => Promise<string>;
      signXDR: (xdr: string, options?: { network?: string; networkPassphrase?: string }) => Promise<string>;
      getNetwork?: () => Promise<string>;
      on?: (event: string, callback: (...args: unknown[]) => void) => void;
      off?: (event: string, callback: (...args: unknown[]) => void) => void;
    };
    xBull?: {
      getPublicKey?: () => Promise<string>;
      sign?: (options: { xdr: string; network?: string; networkPassphrase?: string }) => Promise<string>;
      getNetwork?: () => Promise<string>;
      listen?: (event: string, callback: (data: unknown) => void) => () => void;
    };
  }
}

export class XBullAdapter implements WalletAdapter {
  id = "xbull" as const;
  name = "xBull Wallet";
  description = "Cross-platform Stellar & Soroban power wallet";
  iconName = "xbull";
  typeBadge = "Extension / Mobile";
  installUrl = "https://xbull.app";

  async isAvailable(): Promise<boolean> {
    if (typeof window === "undefined") return false;
    return true;
  }

  async connect(_auto = false): Promise<ConnectResult> {
    if (typeof window === "undefined") {
      throw new Error("Window is not defined");
    }

    let address = "";
    if (window.xBullSDK && typeof window.xBullSDK.getPublicKey === "function") {
      address = await window.xBullSDK.getPublicKey();
    } else if (window.xBull && typeof window.xBull.getPublicKey === "function") {
      address = await window.xBull.getPublicKey();
    } else {
      // Fallback for demo/web connect bridge
      const mockXbullKey =
        "GXBULL" +
        Array.from(
          { length: 50 },
          (_, i) => "0123456789ABCDEF"[i % 16],
        ).join("");
      address = mockXbullKey;
    }

    if (!address) {
      throw new Error("Failed to get public key from xBull");
    }

    let network = "TESTNET";
    try {
      if (window.xBullSDK?.getNetwork) {
        network = await window.xBullSDK.getNetwork();
      } else if (window.xBull?.getNetwork) {
        network = await window.xBull.getNetwork();
      }
    } catch {
      // Default to TESTNET
    }

    return {
      address,
      network,
      allAccounts: [{ address, name: "xBull Primary Account" }],
    };
  }

  async disconnect(): Promise<void> {
    // xBull session reset
  }

  async signTransaction(
    xdr: string,
    options?: SignTransactionOptions,
  ): Promise<string | null> {
    if (window.xBullSDK && typeof window.xBullSDK.signXDR === "function") {
      return await window.xBullSDK.signXDR(xdr, {
        network: options?.network,
        networkPassphrase: options?.networkPassphrase,
      });
    }

    if (window.xBull && typeof window.xBull.sign === "function") {
      return await window.xBull.sign({
        xdr,
        network: options?.network,
        networkPassphrase: options?.networkPassphrase,
      });
    }

    return xdr;
  }

  async getNetwork(): Promise<string | null> {
    try {
      if (window.xBullSDK?.getNetwork) {
        return await window.xBullSDK.getNetwork();
      }
      if (window.xBull?.getNetwork) {
        return await window.xBull.getNetwork();
      }
    } catch {
      return null;
    }
    return null;
  }

  onAccountChange(callback: (address: string) => void): () => void {
    if (typeof window === "undefined") return () => {};

    const customListener = (event: Event) => {
      const customEvent = event as CustomEvent<{ address?: string; publicKey?: string }>;
      const newAddress = customEvent.detail?.address || customEvent.detail?.publicKey;
      if (newAddress) callback(newAddress);
    };

    window.addEventListener("xbull:accountChanged", customListener);
    window.addEventListener("message", (msg) => {
      if (msg.data?.type === "XBULL_ACCOUNT_CHANGE" && msg.data?.payload?.address) {
        callback(msg.data.payload.address);
      }
    });

    return () => {
      window.removeEventListener("xbull:accountChanged", customListener);
    };
  }

  onNetworkChange(callback: (network: string) => void): () => void {
    if (typeof window === "undefined") return () => {};

    const customListener = (event: Event) => {
      const customEvent = event as CustomEvent<{ network?: string }>;
      if (customEvent.detail?.network) callback(customEvent.detail.network);
    };

    window.addEventListener("xbull:networkChanged", customListener);
    window.addEventListener("message", (msg) => {
      if (msg.data?.type === "XBULL_NETWORK_CHANGE" && msg.data?.payload?.network) {
        callback(msg.data.payload.network);
      }
    });

    return () => {
      window.removeEventListener("xbull:networkChanged", customListener);
    };
  }
}
