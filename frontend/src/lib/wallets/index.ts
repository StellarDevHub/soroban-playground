import { WalletAdapter, WalletType } from "./types";
import { FreighterAdapter } from "./FreighterAdapter";
import { XBullAdapter } from "./XBullAdapter";
import { AlbedoAdapter } from "./AlbedoAdapter";
import { HanaAdapter } from "./HanaAdapter";
import { WalletConnectAdapter } from "./WalletConnectAdapter";
import { RangoAdapter, SorobanDevAdapter } from "./OtherAdapters";

export * from "./types";
export * from "./FreighterAdapter";
export * from "./XBullAdapter";
export * from "./AlbedoAdapter";
export * from "./HanaAdapter";
export * from "./WalletConnectAdapter";
export * from "./OtherAdapters";

class WalletAdapterRegistry {
  private adapters: Map<WalletType, WalletAdapter> = new Map();

  constructor() {
    this.register(new FreighterAdapter());
    this.register(new XBullAdapter());
    this.register(new AlbedoAdapter());
    this.register(new HanaAdapter());
    this.register(new WalletConnectAdapter());
    this.register(new RangoAdapter());
    this.register(new SorobanDevAdapter());
  }

  register(adapter: WalletAdapter) {
    this.adapters.set(adapter.id, adapter);
  }

  get(id: WalletType): WalletAdapter | undefined {
    return this.adapters.get(id);
  }

  getAll(): WalletAdapter[] {
    return Array.from(this.adapters.values());
  }
}

export const walletRegistry = new WalletAdapterRegistry();
