/**
 * formatters.ts — [FRONTEND-303]
 *
 * Multi-Currency Value Display with Real-Time Fiat Conversion and Stroop Formatting.
 *
 * Stellar Lumens (XLM) denomination rules:
 *  1 XLM = 10,000,000 Stroops (10^7, 7 decimal places).
 *  Amounts must be calculated without floating point precision loss using BigInt.
 */

export const STROOPS_PER_XLM = 10_000_000n;
export const STROOP_DECIMALS = 7;

export interface FormattedBalanceResult {
  stroopRaw: string;
  tokenFormatted: string;
  tokenSymbol: string;
  fiatFormatted: string;
  fiatValueNumber: number;
  fiatCurrency: string;
  locale: string;
}

/**
 * Converts a raw integer Stroop value (string, number, or bigint) into an exact XLM decimal string.
 * Example: 10000000 -> "1.0000000", 1 -> "0.0000001", 1234567890 -> "123.4567890"
 */
export function stroopToXlm(stroop: string | number | bigint): string {
  try {
    const rawBig = typeof stroop === "bigint" ? stroop : BigInt(String(stroop).trim() || "0");
    const isNegative = rawBig < 0n;
    const absBig = isNegative ? -rawBig : rawBig;

    const integerPart = absBig / STROOPS_PER_XLM;
    const remainder = absBig % STROOPS_PER_XLM;
    const fractionalPart = remainder.toString().padStart(STROOP_DECIMALS, "0");

    const result = `${integerPart}.${fractionalPart}`;
    return isNegative ? `-${result}` : result;
  } catch {
    return "0.0000000";
  }
}

/**
 * Converts an XLM decimal string or number into an exact BigInt Stroop value.
 * Example: "1" -> 10000000n, "0.5" -> 5000000n, "0.0000001" -> 1n
 */
export function xlmToStroop(xlm: string | number): bigint {
  try {
    const rawStr = String(xlm).trim();
    if (!rawStr || rawStr === "0") return 0n;

    const isNegative = rawStr.startsWith("-");
    const cleanStr = isNegative ? rawStr.slice(1) : rawStr;

    const parts = cleanStr.split(".");
    const integerPart = parts[0] || "0";
    let fractionalPart = parts[1] || "";

    // Pad or slice to 7 decimals
    if (fractionalPart.length > STROOP_DECIMALS) {
      fractionalPart = fractionalPart.slice(0, STROOP_DECIMALS);
    } else {
      fractionalPart = fractionalPart.padEnd(STROOP_DECIMALS, "0");
    }

    const totalStroops = BigInt(integerPart) * STROOPS_PER_XLM + BigInt(fractionalPart);
    return isNegative ? -totalStroops : totalStroops;
  } catch {
    return 0n;
  }
}

/**
 * Formats a Stroop amount with locale-aware thousand separators and decimal places.
 * Example: 12505000000n (en-US) -> "1,250.5000000"
 * Example: 12505000000n (de-DE) -> "1.250,5000000"
 */
export function formatStroopAmount(
  stroop: string | number | bigint,
  locale = "en-US",
  options?: {
    minDecimals?: number;
    maxDecimals?: number;
    stripTrailingZeros?: boolean;
  },
): string {
  const xlmStr = stroopToXlm(stroop);
  const numValue = Number(xlmStr);

  const minDecimals = options?.minDecimals ?? (options?.stripTrailingZeros ? 2 : STROOP_DECIMALS);
  const maxDecimals = options?.maxDecimals ?? STROOP_DECIMALS;

  try {
    const formatted = new Intl.NumberFormat(locale, {
      minimumFractionDigits: minDecimals,
      maximumFractionDigits: maxDecimals,
    }).format(numValue);

    return formatted;
  } catch {
    // Fallback if locale is unsupported
    return xlmStr;
  }
}

/**
 * Formats a fiat currency value with locale symbol and grouping.
 * Example: 150.25 (USD, en-US) -> "$150.25"
 * Example: 150.25 (EUR, de-DE) -> "150,25 €"
 */
export function formatFiatValue(
  value: number,
  currency = "USD",
  locale = "en-US",
): string {
  if (!Number.isFinite(value)) return "$0.00";

  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    // Fallback format
    return `$${value.toFixed(2)}`;
  }
}

/**
 * Full multi-currency formatter calculating both token balance and equivalent fiat approximation.
 */
export function formatMultiCurrencyValue(
  stroop: string | number | bigint,
  options?: {
    assetCode?: string;
    exchangeRateUsd?: number;
    fiatCurrency?: "USD" | "EUR" | "GBP";
    fiatRateMultiplier?: number;
    locale?: string;
    stripTrailingZeros?: boolean;
  },
): FormattedBalanceResult {
  const assetCode = options?.assetCode || "XLM";
  const rateUsd = options?.exchangeRateUsd ?? 0.125; // default reasonable fallback
  const fiatCurrency = options?.fiatCurrency || "USD";
  const locale = options?.locale || "en-US";

  // Currency multiplier relative to USD
  const multiplier = options?.fiatRateMultiplier ?? (fiatCurrency === "EUR" ? 0.92 : fiatCurrency === "GBP" ? 0.79 : 1.0);

  const xlmDecimalStr = stroopToXlm(stroop);
  const xlmNumeric = Number(xlmDecimalStr);
  const fiatValueNumber = xlmNumeric * rateUsd * multiplier;

  const tokenFormatted = formatStroopAmount(stroop, locale, {
    stripTrailingZeros: options?.stripTrailingZeros,
  });

  const fiatFormatted = formatFiatValue(fiatValueNumber, fiatCurrency, locale);

  return {
    stroopRaw: String(stroop),
    tokenFormatted,
    tokenSymbol: assetCode,
    fiatFormatted,
    fiatValueNumber,
    fiatCurrency,
    locale,
  };
}
