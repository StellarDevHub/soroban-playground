export interface ContractAbiFunctionInput {
  name: string;
  type: string;
}

export interface ContractAbiFunction {
  name: string;
  inputs?: ContractAbiFunctionInput[];
}

export type ContractAbiValue = string | number | boolean | null | undefined;

const RUST_TYPE_ALIASES: Record<string, string> = {
  symbol: "string",
  env: "string",
  address: "string",
  bytes: "string",
  string: "string",
  bool: "bool",
  u8: "number",
  u16: "number",
  u32: "number",
  u64: "number",
  u128: "number",
  i8: "number",
  i16: "number",
  i32: "number",
  i64: "number",
  i128: "number",
  f32: "number",
  f64: "number",
};

function normalizeType(type: string) {
  const normalized = type.trim().toLowerCase();

  if (RUST_TYPE_ALIASES[normalized]) {
    return RUST_TYPE_ALIASES[normalized];
  }

  if (normalized.startsWith("vec<") || normalized.startsWith("vector<") || normalized.startsWith("map<") || normalized.startsWith("option<") || normalized.startsWith("result<") || normalized.startsWith("tuple<") || normalized.startsWith("struct<")) return "string";

  return normalized.includes("[") || normalized.includes("<") ? "string" : "string";
}

export function buildDefaultInputValue(type: string): ContractAbiValue {
  return normalizeType(type) === "bool" ? false : "";
}

export function parseContractAbiFromSource(source: string): ContractAbiFunction[] {
  const functionMatches = source.matchAll(/pub\s+fn\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/g);
  const functions: ContractAbiFunction[] = [];

  for (const match of functionMatches) {
    const [, name, paramsBlock] = match;
    const inputs = paramsBlock
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [rawName, rawType] = part.split(":").map((value) => value.trim());
        if (!rawName || !rawType || rawName.startsWith("_")) {
          return null;
        }

        return {
          name: rawName.replace(/^&/, "").replace(/\s+/g, ""),
          type: rawType.replace(/\s+/g, ""),
        };
      })
      .filter(Boolean) as ContractAbiFunctionInput[];

    if (!name) {
      continue;
    }

    functions.push({ name, inputs });
  }

  return functions;
}

export function validateAbiArguments(
  abiFunction: ContractAbiFunction | null | undefined,
  values: Record<string, unknown>,
): string {
  if (!abiFunction) {
    return "";
  }

  for (const input of abiFunction.inputs ?? []) {
    const rawValue = values[input.name];
    const kind = normalizeType(input.type);

    if (kind === "number") {
      if (rawValue === undefined || rawValue === null || rawValue === "") {
        return `Field ${input.name} is required.`;
      }

      if (Number.isNaN(Number(rawValue))) {
        return `Field ${input.name} must be a valid number.`;
      }

      continue;
    }

    if (kind === "bool") {
      continue;
    }

    if (rawValue === undefined || rawValue === null || String(rawValue).trim() === "") {
      return `Field ${input.name} is required.`;
    }
  }

  return "";
}

export function buildAbiArguments(
  abiFunction: ContractAbiFunction | null | undefined,
  values: Record<string, unknown>,
): Record<string, unknown> {
  if (!abiFunction) {
    return {};
  }

  return (abiFunction.inputs ?? []).reduce<Record<string, unknown>>((args, input) => {
    const rawValue = values[input.name];
    const kind = normalizeType(input.type);

    if (kind === "bool") {
      args[input.name] = Boolean(rawValue);
    } else if (kind === "number") {
      args[input.name] = rawValue === "" || rawValue === undefined || rawValue === null
        ? ""
        : Number(rawValue);
    } else {
      args[input.name] = rawValue === undefined || rawValue === null ? "" : rawValue;
    }

    return args;
  }, {});
}
