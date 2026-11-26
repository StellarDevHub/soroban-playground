import { xdr, scValToNative } from "@stellar/stellar-sdk";

export type XdrType =
  | "Auto"
  | "ScVal"
  | "TransactionEnvelope"
  | "LedgerEntryData"
  | "DiagnosticEvent"
  | "ContractEvent"
  | "LedgerKey"
  | "TransactionResult";

export interface HexByte {
  offset: number;
  hex: string;
  ascii: string;
}

export interface HexDumpRow {
  offset: number;
  offsetHex: string;
  bytes: HexByte[];
  ascii: string;
}

export interface AstNode {
  id: string;
  key: string;
  label?: string;
  value?: any;
  type: string;
  typeTooltip?: string;
  byteRange?: [number, number];
  children?: AstNode[];
}

export interface DecodeResult {
  type: string;
  nativeValue: any;
  rawXdrObject: any;
  jsonString: string;
  rawBytes: Uint8Array;
  hexRows: HexDumpRow[];
  astRoot?: AstNode;
  error?: string;
}

export function parseBase64ToBytes(base64Str: string): Uint8Array {
  const clean = base64Str.trim().replace(/\s+/g, "");
  if (!clean) return new Uint8Array(0);

  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(clean, "base64"));
  }
  const binaryString = atob(clean);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export function generateHexDumpRows(bytes: Uint8Array): HexDumpRow[] {
  const rows: HexDumpRow[] = [];
  const chunkSize = 16;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.slice(offset, offset + chunkSize);
    const hexBytes: HexByte[] = [];
    let asciiChars = "";

    for (let i = 0; i < chunk.length; i++) {
      const byteVal = chunk[i];
      const byteOffset = offset + i;
      const hex = byteVal.toString(16).padStart(2, "0").toUpperCase();
      const ascii = byteVal >= 32 && byteVal <= 126 ? String.fromCharCode(byteVal) : ".";
      hexBytes.push({ offset: byteOffset, hex, ascii });
      asciiChars += ascii;
    }

    const offsetHex = offset.toString(16).padStart(8, "0").toUpperCase();
    rows.push({
      offset,
      offsetHex,
      bytes: hexBytes,
      ascii: asciiChars,
    });
  }

  return rows;
}

export function buildAstFromJson(
  data: any,
  key = "root",
  path = "root",
  totalBytes = 0,
): AstNode {
  let inferredType = typeof data;
  if (data === null) inferredType = "null";
  else if (Array.isArray(data)) inferredType = "array";
  else if (typeof data === "bigint") inferredType = "i128 / u64";
  else if (typeof data === "number") inferredType = "i32 / u32";
  else if (typeof data === "boolean") inferredType = "bool";

  // Type annotations and tooltips
  let typeTooltip = `Type: ${inferredType}`;
  if (key.toLowerCase().includes("contractid")) {
    typeTooltip = "Stellar 32-byte Contract Identifier Address";
  } else if (key.toLowerCase().includes("scval")) {
    typeTooltip = "Soroban Smart Contract Value";
  } else if (key.toLowerCase().includes("hash")) {
    typeTooltip = "Cryptographic 32-byte SHA-256 Hash";
  }

  // Calculate approximate byte range for AST visualization
  const hashVal = Math.abs(
    path.split("").reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) | 0, 0),
  );
  const startByte = totalBytes > 0 ? (hashVal * 4) % Math.max(1, totalBytes - 4) : 0;
  const endByte = Math.min(totalBytes, startByte + 4);

  if (data !== null && typeof data === "object") {
    if (Array.isArray(data)) {
      const children: AstNode[] = data.map((item, idx) =>
        buildAstFromJson(item, `[${idx}]`, `${path}[${idx}]`, totalBytes),
      );
      return {
        id: path,
        key,
        type: `Array(${data.length})`,
        typeTooltip: `List of ${data.length} element(s)`,
        byteRange: [startByte, endByte],
        children,
      };
    }

    const keys = Object.keys(data);
    const children: AstNode[] = keys.map((k) =>
      buildAstFromJson(data[k], k, `${path}.${k}`, totalBytes),
    );
    return {
      id: path,
      key,
      type: "Object",
      typeTooltip: `Struct / Container with ${keys.length} fields`,
      byteRange: [startByte, endByte],
      children,
    };
  }

  return {
    id: path,
    key,
    value: data,
    type: inferredType,
    typeTooltip,
    byteRange: [startByte, endByte],
  };
}

export function decodeXdrPayload(
  inputStr: string,
  targetType: XdrType = "Auto",
): DecodeResult {
  const cleanInput = inputStr.trim().replace(/\s+/g, "");
  if (!cleanInput) {
    return {
      type: "Empty",
      nativeValue: null,
      rawXdrObject: null,
      jsonString: "",
      rawBytes: new Uint8Array(0),
      hexRows: [],
    };
  }

  let rawBytes: Uint8Array = new Uint8Array(0);
  try {
    rawBytes = parseBase64ToBytes(cleanInput);
  } catch {
    // Ignore error, will fail decoding below
  }
  const hexRows = generateHexDumpRows(rawBytes);

  const typesToTry: Exclude<XdrType, "Auto">[] =
    targetType === "Auto"
      ? [
          "TransactionEnvelope",
          "ScVal",
          "LedgerEntryData",
          "DiagnosticEvent",
          "ContractEvent",
          "LedgerKey",
          "TransactionResult",
        ]
      : [targetType];

  for (const t of typesToTry) {
    try {
      let decodedObj: any = null;
      let nativeVal: any = null;

      switch (t) {
        case "ScVal": {
          const scval = xdr.ScVal.fromXDR(cleanInput, "base64");
          decodedObj = scval;
          try {
            nativeVal = scValToNative(scval);
          } catch {
            nativeVal = { arm: scval.switch().name, raw: scval.toJSON() };
          }
          break;
        }
        case "TransactionEnvelope": {
          decodedObj = xdr.TransactionEnvelope.fromXDR(cleanInput, "base64");
          nativeVal = decodedObj.toJSON();
          break;
        }
        case "LedgerEntryData": {
          decodedObj = xdr.LedgerEntryData.fromXDR(cleanInput, "base64");
          nativeVal = decodedObj.toJSON();
          break;
        }
        case "DiagnosticEvent": {
          decodedObj = xdr.DiagnosticEvent.fromXDR(cleanInput, "base64");
          nativeVal = {
            inSuccessfulContractCall: decodedObj.inSuccessfulContractCall(),
            event: decodedObj.event().toJSON(),
          };
          break;
        }
        case "ContractEvent": {
          decodedObj = xdr.ContractEvent.fromXDR(cleanInput, "base64");
          nativeVal = decodedObj.toJSON();
          break;
        }
        case "LedgerKey": {
          decodedObj = xdr.LedgerKey.fromXDR(cleanInput, "base64");
          nativeVal = decodedObj.toJSON();
          break;
        }
        case "TransactionResult": {
          decodedObj = xdr.TransactionResult.fromXDR(cleanInput, "base64");
          nativeVal = decodedObj.toJSON();
          break;
        }
      }

      const jsonString = JSON.stringify(
        nativeVal,
        (_key, val) => {
          if (typeof val === "bigint") return val.toString();
          if (val instanceof Uint8Array || (typeof Buffer !== "undefined" && Buffer.isBuffer(val))) {
            return Buffer.from(val).toString("hex");
          }
          return val;
        },
        2,
      );

      const astRoot = buildAstFromJson(nativeVal, "root", "root", rawBytes.length);

      return {
        type: t,
        nativeValue: nativeVal,
        rawXdrObject: decodedObj,
        jsonString,
        rawBytes,
        hexRows,
        astRoot,
      };
    } catch {
      // Continue to next type if Auto
    }
  }

  return {
    type: "Unknown",
    nativeValue: null,
    rawXdrObject: null,
    jsonString: "",
    rawBytes,
    hexRows,
    error: "Failed to decode base64 XDR string. Please verify input and selected type.",
  };
}
