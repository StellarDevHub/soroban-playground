import type { BridgeDirection, Chain } from "./types";

export const FEE_RATES = {
  amountDecimals: 6,
  relayerFeeBasisPoints: 15,
  sourceFeeXlmMicros: 10_000n,
  destinationGasMicros: { EVM: 420n, Cosmos: 6_500n, Stellar: 12_000n },
  usdMicrosPerToken: {
    XLM: 120_000n,
    ETH: 3_000_000_000n,
    ATOM: 8_000_000n,
  },
  transitSeconds: { EVM: 45, Cosmos: 28, Stellar: 8 },
} as const;

export interface BridgeFeeQuote {
  amountMicros: bigint;
  relayerFeeMicros: bigint;
  sourceFeeXlmMicros: bigint;
  destinationGasMicros: bigint;
  destinationGasCurrency: "ETH" | "ATOM" | "XLM";
  destinationGasXlmMicros: bigint;
  minReceivedMicros: bigint;
  slippageBasisPoints: bigint;
  estimatedTransitSeconds: number;
}

export function parseFixed(
  value: string,
  decimals: number = FEE_RATES.amountDecimals,
): bigint {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d*)?$/.test(trimmed)) {
    throw new Error("Enter a valid non-negative decimal amount.");
  }
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) throw new Error(`Use no more than ${decimals} decimal places.`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
}

export function formatFixed(value: bigint, decimals = FEE_RATES.amountDecimals): string {
  const unit = 10n ** BigInt(decimals);
  const whole = value / unit;
  const fraction = (value % unit).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function parseSlippageBasisPoints(value: string): bigint {
  const slippageMicros = parseFixed(value, 2);
  if (slippageMicros > 5_000n) throw new Error("Slippage must be between 0% and 50%.");
  return slippageMicros;
}

function destinationNetwork(direction: BridgeDirection): Chain {
  if (direction.endsWith("stellar")) return "Stellar Soroban";
  return direction.includes("evm") ? "EVM" : "Cosmos";
}

export function calculateBridgeFees(
  amount: string,
  direction: BridgeDirection,
  slippagePercent: string,
): BridgeFeeQuote {
  const amountMicros = parseFixed(amount);
  if (amountMicros <= 0n) throw new Error("Amount must be greater than zero.");

  const destination = destinationNetwork(direction);
  const chain =
    destination === "Stellar Soroban"
      ? "Stellar"
      : destination;
  const slippageBasisPoints = parseSlippageBasisPoints(slippagePercent);
  const relayerFeeMicros =
    (amountMicros * BigInt(FEE_RATES.relayerFeeBasisPoints) + 9_999n) / 10_000n;
  const amountAfterRelayer = amountMicros - relayerFeeMicros;
  if (amountAfterRelayer < 0n) throw new Error("Fees exceed the transfer amount.");
  const minReceivedMicros =
    (amountAfterRelayer * (10_000n - slippageBasisPoints)) / 10_000n;
  const destinationGasCurrency =
    chain === "EVM" ? "ETH" : chain === "Cosmos" ? "ATOM" : "XLM";
  const destinationGasMicros = FEE_RATES.destinationGasMicros[chain];
  const destinationGasXlmMicros =
    destinationGasCurrency === "XLM"
      ? destinationGasMicros
      : (destinationGasMicros * FEE_RATES.usdMicrosPerToken[destinationGasCurrency]) /
        FEE_RATES.usdMicrosPerToken.XLM;

  return {
    amountMicros,
    relayerFeeMicros,
    sourceFeeXlmMicros: FEE_RATES.sourceFeeXlmMicros,
    destinationGasMicros,
    destinationGasCurrency,
    destinationGasXlmMicros,
    minReceivedMicros,
    slippageBasisPoints,
    estimatedTransitSeconds: FEE_RATES.transitSeconds[chain],
  };
}