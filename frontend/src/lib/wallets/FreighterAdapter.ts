import * as freighterApi from "@stellar/freighter-api";
import { ConnectResult, SignTransactionOptions, WalletAdapter } from "./types";

export class FreighterAdapter implements WalletAdapter {
  id = "freighter" as const;
  name = "Freighter";
  description =
    "Official browser extension for Stellar & Soroban smart contracts";
  iconName = "freighter";
  typeBadge = "Extension";
  installUrl = "https://freighter.app";

  async isAvailable(): Promise<boolean> {
    if (typeof window === "undefined") return false;
    try {
      if (typeof freighterApi.isConnected === "function") {
        const res = await freighterApi.isConnected();
        if (typeof res === "boolean") return res;
        if (res && typeof res.isConnected === "boolean") return res.isConnected;
      }
      return !!(window as unknown as { freighter?: unknown }).freighter;
    } catch {
      return false;
    }
  }

  async connect(auto = false): Promise<ConnectResult> {
    if (typeof window === "undefined") {
      throw new Error("Window is not defined");
    }

    const isConnected = await this.isAvailable();
    if (!isConnected) {
      throw new Error("Freighter wallet is not installed or available.");
    }

    let address = "";
    if (typeof freighterApi.isAllowed === "function") {
      const allowedRes = await freighterApi.isAllowed();
      const isAllowed =
        typeof allowedRes === "boolean"
          ? allowedRes
          : allowedRes?.isAllowed === true;

      if (!isAllowed) {
        if (auto) {
          throw new Error("Freighter auto-connect not allowed yet");
        }
        const accessRes = await freighterApi.requestAccess();
        if (accessRes?.error) {
          throw new Error(
            typeof accessRes.error === "string"
              ? accessRes.error
              : "Freighter access denied",
          );
        }
        address = accessRes?.address || "";
      } else {
        const addressRes = await freighterApi.getAddress();
        if (addressRes?.error) {
          throw new Error(
            typeof addressRes.error === "string"
              ? addressRes.error
              : "Failed to get Freighter address",
          );
        }
        address = addressRes?.address || "";
      }
    } else if (typeof freighterApi.requestAccess === "function") {
      const accessRes = await freighterApi.requestAccess();
      if (accessRes?.error) {
        throw new Error(
          typeof accessRes.error === "string"
            ? accessRes.error
            : "Freighter access denied",
        );
      }
      address = accessRes?.address || "";
    }

    if (!address) {
      throw new Error("No address returned from Freighter");
    }

    let network = "TESTNET";
    try {
      if (typeof freighterApi.getNetworkDetails === "function") {
        const netRes = await freighterApi.getNetworkDetails();
        if (netRes && !netRes.error && netRes.network) {
          network = netRes.network;
        }
      } else if (typeof freighterApi.getNetwork === "function") {
        const netRes = await freighterApi.getNetwork();
        if (netRes && typeof netRes === "string") {
          network = netRes;
        } else if (netRes && typeof netRes.network === "string") {
          network = netRes.network;
        }
      }
    } catch {
      // Fall back to default
    }

    return {
      address,
      network,
      allAccounts: [{ address, name: "Freighter Main Account" }],
    };
  }

  async disconnect(): Promise<void> {
    // Freighter doesn't require explicit remote disconnect
  }

  async signTransaction(
    xdr: string,
    options?: SignTransactionOptions,
  ): Promise<string | null> {
    const networkPassphrase =
      options?.networkPassphrase ?? "Test SDF Network ; November 2015";
    const result = await freighterApi.signTransaction(xdr, {
      networkPassphrase,
      accountToSign: options?.accountToSign,
    });

    if (!result) return null;
    if (typeof result === "string") return result;
    if (result.error) {
      throw new Error(
        typeof result.error === "string"
          ? result.error
          : "Signing transaction failed",
      );
    }
    return result.signedTxXdr || null;
  }

  async getNetwork(): Promise<string | null> {
    try {
      if (typeof freighterApi.getNetworkDetails === "function") {
        const netRes = await freighterApi.getNetworkDetails();
        return netRes?.network || null;
      }
      if (typeof freighterApi.getNetwork === "function") {
        const net = await freighterApi.getNetwork();
        return typeof net === "string" ? net : net?.network || null;
      }
    } catch {
      return null;
    }
    return null;
  }

  onAccountChange(callback: (address: string) => void): () => void {
    if (
      typeof freighterApi.watchAddress === "function"
    ) {
      try {
        const unsubscribe = freighterApi.watchAddress((addressOrObj: unknown) => {
          if (typeof addressOrObj === "string") {
            callback(addressOrObj);
          } else if (
            addressOrObj &&
            typeof addressOrObj === "object" &&
            "address" in addressOrObj &&
            typeof (addressOrObj as { address: unknown }).address === "string"
          ) {
            callback((addressOrObj as { address: string }).address);
          }
        });
        if (typeof unsubscribe === "function") return unsubscribe;
      } catch {
        // Fall back to event listener
      }
    }

    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<{ address?: string }>;
      if (customEvent.detail?.address) {
        callback(customEvent.detail.address);
      }
    };

    if (typeof window !== "undefined") {
      window.addEventListener("freighter:accountChanged", handler);
      return () => {
        window.removeEventListener("freighter:accountChanged", handler);
      };
    }

    return () => {};
  }

  onNetworkChange(callback: (network: string) => void): () => void {
    if (
      typeof freighterApi.watchNetwork === "function"
    ) {
      try {
        const unsubscribe = freighterApi.watchNetwork((networkOrObj: unknown) => {
          if (typeof networkOrObj === "string") {
            callback(networkOrObj);
          } else if (
            networkOrObj &&
            typeof networkOrObj === "object" &&
            "network" in networkOrObj &&
            typeof (networkOrObj as { network: unknown }).network === "string"
          ) {
            callback((networkOrObj as { network: string }).network);
          }
        });
        if (typeof unsubscribe === "function") return unsubscribe;
      } catch {
        // Fall back to window listener
      }
    }

    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<{ network?: string }>;
      if (customEvent.detail?.network) {
        callback(customEvent.detail.network);
      }
    };

    if (typeof window !== "undefined") {
      window.addEventListener("freighter:networkChanged", handler);
      return () => {
        window.removeEventListener("freighter:networkChanged", handler);
      };
    }

    return () => {};
  }
}
