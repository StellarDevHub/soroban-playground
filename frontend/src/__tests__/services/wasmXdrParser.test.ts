import { xdr, Address, Keypair } from "@stellar/stellar-sdk";
import {
  decodeScValWithAbi,
  parseWasmContractSpec,
  extractWasmCustomSections,
  convertScSpecEntry,
  specTypeDefToTypeSpec,
  type XdrSpecEntry,
} from "../../services/wasmXdrParser";

describe("wasmXdrParser - ABI Decoding", () => {
  const sampleSpecs: XdrSpecEntry[] = [
    {
      kind: "udtStruct",
      name: "AllowanceKey",
      fields: [
        { name: "from", type: { type: "address" }, doc: "Token owner" },
        { name: "spender", type: { type: "address" }, doc: "Token spender" },
      ],
      doc: "Allowance map key",
    },
    {
      kind: "udtStruct",
      name: "AllowanceData",
      fields: [
        { name: "amount", type: { type: "i128" }, doc: "Authorized amount" },
        { name: "expiration_ledger", type: { type: "u32" }, doc: "Expiry" },
      ],
      doc: "Allowance record",
    },
    {
      kind: "udtEnum",
      name: "ContractState",
      cases: [
        { name: "Pending", value: 0, doc: "Pending init" },
        { name: "Active", value: 1, doc: "Operational" },
        { name: "Paused", value: 2, doc: "Halted" },
        { name: "Archived", value: 3, doc: "Archived" },
      ],
      doc: "Contract state enum",
    },
    {
      kind: "udtUnion",
      name: "DataKey",
      cases: [
        { name: "Admin", doc: "Admin key" },
        { name: "Counter", doc: "Counter key" },
        { name: "State", doc: "State key" },
        { name: "Allowance", doc: "Allowance mapping" },
      ],
      doc: "Storage key variants",
    },
  ];

  describe("Complex Struct Keys Decoding", () => {
    it("decodes a complex struct key with multiple address fields", () => {
      const fromAddr = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";
      const spenderAddr = "GC2BKLYOOYPDEFJKLKY6FNNRQMGFLVHJKQRGNSSRRGSMPGF32LHCQVGF";

      const structKeyScVal = xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol("from"),
          val: Address.fromString(fromAddr).toScVal(),
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol("spender"),
          val: Address.fromString(spenderAddr).toScVal(),
        }),
      ]);

      const decoded = decodeScValWithAbi(structKeyScVal, sampleSpecs, "AllowanceKey");

      expect(decoded.type).toBe("Struct(AllowanceKey)");
      expect(decoded.typeName).toBe("AllowanceKey");
      expect(decoded.isUdt).toBe(true);
      expect(decoded.nativeValue).toEqual({
        from: fromAddr,
        spender: spenderAddr,
      });
      expect(decoded.structFields).toHaveLength(2);
      expect(decoded.structFields?.[0]).toEqual({
        name: "from",
        type: "address",
        value: fromAddr,
      });
      expect(decoded.structFields?.[1]).toEqual({
        name: "spender",
        type: "address",
        value: spenderAddr,
      });
    });

    it("decodes a struct value with i128 and u32 fields", () => {
      const structValScVal = xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol("amount"),
          val: xdr.ScVal.scvI128(
            new xdr.Int128Parts({
              hi: new xdr.Int64(0),
              lo: new xdr.Uint64(1500000000),
            })
          ),
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol("expiration_ledger"),
          val: xdr.ScVal.scvU32(1001850),
        }),
      ]);

      const decoded = decodeScValWithAbi(structValScVal, sampleSpecs, "AllowanceData");

      expect(decoded.type).toBe("Struct(AllowanceData)");
      expect(decoded.typeName).toBe("AllowanceData");
      expect(decoded.isUdt).toBe(true);
      expect(decoded.nativeValue).toEqual({
        amount: 1500000000n,
        expiration_ledger: 1001850,
      });
    });
  });

  describe("Enum & Tagged Union Values Decoding", () => {
    it("decodes a C-style u32 enum value matching spec cases", () => {
      const activeScVal = xdr.ScVal.scvU32(1);
      const decoded = decodeScValWithAbi(activeScVal, sampleSpecs, "ContractState");

      expect(decoded.type).toBe("Enum(ContractState)");
      expect(decoded.typeName).toBe("ContractState");
      expect(decoded.isUdt).toBe(true);
      expect(decoded.displayValue).toBe("Active (1)");
      expect(decoded.nativeValue).toBe(1);
      expect(decoded.enumVariant).toEqual({ name: "Active", value: 1 });
    });

    it("decodes a paused enum value (value: 2)", () => {
      const pausedScVal = xdr.ScVal.scvU32(2);
      const decoded = decodeScValWithAbi(pausedScVal, sampleSpecs, "ContractState");

      expect(decoded.type).toBe("Enum(ContractState)");
      expect(decoded.displayValue).toBe("Paused (2)");
      expect(decoded.enumVariant?.name).toBe("Paused");
    });

    it("decodes a tagged union key with variant tag", () => {
      const counterKeyScVal = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Counter")]);
      const decoded = decodeScValWithAbi(counterKeyScVal, sampleSpecs);

      expect(decoded.type).toBe("Union(DataKey::Counter)");
      expect(decoded.displayValue).toBe("Counter");
      expect(decoded.isUdt).toBe(true);
      expect(decoded.enumVariant).toEqual({ name: "Counter", tag: "Counter" });
    });

    it("decodes a symbol enum value", () => {
      const symbolEnumScVal = xdr.ScVal.scvSymbol("Pending");
      const decoded = decodeScValWithAbi(symbolEnumScVal, sampleSpecs);

      expect(decoded.type).toBe("Enum(ContractState)");
      expect(decoded.displayValue).toBe("Pending");
      expect(decoded.enumVariant?.name).toBe("Pending");
    });
  });

  describe("Fallback & Primitive Decoding", () => {
    it("decodes boolean primitives gracefully", () => {
      const boolScVal = xdr.ScVal.scvBool(true);
      const decoded = decodeScValWithAbi(boolScVal);
      expect(decoded.type).toBe("bool");
      expect(decoded.nativeValue).toBe(true);
    });

    it("decodes u32 without matching enum as standard u32", () => {
      const numScVal = xdr.ScVal.scvU32(9999);
      const decoded = decodeScValWithAbi(numScVal);
      expect(decoded.type).toBe("u32");
      expect(decoded.nativeValue).toBe(9999);
    });

    it("decodes base64 string XDR input seamlessly", () => {
      const scval = xdr.ScVal.scvSymbol("my_symbol");
      const base64 = scval.toXDR("base64");
      const decoded = decodeScValWithAbi(base64);
      expect(decoded.type).toBe("symbol");
      expect(decoded.displayValue).toBe("my_symbol");
    });

    it("handles plain non-XDR strings gracefully without crashing", () => {
      const decoded = decodeScValWithAbi("plain_non_xdr_string");
      expect(decoded.type).toBe("string");
      expect(decoded.displayValue).toBe("plain_non_xdr_string");
    });
  });

  describe("WASM Spec Parsing", () => {
    it("returns default fallback spec when empty buffer is passed", () => {
      const specs = parseWasmContractSpec(new Uint8Array(0));
      expect(specs.length).toBeGreaterThan(0);
      expect(specs.some((s) => s.name === "AllowanceKey")).toBe(true);
      expect(specs.some((s) => s.name === "ContractState")).toBe(true);
    });

    it("extracts custom sections from valid WASM header", () => {
      // Create minimal valid WASM with custom section
      const magic = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
      const sectionName = Buffer.from("test_sec");
      const sectionData = Buffer.from([0x01, 0x02, 0x03]);
      const nameLen = [sectionName.length];
      const payload = Buffer.concat([Buffer.from(nameLen), sectionName, sectionData]);
      const sectionHeader = [0x00, payload.length];
      const wasm = Buffer.concat([Buffer.from(magic), Buffer.from(sectionHeader), payload]);

      const sections = extractWasmCustomSections(wasm);
      expect(sections.has("test_sec")).toBe(true);
      expect(sections.get("test_sec")).toEqual(new Uint8Array(sectionData));
    });
  });
});
