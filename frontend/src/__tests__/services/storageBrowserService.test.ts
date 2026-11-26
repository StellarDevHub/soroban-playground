import {
  calculateTtlStatus,
  buildBumpTtlOperation,
  buildBumpTtlTransaction,
  executeBumpTtl,
  getMockStorageEntries,
} from "../../services/storageBrowserService";

describe("storageBrowserService - TTL & Bump Operations", () => {
  const currentLedger = 1000000;
  const dummyAccount = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";

  describe("calculateTtlStatus", () => {
    it("returns healthy status when remaining ledgers > 17,280 (~24h)", () => {
      const liveUntil = currentLedger + 50000; // ~2.8 days
      const ttl = calculateTtlStatus(liveUntil, currentLedger, "persistent");

      expect(ttl.status).toBe("healthy");
      expect(ttl.ledgersRemaining).toBe(50000);
      expect(ttl.isExpiring).toBe(false);
      expect(ttl.isCritical).toBe(false);
      expect(ttl.canBump).toBe(true);
      expect(ttl.estimatedTimeRemaining).toBe("2.9d");
    });

    it("returns expiring status when remaining ledgers is between 3,000 and 17,280 (~24h)", () => {
      const liveUntil = currentLedger + 10000; // ~13.8 hours
      const ttl = calculateTtlStatus(liveUntil, currentLedger, "persistent");

      expect(ttl.status).toBe("expiring");
      expect(ttl.ledgersRemaining).toBe(10000);
      expect(ttl.isExpiring).toBe(true);
      expect(ttl.isCritical).toBe(false);
      expect(ttl.canBump).toBe(true);
      expect(ttl.estimatedTimeRemaining).toBe("13.9h");
    });

    it("returns critical status when remaining ledgers <= 3,000 (~4.1h)", () => {
      const liveUntil = currentLedger + 1200; // ~1.6 hours
      const ttl = calculateTtlStatus(liveUntil, currentLedger, "persistent");

      expect(ttl.status).toBe("critical");
      expect(ttl.ledgersRemaining).toBe(1200);
      expect(ttl.isExpiring).toBe(true);
      expect(ttl.isCritical).toBe(true);
      expect(ttl.canBump).toBe(true);
      expect(ttl.estimatedTimeRemaining).toBe("1.7h");
    });

    it("formats minutes for short countdowns (< 720 ledgers / 1 hour)", () => {
      const liveUntil = currentLedger + 180; // 15 minutes
      const ttl = calculateTtlStatus(liveUntil, currentLedger, "persistent");

      expect(ttl.status).toBe("critical");
      expect(ttl.estimatedTimeRemaining).toBe("15m");
    });

    it("returns archived status when entry has expired (ledgersRemaining <= 0)", () => {
      const liveUntil = currentLedger - 100;
      const ttl = calculateTtlStatus(liveUntil, currentLedger, "persistent");

      expect(ttl.status).toBe("archived");
      expect(ttl.ledgersRemaining).toBe(-100);
      expect(ttl.estimatedTimeRemaining).toBe("Archived");
      expect(ttl.canBump).toBe(false);
    });

    it("does not allow bumping for temporary or instance storage", () => {
      const liveUntil = currentLedger + 5000;
      const tempTtl = calculateTtlStatus(liveUntil, currentLedger, "temporary");
      expect(tempTtl.canBump).toBe(false);

      const instanceTtl = calculateTtlStatus(liveUntil, currentLedger, "instance");
      expect(instanceTtl.canBump).toBe(false);
    });
  });

  describe("buildBumpTtlOperation & buildBumpTtlTransaction", () => {
    it("builds a valid extendFootprintTtl operation", () => {
      const op = buildBumpTtlOperation({
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        keyXdr: "AAAAEAAAAAEAAAABAAAADwAAAAdDb3VudGVyAA==",
        durability: "persistent",
        extendToLedgers: 50000,
        sourceAccount: dummyAccount,
      });

      expect(op).toBeDefined();
      expect(op.body().switch().name).toBe("extendFootprintTtl");
      expect(op.body().extendFootprintTtlOp().extendTo()).toBe(50000);
    });

    it("throws error when extendToLedgers is <= 0", () => {
      expect(() =>
        buildBumpTtlOperation({
          contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
          keyXdr: "AAAAEAAAAAEAAAABAAAADwAAAAdDb3VudGVyAA==",
          durability: "persistent",
          extendToLedgers: 0,
        })
      ).toThrow("extendToLedgers must be greater than 0");
    });

    it("builds a transaction envelope with ExtendFootprintTtl operation", () => {
      const { transaction, transactionXdr } = buildBumpTtlTransaction(
        {
          contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
          keyXdr: "AAAAEAAAAAEAAAABAAAADwAAAAdDb3VudGVyAA==",
          durability: "persistent",
          extendToLedgers: 25000,
        },
        { sourceAccount: dummyAccount }
      );

      expect(transaction).toBeDefined();
      expect(typeof transactionXdr).toBe("string");
      expect(transactionXdr.length).toBeGreaterThan(0);
      expect(transaction.operations).toHaveLength(1);
      expect(transaction.operations[0].type).toBe("extendFootprintTtl");
    });
  });

  describe("executeBumpTtl", () => {
    it("successfully simulates a Bump TTL transaction and returns new ledger", async () => {
      const result = await executeBumpTtl(
        {
          contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
          keyXdr: "AAAAEAAAAAEAAAABAAAADwAAAAdDb3VudGVyAA==",
          durability: "persistent",
          extendToLedgers: 40000,
        },
        currentLedger,
        { signer: jest.fn().mockResolvedValue("signedXdr") }
      );

      expect(result.success).toBe(true);
      expect(result.newLiveUntil).toBe(currentLedger + 40000);
      expect(result.ledgersExtended).toBe(40000);
      expect(result.txHash).toBeDefined();
      expect(result.txHash?.startsWith("0x")).toBe(true);
    });
  });

  describe("getMockStorageEntries", () => {
    it("generates entries with decoded complex struct keys and enum values", () => {
      const entries = getMockStorageEntries(currentLedger);

      expect(entries.length).toBeGreaterThanOrEqual(5);

      // Check for struct key entry (AllowanceKey)
      const structEntry = entries.find((e) => e.keyDecoded.type.includes("AllowanceKey"));
      expect(structEntry).toBeDefined();
      expect(structEntry?.durability).toBe("persistent");
      expect(structEntry?.ttl?.canBump).toBe(true);

      // Check for enum value entry (ContractState::Active)
      const enumEntry = entries.find((e) => e.valDecoded.type.includes("ContractState"));
      expect(enumEntry).toBeDefined();

      // Check for archived entry
      const archivedEntry = entries.find((e) => e.ttl?.status === "archived");
      expect(archivedEntry).toBeDefined();
      expect(archivedEntry?.ttl?.canBump).toBe(false);
    });
  });
});
