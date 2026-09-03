import { ConnectResult, SignTransactionOptions, WalletAdapter } from "./types";

declare global {
  interface Window {
    albedo?: {
      publicKey: (options: Record<string, unknown>) => Promise<{ pubkey: string; signed_message?: string }>;
      tx: (options: Record<string, unknown>) => Promise<{ signed_envelope_xdr: string }>;
      pay?: (options: Record<string, unknown>) => Promise<unknown>;
      trust?: (options: Record<string, unknown>) => Promise<unknown>;
      isImplicitSessionAllowed?: () => Promise<boolean>;
    };
  }
}

export class AlbedoAdapter implements WalletAdapter {
  id = "albedo" as const;
  name = "Albedo Link";
  description = "Web-based non-custodial wallet & intent signer";
  iconName = "albedo";
  typeBadge = "Web Link";
  installUrl = "https://albedo.link";

  async isAvailable(): Promise<boolean> {
    // Albedo works in browser via web intents or window.albedo injection
    return typeof window !== "undefined";
  }

  async connect(_auto = false): Promise<ConnectResult> {
    if (typeof window === "undefined") {
      throw new Error("Window is not defined");
    }

    let address = "";
    if (window.albedo && typeof window.albedo.publicKey === "function") {
      const res = await window.albedo.publicKey({});
      address = res?.pubkey || "";
    } else {
      const mockAlbedoKey =
        "G" +
        Array.from(
          { length: 55 },
          (_, i) => "ABCDEFGHJKLMNPQRSTUVWXYZ234567"[i % 30],
        ).join("");
      address = mockAlbedoKey;
    }

    if (!address) {
      throw new Error("Failed to authenticate with Albedo");
    }

    return {
      address,
      network: "TESTNET",
      allAccounts: [
        { address, name: "Albedo Primary" },
        {
          address: address.slice(0, 50) + "MULTISIG",
          isMultisig: true,
          name: "Albedo Vault (Multisig)",
        },
      ],
    };
  }

  async disconnect(): Promise<void> {
    // Albedo intent session reset
  }

  async signTransaction(
    xdr: string,
    options?: SignTransactionOptions,
  ): Promise<string | null> {
    if (window.albedo && typeof window.albedo.tx === "function") {
      const res = await window.albedo.tx({
        xdr,
        network: options?.network ?? "TESTNET",
      });
      return res?.signed_envelope_xdr || null;
    }

    return xdr;
  }

  onAccountChange(callback: (address: string) => void): () => void {
    if (typeof window === "undefined") return () => {};

    const customListener = (event: Event) => {
      const customEvent = event as CustomEvent<{ address?: string; pubkey?: string }>;
      const newAddress = customEvent.detail?.address || customEvent.detail?.pubkey;
      if (newAddress) callback(newAddress);
    };

    window.addEventListener("albedo:accountChanged", customListener);
    return () => {
      window.removeEventListener("albedo:accountChanged", customListener);
    };
  }
}
