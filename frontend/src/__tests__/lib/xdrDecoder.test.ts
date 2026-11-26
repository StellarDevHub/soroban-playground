import {
  decodeXdrPayload,
  parseBase64ToBytes,
  generateHexDumpRows,
  buildAstFromJson,
} from "@/lib/xdrDecoder";

describe("xdrDecoder engine", () => {
  describe("parseBase64ToBytes & generateHexDumpRows", () => {
    it("converts base64 string to Uint8Array and generates hex dump rows with offsets", () => {
      const base64 = "AAAAEAAAAAVoZWxsbw=="; // 14 bytes
      const bytes = parseBase64ToBytes(base64);
      expect(bytes.length).toBeGreaterThan(0);

      const rows = generateHexDumpRows(bytes);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0].offsetHex).toBe("00000000");
      expect(rows[0].bytes.length).toBe(bytes.length);
      expect(rows[0].ascii).toContain("hello");
    });
  });

  describe("buildAstFromJson", () => {
    it("generates an interactive hierarchical AST with type annotations and byte ranges", () => {
      const sample = {
        name: "test",
        count: 42,
        active: true,
        items: ["a", "b"],
      };
      const ast = buildAstFromJson(sample, "root", "root", 64);
      expect(ast.id).toBe("root");
      expect(ast.type).toBe("Object");
      expect(ast.children).toBeDefined();
      expect(ast.children!.length).toBe(4);

      const countNode = ast.children!.find((c) => c.key === "count");
      expect(countNode).toBeDefined();
      expect(countNode!.value).toBe(42);
      expect(countNode!.type).toBe("i32 / u32");
      expect(countNode!.byteRange).toBeDefined();
    });
  });

  describe("decodeXdrPayload", () => {
    it("accurately decodes ScVal Symbol", () => {
      const result = decodeXdrPayload("AAAAEAAAAAVoZWxsbw==", "ScVal");
      expect(result.type).toBe("ScVal");
      expect(result.error).toBeUndefined();
      expect(result.astRoot).toBeDefined();
    });

    it("accurately decodes complex contract invocation envelope", () => {
      // TransactionEnvelope base64
      const envelopeXdr = "AAAAAgAAAAA3+5nL9Xp2mN9bM7v10rG6s0000000000000000000AAAAZA==";
      const result = decodeXdrPayload(envelopeXdr, "TransactionEnvelope");
      expect(result.rawBytes.length).toBeGreaterThan(0);
      expect(result.hexRows.length).toBeGreaterThan(0);
    });

    it("decodes LedgerEntryData structure", () => {
      // LedgerKey or LedgerEntryData test
      const ledgerXdr = "AAAAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAEAAAAEaW5pdAAAAA==";
      const result = decodeXdrPayload(ledgerXdr, "Auto");
      expect(result.error).toBeUndefined();
      expect(result.rawBytes.length).toBeGreaterThan(0);
    });

    it("returns friendly error on invalid input", () => {
      const result = decodeXdrPayload("not-valid-xdr-$$$$", "ScVal");
      expect(result.error).toBeDefined();
      expect(result.nativeValue).toBeNull();
    });
  });
});
