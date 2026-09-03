import { ConnectResult, SignTransactionOptions, WalletAdapter } from "./types";

declare global {
  interface Window {
    walletConnectStellar?: {
      connect: (options?: { chains?: string[] }) => Promise<{ accounts: string[]; chainId: string }>;
      signTransaction: (xdr: string, options?: { networkPassphrase?: string }) => Promise<string>;
      disconnect?: () => Promise<void>;
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
      off?: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}

export class WalletConnectAdapter implements WalletAdapter {
  id = "walletconnect" as const;
  name = "WalletConnect (SEP-0043)";
  description = "Open standard connecting mobile wallets via QR code & deep links";
  iconName = "walletconnect";
  typeBadge = "SEP-0043 / Mobile";
  installUrl = "https://walletconnect.com";

  async isAvailable(): Promise<boolean> {
    return typeof window !== "undefined";
  }

  async connect(_auto = false): Promise<ConnectResult> {
    if (typeof window === "undefined") {
      throw new Error("Window is not defined");
    }

    let address = "";
    let network = "TESTNET";

    if (window.walletConnectStellar) {
      try {
        const session = await window.walletConnectStellar.connect({
          chains: ["stellar:pubnet", "stellar:testnet"],
        });
        if (session.accounts && session.accounts.length > 0) {
          address = session.accounts[0];
        }
        if (session.chainId && session.chainId.includes("testnet")) {
          network = "TESTNET";
        } else if (session.chainId && session.chainId.includes("pubnet")) {
          network = "PUBLIC";
        }
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : "WalletConnect session rejected");
      }
    } else {
      const mockWcKey =
        "GWC" +
        Array.from(
          { length: 53 },
          (_, i) => "0123456789ABCDEF"[i % 16],
        ).join("");
      address = mockWcKey;
    }

    return {
      address,
      network,
      allAccounts: [{ address, name: "WalletConnect Session" }],
    };
  }

  async disconnect(): Promise<void> {
    if (window.walletConnectStellar?.disconnect) {
      try {
        await window.walletConnectStellar.disconnect();
      } catch {
        // Ignore
      }
    }
  }

  async signTransaction(
    xdr: string,
    options?: SignTransactionOptions,
  ): Promise<string | null> {
    if (window.walletConnectStellar?.signTransaction) {
      return await window.walletConnectStellar.signTransaction(xdr, {
        networkPassphrase: options?.networkPassphrase,
      });
    }
    return xdr;
  }

  onAccountChange(callback: (address: string) => void): () => void {
    if (typeof window === "undefined") return () => {};

    const customListener = (event: Event) => {
      const customEvent = event as CustomEvent<{ address?: string; account?: string }>;
      const newAddress = customEvent.detail?.address || customEvent.detail?.account;
      if (newAddress) callback(newAddress);
    };

    window.addEventListener("walletconnect:accountChanged", customListener);
    return () => {
      window.removeEventListener("walletconnect:accountChanged", customListener);
    };
  }

  onNetworkChange(callback: (network: string) => void): () => void {
    if (typeof window === "undefined") return () => {};

    const customListener = (event: Event) => {
      const customEvent = event as CustomEvent<{ network?: string; chainId?: string }>;
      const net = customEvent.detail?.network || customEvent.detail?.chainId;
      if (net) callback(net);
    };

    window.addEventListener("walletconnect:networkChanged", customListener);
    return () => {
      window.removeEventListener("walletconnect:networkChanged", customListener);
    };
  }
}
