export interface ContractAbiFunctionInput {
  name: string;
  type: string;
  doc?: string;
  isOptional?: boolean;
  innerType?: string;
  mapKeyType?: string;
  mapValueType?: string;
  enumVariants?: string[];
  structFields?: Array<{ name: string; type: string }>;
}

export interface ContractAbiFunction {
  name: string;
  doc?: string;
  inputs?: ContractAbiFunctionInput[];
  outputs?: string[];
}

export type ContractAbiValue =
  | string
  | number
  | boolean
  | unknown[]
  | Record<string, unknown>
  | null
  | undefined;

export const STELLAR_ADDRESS_REGEX = /^(G[A-Z2-7]{55}|C[A-Z2-7]{55})$/;
export const SOROBAN_SYMBOL_REGEX = /^[a-zA-Z0-9_]{1,32}$/;
export const HEX_BYTES_REGEX = /^(0x)?[0-9a-fA-F]*$/;

const RUST_GENERIC_LIFETIME_REGEX = /&['a-z]+\s+/g;
const RUST_SELF_PARAM = /^&?(self|&self|mut self|&mut self)$/;

const RUST_TYPE_ALIASES: Record<string, string> = {
  symbol: "symbol",
  env: "string",
  address: "address",
  bytes: "bytes",
  bytesn: "bytes",
  string: "string",
  bool: "bool",
  u8: "number",
  u16: "number",
  u32: "number",
  u64: "u128",
  u128: "u128",
  u256: "u128",
  i8: "number",
  i16: "number",
  i32: "number",
  i64: "u128",
  i128: "u128",
  i256: "u128",
  f32: "number",
  f64: "number",
  stroops: "stroops",
};

const IGNORED_PARAM_NAMES = new Set(["env", "_"]);

export function stripLifetimeAnnotations(rawType: string): string {
  return rawType.replace(RUST_GENERIC_LIFETIME_REGEX, "").trim();
}

/**
 * Normalizes Rust/Soroban types into canonical categories:
 * "string" | "number" | "bool" | "address" | "symbol" | "u128" | "stroops" | "bytes" | "vec" | "map" | "option" | "tuple" | "struct"
 */
export function normalizeType(type: string): string {
  if (!type || typeof type !== "string") return "string";
  const normalized = type.trim().toLowerCase();

  if (RUST_TYPE_ALIASES[normalized]) {
    return RUST_TYPE_ALIASES[normalized];
  }

  if (normalized.startsWith("option<") && normalized.endsWith(">")) {
    return "option";
  }
  if (normalized.startsWith("vec<") || normalized.startsWith("vector<")) {
    return "vec";
  }
  if (normalized.startsWith("map<")) {
    return "map";
  }
  if (normalized.startsWith("tuple") || (normalized.startsWith("(") && normalized.endsWith(")"))) {
    return "tuple";
  }
  if (normalized.startsWith("enum")) {
    return "enum";
  }
  if (normalized.startsWith("struct")) {
    return "struct";
  }
  if (normalized.startsWith("bytesn<") || normalized.startsWith("bytes")) {
    return "bytes";
  }

  return "string";
}

/**
 * Extracts inner type from generic containers like Option<T> or Vec<T>
 */
export function extractInnerType(genericType: string): string {
  if (!genericType) return "string";
  const start = genericType.indexOf("<");
  const end = genericType.lastIndexOf(">");
  if (start !== -1 && end !== -1 && end > start) {
    return genericType.slice(start + 1, end).trim();
  }
  return "string";
}

/**
 * Extracts key and value types from Map<K, V>
 */
export function extractMapTypes(mapType: string): { keyType: string; valueType: string } {
  const inner = extractInnerType(mapType);
  const commaIdx = inner.indexOf(",");
  if (commaIdx !== -1) {
    return {
      keyType: inner.slice(0, commaIdx).trim(),
      valueType: inner.slice(commaIdx + 1).trim(),
    };
  }
  return { keyType: "string", valueType: "string" };
}

export function buildDefaultInputValue(type: string): ContractAbiValue {
  const kind = normalizeType(type);
  if (kind === "bool") return false;
  if (kind === "number") return 0;
  if (kind === "option") return null;
  if (kind === "vec") return [];
  if (kind === "map" || kind === "struct") return {};
  if (kind === "stroops") return "0";
  return "";
}

/**
 * Strongly typed validation for Soroban parameters
 */
export function validateSorobanType(
  name: string,
  type: string,
  value: unknown
): string | null {
  const kind = normalizeType(type);

  // Optional types can be null, undefined, or empty string
  if (kind === "option") {
    if (value === undefined || value === null || value === "") {
      return null; // Valid None
    }
    const inner = extractInnerType(type);
    return validateSorobanType(name, inner, value);
  }

  if (value === undefined || value === null || value === "") {
    return `Field '${name}' (${type}) is required.`;
  }

  if (kind === "address") {
    const str = String(value).trim();
    if (!STELLAR_ADDRESS_REGEX.test(str)) {
      return `Field '${name}' must be a valid Stellar Address (G... or C..., 56 chars).`;
    }
  }

  if (kind === "symbol") {
    const str = String(value).trim();
    if (!SOROBAN_SYMBOL_REGEX.test(str)) {
      return `Field '${name}' must be a valid Soroban Symbol (max 32 alphanumeric/underscore chars).`;
    }
  }

  if (kind === "bytes") {
    const str = String(value).trim();
    if (!HEX_BYTES_REGEX.test(str)) {
      return `Field '${name}' must be valid hexadecimal bytes (optional 0x prefix).`;
    }
    const cleanHex = str.startsWith("0x") ? str.slice(2) : str;
    if (cleanHex.length % 2 !== 0) {
      return `Field '${name}' hex bytes must have an even length.`;
    }
  }

  if (kind === "stroops") {
    const str = String(value).trim();
    if (!/^\d+$/.test(str) || BigInt(str) < BigInt(0)) {
      return `Field '${name}' must be a positive integer amount in Stroops.`;
    }
  }

  if (kind === "u128") {
    const str = String(value).trim();
    if (!/^-?\d+$/.test(str)) {
      return `Field '${name}' must be a valid 128-bit integer string or number.`;
    }
    const num = BigInt(str);
    if (
      num < BigInt("-170141183460469231731687303715884105728") ||
      num > BigInt("340282366920938463463374607431768211455")
    ) {
      return `Field '${name}' is out of range for a 128-bit integer.`;
    }
  }

  if (kind === "number") {
    if (value === "" || value === null || value === undefined) {
      return `Field '${name}' (${type}) is required.`;
    }
    if (Number.isNaN(Number(value))) {
      return `Field '${name}' must be a valid numeric value.`;
    }
  }

  if (kind === "vec") {
    if (Array.isArray(value)) {
      const inner = extractInnerType(type);
      for (let idx = 0; idx < value.length; idx++) {
        const itemErr = validateSorobanType(`${name}[${idx}]`, inner, value[idx]);
        if (itemErr) return itemErr;
      }
    } else if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        if (!Array.isArray(parsed)) {
          return `Field '${name}' must be a valid JSON array for Vec.`;
        }
      } catch {
        return `Field '${name}' must be a valid JSON array for Vec.`;
      }
    }
  }

  if (kind === "map") {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const { keyType, valueType } = extractMapTypes(type);
      for (const [k, v] of Object.entries(value)) {
        const kErr = validateSorobanType(`${name}.key(${k})`, keyType, k);
        if (kErr) return kErr;
        const vErr = validateSorobanType(`${name}[${k}]`, valueType, v);
        if (vErr) return vErr;
      }
    } else if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          return `Field '${name}' must be a valid JSON object for Map.`;
        }
      } catch {
        return `Field '${name}' must be a valid JSON object for Map.`;
      }
    }
  }

  return null;
}

/**
 * Serializes standard Soroban values into ScVal JSON structures
 */
export function serializeValueToScVal(type: string, value: unknown): Record<string, unknown> {
  const kind = normalizeType(type);

  if (kind === "option") {
    if (value === null || value === undefined || value === "") {
      return { type: "void" };
    }
    const inner = extractInnerType(type);
    return serializeValueToScVal(inner, value);
  }

  if (kind === "bool") {
    return { type: "bool", value: Boolean(value) };
  }

  if (kind === "number") {
    return { type: "u32", value: Number(value) || 0 };
  }

  if (kind === "address") {
    return { type: "address", value: String(value).trim() };
  }

  if (kind === "symbol") {
    return { type: "symbol", value: String(value).trim() };
  }

  if (kind === "stroops" || kind === "u128") {
    return { type: "i128", value: String(value).trim() };
  }

  if (kind === "bytes") {
    const raw = String(value).trim();
    const cleanHex = raw.startsWith("0x") ? raw.slice(2) : raw;
    return { type: "bytes", value: cleanHex };
  }

  if (kind === "vec") {
    const items = Array.isArray(value) ? value : [];
    const inner = extractInnerType(type);
    return {
      type: "vec",
      value: items.map((item) => serializeValueToScVal(inner, item)),
    };
  }

  if (kind === "map") {
    const mapObj = typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
    const { keyType, valueType } = extractMapTypes(type);
    const entries = Object.entries(mapObj).map(([k, v]) => ({
      key: serializeValueToScVal(keyType, k),
      val: serializeValueToScVal(valueType, v),
    }));
    return { type: "map", value: entries };
  }

  return { type: "string", value: String(value ?? "") };
}

function splitTopLevelParams(paramsBlock: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;

  for (let i = 0; i < paramsBlock.length; i++) {
    const char = paramsBlock[i];
    if (char === "<" || char === "(" || char === "[") {
      depth++;
      current += char;
    } else if (char === ">" || char === ")" || char === "]") {
      depth = Math.max(0, depth - 1);
      current += char;
    } else if (char === "," && depth === 0) {
      if (current.trim()) {
        parts.push(current.trim());
      }
      current = "";
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function parseParamList(paramsBlock: string): ContractAbiFunctionInput[] {
  if (!paramsBlock.trim()) return [];

  return splitTopLevelParams(paramsBlock)
    .filter(Boolean)
    .filter((part) => !RUST_SELF_PARAM.test(part))
    .map((part) => {
      const colonIdx = part.indexOf(":");
      if (colonIdx === -1) return null;

      const rawName = part.slice(0, colonIdx).trim();
      const rawType = part.slice(colonIdx + 1).trim();

      if (!rawName || !rawType || rawName.startsWith("_") || IGNORED_PARAM_NAMES.has(rawName)) {
        return null;
      }

      const cleanType = stripLifetimeAnnotations(rawType).replace(/\s+/g, "");
      const isOptional = normalizeType(cleanType) === "option";

      return {
        name: rawName.replace(/^&/, "").replace(/\s+/g, ""),
        type: cleanType,
        isOptional,
        innerType: isOptional ? extractInnerType(cleanType) : undefined,
      };
    })
    .filter(Boolean) as ContractAbiFunctionInput[];
}

export function parseContractAbiFromSource(source: string): ContractAbiFunction[] {
  const lines = source.split("\n");
  const functions: ContractAbiFunction[] = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/pub\s+fn\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/);
    if (!match) continue;

    const [, name, paramsBlock] = match;
    if (!name) continue;

    let doc: string | undefined;
    for (let j = i - 1; j >= 0; j--) {
      const docMatch = lines[j].match(/\/\/\/\s*(.*)/);
      if (docMatch) {
        doc = docMatch[1].trim();
        break;
      }
      if (lines[j].trim() && !lines[j].trim().startsWith("#")) break;
    }

    const inputs = parseParamList(paramsBlock);
    functions.push({ name, inputs, ...(doc ? { doc } : {}) });
  }

  return functions;
}

export function validateAbiArguments(
  abiFunction: ContractAbiFunction | null | undefined,
  values: Record<string, unknown>
): string {
  if (!abiFunction) return "";

  for (const input of abiFunction.inputs ?? []) {
    const error = validateSorobanType(input.name, input.type, values[input.name]);
    if (error) return error;
  }

  return "";
}

export function buildAbiArguments(
  abiFunction: ContractAbiFunction | null | undefined,
  values: Record<string, unknown>
): Record<string, unknown> {
  if (!abiFunction) return {};

  return (abiFunction.inputs ?? []).reduce<Record<string, unknown>>((args, input) => {
    const rawValue = values[input.name];
    const kind = normalizeType(input.type);

    if (kind === "option") {
      args[input.name] = rawValue === undefined || rawValue === null || rawValue === "" ? null : rawValue;
    } else if (kind === "bool") {
      args[input.name] = Boolean(rawValue);
    } else if (kind === "number") {
      args[input.name] = rawValue === "" || rawValue === undefined || rawValue === null ? 0 : Number(rawValue);
    } else if (kind === "vec" && typeof rawValue === "string") {
      try {
        args[input.name] = JSON.parse(rawValue);
      } catch {
        args[input.name] = [];
      }
    } else {
      args[input.name] = rawValue === undefined || rawValue === null ? "" : rawValue;
    }

    return args;
  }, {});
}
