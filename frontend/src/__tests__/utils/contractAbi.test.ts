import {
  normalizeType,
  extractInnerType,
  extractMapTypes,
  validateSorobanType,
  serializeValueToScVal,
  parseContractAbiFromSource,
  validateAbiArguments,
  buildAbiArguments,
} from "../../utils/contractAbi";

describe("contractAbi Utility", () => {
  describe("normalizeType", () => {
    it("should normalize primitive and Soroban alias types", () => {
      expect(normalizeType("address")).toBe("address");
      expect(normalizeType("symbol")).toBe("symbol");
      expect(normalizeType("u32")).toBe("number");
      expect(normalizeType("i128")).toBe("u128");
      expect(normalizeType("stroops")).toBe("stroops");
      expect(normalizeType("bool")).toBe("bool");
    });

    it("should recognize complex Soroban generic containers", () => {
      expect(normalizeType("Option<Address>")).toBe("option");
      expect(normalizeType("Option<u32>")).toBe("option");
      expect(normalizeType("Vec<Address>")).toBe("vec");
      expect(normalizeType("Vector<u64>")).toBe("vec");
      expect(normalizeType("Map<Symbol, i128>")).toBe("map");
      expect(normalizeType("BytesN<32>")).toBe("bytes");
      expect(normalizeType("Bytes")).toBe("bytes");
    });
  });

  describe("extractInnerType & extractMapTypes", () => {
    it("should extract inner types from generic containers", () => {
      expect(extractInnerType("Option<Address>")).toBe("Address");
      expect(extractInnerType("Vec<u128>")).toBe("u128");
    });

    it("should extract key and value types from Map", () => {
      const { keyType, valueType } = extractMapTypes("Map<Symbol, Address>");
      expect(keyType).toBe("Symbol");
      expect(valueType).toBe("Address");
    });
  });

  describe("validateSorobanType", () => {
    it("should validate Stellar public (G...) and contract (C...) addresses", () => {
      const validG = "GABFQIK63R2NETJM7T673EAMZN4RJLLGP3OFUEJU5SZVTGWUKULZJNL6";
      const validC = "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5NOAO7ARIS64G7QO";
      expect(validateSorobanType("to", "Address", validG)).toBeNull();
      expect(validateSorobanType("contract", "Address", validC)).toBeNull();

      expect(validateSorobanType("to", "Address", "invalid-address")).toContain("valid Stellar Address");
      expect(validateSorobanType("to", "Address", "")).toContain("required");
    });

    it("should validate Stroop integer amounts", () => {
      expect(validateSorobanType("amount", "stroops", "10000000")).toBeNull();
      expect(validateSorobanType("amount", "stroops", "-50")).toContain("positive integer amount in Stroops");
      expect(validateSorobanType("amount", "stroops", "abc")).toContain("positive integer amount in Stroops");
    });

    it("should validate hex bytes", () => {
      expect(validateSorobanType("hash", "Bytes", "0xabcdef12")).toBeNull();
      expect(validateSorobanType("hash", "Bytes", "abcdef12")).toBeNull();
      expect(validateSorobanType("hash", "Bytes", "0xxyz")).toContain("valid hexadecimal bytes");
      expect(validateSorobanType("hash", "Bytes", "0xabc")).toContain("even length");
    });

    it("should allow empty/null values for Option<T>, but validate if provided", () => {
      expect(validateSorobanType("memo", "Option<Symbol>", null)).toBeNull();
      expect(validateSorobanType("memo", "Option<Symbol>", "")).toBeNull();
      expect(validateSorobanType("memo", "Option<Symbol>", "TRANSFER_OK")).toBeNull();
      expect(validateSorobanType("memo", "Option<Address>", "invalid-addr")).toContain("valid Stellar Address");
    });

    it("should validate Vector items recursively", () => {
      const validAddrs = [
        "GABFQIK63R2NETJM7T673EAMZN4RJLLGP3OFUEJU5SZVTGWUKULZJNL6",
        "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5NOAO7ARIS64G7QO",
      ];
      expect(validateSorobanType("whitelist", "Vec<Address>", validAddrs)).toBeNull();
      expect(validateSorobanType("whitelist", "Vec<Address>", ["invalid-addr"])).toContain("valid Stellar Address");
    });

    it("should validate Map key-value entries", () => {
      const mapVal = {
        SYM_A: "GABFQIK63R2NETJM7T673EAMZN4RJLLGP3OFUEJU5SZVTGWUKULZJNL6",
      };
      expect(validateSorobanType("balances", "Map<Symbol, Address>", mapVal)).toBeNull();

      const invalidMapVal = {
        SYM_A: "not-an-address",
      };
      expect(validateSorobanType("balances", "Map<Symbol, Address>", invalidMapVal)).toContain("valid Stellar Address");
    });
  });

  describe("serializeValueToScVal", () => {
    it("should serialize primitives into standard ScVal JSON structure", () => {
      expect(serializeValueToScVal("bool", true)).toEqual({ type: "bool", value: true });
      expect(serializeValueToScVal("u32", 42)).toEqual({ type: "u32", value: 42 });
      expect(serializeValueToScVal("address", "GABFQIK63R2NETJM7T673EAMZN4RJLLGP3OFUEJU5SZVTGWUKULZJNL6")).toEqual({
        type: "address",
        value: "GABFQIK63R2NETJM7T673EAMZN4RJLLGP3OFUEJU5SZVTGWUKULZJNL6",
      });
      expect(serializeValueToScVal("bytes", "0xdeadbeef")).toEqual({ type: "bytes", value: "deadbeef" });
      expect(serializeValueToScVal("stroops", "5000000")).toEqual({ type: "i128", value: "5000000" });
    });

    it("should serialize Option<T> (void when empty, typed when provided)", () => {
      expect(serializeValueToScVal("Option<Address>", null)).toEqual({ type: "void" });
      expect(serializeValueToScVal("Option<u32>", 10)).toEqual({ type: "u32", value: 10 });
    });

    it("should serialize Vec<T> into typed ScVal array", () => {
      const result = serializeValueToScVal("Vec<u32>", [1, 2, 3]);
      expect(result).toEqual({
        type: "vec",
        value: [
          { type: "u32", value: 1 },
          { type: "u32", value: 2 },
          { type: "u32", value: 3 },
        ],
      });
    });

    it("should serialize Map<K, V> into ScVal map entries", () => {
      const result = serializeValueToScVal("Map<Symbol, u32>", { bonus: 100 });
      expect(result).toEqual({
        type: "map",
        value: [
          {
            key: { type: "symbol", value: "bonus" },
            val: { type: "u32", value: 100 },
          },
        ],
      });
    });
  });

  describe("parseContractAbiFromSource & argument builders", () => {
    const sampleRustSource = `
    /// Transfer tokens with optional memo
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128, memo: Option<Symbol>) -> bool {
        true
    }

    /// Batch deposit multiple accounts
    pub fn batch_deposit(env: Env, recipients: Vec<Address>, values: Map<Symbol, i128>) {
    }
    `;

    it("should parse complex Soroban signatures and flag optional fields", () => {
      const abis = parseContractAbiFromSource(sampleRustSource);
      expect(abis).toHaveLength(2);

      const transferFn = abis[0];
      expect(transferFn.name).toBe("transfer");
      expect(transferFn.doc).toBe("Transfer tokens with optional memo");
      expect(transferFn.inputs).toHaveLength(4); // env is omitted
      expect(transferFn.inputs![0].name).toBe("from");
      expect(transferFn.inputs![0].type).toBe("Address");
      expect(transferFn.inputs![3].name).toBe("memo");
      expect(transferFn.inputs![3].isOptional).toBe(true);

      const batchFn = abis[1];
      expect(batchFn.name).toBe("batch_deposit");
      expect(batchFn.inputs![0].type).toBe("Vec<Address>");
      expect(batchFn.inputs![1].type).toBe("Map<Symbol,i128>");
    });

    it("should validate and build argument records", () => {
      const abis = parseContractAbiFromSource(sampleRustSource);
      const values = {
        from: "GABFQIK63R2NETJM7T673EAMZN4RJLLGP3OFUEJU5SZVTGWUKULZJNL6",
        to: "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5NOAO7ARIS64G7QO",
        amount: "1000",
        memo: null,
      };

      const error = validateAbiArguments(abis[0], values);
      expect(error).toBe("");

      const built = buildAbiArguments(abis[0], values);
      expect(built.from).toBe("GABFQIK63R2NETJM7T673EAMZN4RJLLGP3OFUEJU5SZVTGWUKULZJNL6");
      expect(built.memo).toBeNull();
    });
  });
});
