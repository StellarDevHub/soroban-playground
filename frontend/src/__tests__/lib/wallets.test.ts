import { walletRegistry, FreighterAdapter, XBullAdapter, AlbedoAdapter, HanaAdapter, WalletConnectAdapter } from "@/lib/wallets";

describe("WalletAdapters", () => {
  it("should have all adapters registered in walletRegistry", () => {
    const adapters = walletRegistry.getAll();
    expect(adapters.length).toBeGreaterThanOrEqual(5);

    const ids = adapters.map((a) => a.id);
    expect(ids).toContain("freighter");
    expect(ids).toContain("xbull");
    expect(ids).toContain("albedo");
    expect(ids).toContain("hana");
    expect(ids).toContain("walletconnect");
  });

  describe("AlbedoAdapter", () => {
    it("should be available in browser and connect", async () => {
      const adapter = new AlbedoAdapter();
      expect(await adapter.isAvailable()).toBe(true);

      const res = await adapter.connect();
      expect(res.address).toBeDefined();
      expect(res.address.startsWith("G")).toBe(true);
      expect(res.network).toBe("TESTNET");
    });
  });

  describe("XBullAdapter", () => {
    it("should provide mock or SDK public key and network", async () => {
      const adapter = new XBullAdapter();
      const res = await adapter.connect();
      expect(res.address).toBeDefined();
      expect(res.address.startsWith("GXBULL")).toBe(true);
      expect(res.network).toBe("TESTNET");
    });
  });

  describe("HanaAdapter", () => {
    it("should generate valid mock address when extension not injected", async () => {
      const adapter = new HanaAdapter();
      const res = await adapter.connect();
      expect(res.address).toBeDefined();
      expect(res.address.startsWith("GHANA")).toBe(true);
    });
  });

  describe("WalletConnectAdapter", () => {
    it("should generate session when window.walletConnectStellar not present", async () => {
      const adapter = new WalletConnectAdapter();
      const res = await adapter.connect();
      expect(res.address).toBeDefined();
      expect(res.address.startsWith("GWC")).toBe(true);
    });
  });

  describe("FreighterAdapter", () => {
    it("should instantiate with correct metadata", () => {
      const adapter = new FreighterAdapter();
      expect(adapter.id).toBe("freighter");
      expect(adapter.name).toBe("Freighter");
      expect(adapter.installUrl).toBe("https://freighter.app");
    });
  });
});
