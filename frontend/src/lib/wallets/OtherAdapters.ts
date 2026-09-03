import { ConnectResult, SignTransactionOptions, WalletAdapter } from "./types";

declare global {
  interface Window {
    soroban?: {
      getPublicKey: () => Promise<string>;
      getNetwork: () => Promise<string>;
      signTransaction?: (xdr: string) => Promise<string>;
    };
  }
}

export class SorobanDevAdapter implements WalletAdapter {
  id = "soroban-wallet" as const;
  name = "Soroban Wallet";
  description = "Developer-focused browser extension for local testing";
  iconName = "soroban-wallet";
  typeBadge = "Dev Tools";
  installUrl = "https://soroban.stellar.org";

  async isAvailable(): Promise<boolean> {
    if (typeof window === "undefined") return false;
    return !!window.soroban;
  }

  async connect(_auto = false): Promise<ConnectResult> {
    if (typeof window === "undefined") {
      throw new Error("Window is not defined");
    }

    if (!window.soroban) {
      throw new Error("Soroban developer wallet extension is not installed");
    }

    const address = await window.soroban.getPublicKey();
    let network = "STANDALONE";
    try {
      network = await window.soroban.getNetwork();
    } catch {
      // Fallback
    }

    return {
      address,
      network,
      allAccounts: [{ address, name: "Local Dev Account" }],
    };
  }

  async disconnect(): Promise<void> {}

  async signTransaction(
    xdr: string,
    _options?: SignTransactionOptions,
  ): Promise<string | null> {
    if (window.soroban?.signTransaction) {
      return await window.soroban.signTransaction(xdr);
    }
    return xdr;
  }
}

export class RangoAdapter implements WalletAdapter {
  id = "rango" as const;
  name = "Rango Suite";
  description = "Cross-chain Stellar & Soroban multi-wallet gateway";
  iconName = "rango";
  typeBadge = "Web Suite";
  installUrl = "https://rango.exchange";

  async isAvailable(): Promise<boolean> {
    return typeof window !== "undefined";
  }

  async connect(_auto = false): Promise<ConnectResult> {
    const mockRangoKey =
      "GRANGO" +
      Array.from(
        { length: 50 },
        (_, i) => "0123456789ABCDEF"[i % 16],
      ).join("");

    return {
      address: mockRangoKey,
      network: "TESTNET",
      allAccounts: [{ address: mockRangoKey, name: "Rango Web Wallet" }],
    };
  }

  async disconnect(): Promise<void> {}

  async signTransaction(
    xdr: string,
    _options?: SignTransactionOptions,
  ): Promise<string | null> {
    return xdr;
  }
}
