import test from "node:test";
import assert from "node:assert";
import {
  formatFiatValue,
  formatMultiCurrencyValue,
  formatStroopAmount,
  stroopToXlm,
  xlmToStroop,
  STROOPS_PER_XLM,
} from "../../utils/formatters";

test("stroopToXlm: exact conversions across denominations", () => {
  assert.strictEqual(stroopToXlm(10000000n), "1.0000000");
  assert.strictEqual(stroopToXlm(1n), "0.0000001");
  assert.strictEqual(stroopToXlm(0n), "0.0000000");
  assert.strictEqual(stroopToXlm(12505000000n), "1250.5000000");
});

test("xlmToStroop: string to BigInt precision", () => {
  assert.strictEqual(xlmToStroop("1"), 10000000n);
  assert.strictEqual(xlmToStroop("0.0000001"), 1n);
  assert.strictEqual(xlmToStroop("100.5"), 1005000000n);
});

test("formatMultiCurrencyValue: fiat calculation", () => {
  const result = formatMultiCurrencyValue(1000000000n, {
    assetCode: "XLM",
    exchangeRateUsd: 0.20,
    fiatCurrency: "USD",
  });
  // 1,000,000,000 Stroops = 100 XLM * $0.20 = $20.00
  assert.strictEqual(result.fiatValueNumber, 20);
  assert.strictEqual(result.tokenSymbol, "XLM");
});
