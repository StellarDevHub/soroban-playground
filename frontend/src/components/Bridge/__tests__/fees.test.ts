import { describe, expect, it } from "@jest/globals";
import { calculateBridgeFees, formatFixed, parseFixed } from "../fees";

describe("bridge fee calculations", () => {
  it("calculates known EVM and Cosmos quotes with fixed-point amounts", () => {
    const evm = calculateBridgeFees("100.00", "stellar-to-evm", "1.00");
    expect(evm.relayerFeeMicros).toBe(150_000n);
    expect(evm.sourceFeeXlmMicros).toBe(10_000n);
    expect(evm.destinationGasCurrency).toBe("ETH");
    expect(evm.minReceivedMicros).toBe(98_851_500n);
    expect(formatFixed(evm.destinationGasXlmMicros)).toBe("10.5");
    expect(evm.estimatedTransitSeconds).toBe(45);

    const cosmos = calculateBridgeFees("100.00", "stellar-to-cosmos", "0.00");
    expect(cosmos.destinationGasCurrency).toBe("ATOM");
    expect(formatFixed(cosmos.destinationGasMicros)).toBe("0.0065");
    expect(cosmos.estimatedTransitSeconds).toBe(28);
  });

  it("applies slippage to net amount and handles large integer amounts", () => {
    const quote = calculateBridgeFees("100", "evm-to-stellar", "0.50");
    expect(quote.minReceivedMicros).toBe(99_350_750n);
    expect(quote.destinationGasCurrency).toBe("XLM");
    expect(formatFixed(quote.destinationGasMicros)).toBe("0.012");
    expect(quote.destinationGasXlmMicros).toBe(12_000n);
    expect(quote.estimatedTransitSeconds).toBe(8);
    expect(parseFixed("999999999999999999999.123456")).toBe(999999999999999999999123456n);
  });

  it("rejects zero, malformed amounts, and out-of-range slippage", () => {
    expect(() => calculateBridgeFees("0", "stellar-to-evm", "1")).toThrow(/greater than zero/i);
    expect(() => calculateBridgeFees("-1", "stellar-to-evm", "1")).toThrow(/valid/i);
    expect(() => calculateBridgeFees("1", "stellar-to-evm", "50.01")).toThrow(/between 0% and 50%/i);
    expect(() => calculateBridgeFees("1", "stellar-to-evm", "-0.1")).toThrow(/valid/i);
    expect(() => parseFixed("1.1234567")).toThrow(/decimal places/i);
  });
});