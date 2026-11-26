import {
  formatFiatValue,
  formatMultiCurrencyValue,
  formatStroopAmount,
  stroopToXlm,
  xlmToStroop,
  STROOPS_PER_XLM,
} from "../../utils/formatters";

describe("Formatters: Stroop and Multi-Currency Scaling", () => {
  describe("stroopToXlm", () => {
    it("converts 10^7 Stroops to 1.0000000 XLM", () => {
      expect(stroopToXlm(10000000)).toBe("1.0000000");
      expect(stroopToXlm("10000000")).toBe("1.0000000");
      expect(stroopToXlm(10000000n)).toBe("1.0000000");
    });

    it("converts micro-Stroops accurately without float rounding issues", () => {
      expect(stroopToXlm(1)).toBe("0.0000001");
      expect(stroopToXlm(10)).toBe("0.0000010");
      expect(stroopToXlm(5000000)).toBe("0.5000000");
    });

    it("handles zero and empty inputs gracefully", () => {
      expect(stroopToXlm(0)).toBe("0.0000000");
      expect(stroopToXlm("")).toBe("0.0000000");
    });

    it("converts large balances (multi-million XLM)", () => {
      const oneMillionXlmInStroops = 1000000n * STROOPS_PER_XLM;
      expect(stroopToXlm(oneMillionXlmInStroops)).toBe("1000000.0000000");
    });

    it("handles negative amounts correctly", () => {
      expect(stroopToXlm(-10000000n)).toBe("-1.0000000");
      expect(stroopToXlm(-1n)).toBe("-0.0000001");
    });
  });

  describe("xlmToStroop", () => {
    it("converts integer and decimal XLM strings to exact BigInt Stroops", () => {
      expect(xlmToStroop("1")).toBe(10000000n);
      expect(xlmToStroop("0.5")).toBe(5000000n);
      expect(xlmToStroop("0.0000001")).toBe(1n);
      expect(xlmToStroop("123.4567890")).toBe(1234567890n);
    });

    it("handles numbers and zero strings", () => {
      expect(xlmToStroop(1)).toBe(10000000n);
      expect(xlmToStroop("0")).toBe(0n);
      expect(xlmToStroop("")).toBe(0n);
    });
  });

  describe("formatStroopAmount", () => {
    it("formats with US English locale groupings", () => {
      const formatted = formatStroopAmount(12505000000n, "en-US");
      expect(formatted).toBe("1,250.5000000");
    });

    it("formats with German locale decimal comma separators", () => {
      const formatted = formatStroopAmount(12505000000n, "de-DE");
      expect(formatted).toBe("1.250,5000000");
    });
  });

  describe("formatFiatValue", () => {
    it("formats USD currency values with symbol", () => {
      expect(formatFiatValue(150.25, "USD", "en-US")).toBe("$150.25");
    });

    it("formats EUR currency values with European notation", () => {
      const formatted = formatFiatValue(150.25, "EUR", "de-DE");
      expect(formatted).toMatch(/150,25/);
    });
  });

  describe("formatMultiCurrencyValue", () => {
    it("computes complete multi-currency representation with fiat conversion", () => {
      const result = formatMultiCurrencyValue(10000000000n, {
        assetCode: "XLM",
        exchangeRateUsd: 0.12,
        fiatCurrency: "USD",
        locale: "en-US",
      });

      // 10,000,000,000 Stroops = 1,000 XLM
      // 1,000 XLM * $0.12 = $120.00
      expect(result.tokenFormatted).toBe("1,000.0000000");
      expect(result.tokenSymbol).toBe("XLM");
      expect(result.fiatFormatted).toBe("$120.00");
      expect(result.fiatValueNumber).toBe(120);
    });
  });
});
