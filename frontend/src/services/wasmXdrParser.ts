import { xdr, cereal, contract, scValToNative } from '@stellar/stellar-sdk';
import type { DecodedStorageValue } from '@/types/storageBrowser';

export interface XdrSpecEntry {
  kind: 'function' | 'udtStruct' | 'udtEnum' | 'udtUnion';
  name: string;
  inputs?: { name: string; type: XdrTypeSpec; doc?: string }[];
  outputs?: XdrTypeSpec[];
  doc?: string;
  fields?: { name: string; type: XdrTypeSpec; doc?: string }[];
  cases?: { name: string; value?: number; type?: XdrTypeSpec; doc?: string }[];
}

export type XdrTypeSpec =
  | { type: 'u32' | 'i32' | 'u64' | 'i64' | 'u128' | 'i128' | 'bool' | 'address' | 'string' | 'bytes' | 'symbol' | 'void' }
  | { type: 'vec'; element: XdrTypeSpec }
  | { type: 'option'; value: XdrTypeSpec }
  | { type: 'tuple'; elements: XdrTypeSpec[] }
  | { type: 'map'; key: XdrTypeSpec; value: XdrTypeSpec }
  | { type: 'udt'; name: string };

/**
 * Reads an unsigned LEB128 integer from a byte array.
 */
function readVarUint(bytes: Uint8Array, offset: number): { val: number; len: number } {
  let val = 0;
  let shift = 0;
  let len = 0;
  while (offset + len < bytes.length) {
    const byte = bytes[offset + len];
    len++;
    val |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return { val, len };
}

/**
 * Extracts custom sections from WASM bytes.
 */
export function extractWasmCustomSections(wasmBuffer: Buffer | Uint8Array): Map<string, Uint8Array> {
  const bytes = wasmBuffer instanceof Uint8Array ? wasmBuffer : new Uint8Array(wasmBuffer);
  const sections = new Map<string, Uint8Array>();

  if (bytes.length < 8) return sections;
  // WASM magic bytes: \0asm (0x00, 0x61, 0x73, 0x6d)
  if (bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
    return sections;
  }

  let offset = 8;
  const decoder = new TextDecoder('utf-8');

  while (offset < bytes.length) {
    if (offset >= bytes.length) break;
    const sectionId = bytes[offset++];
    const sectionLenInfo = readVarUint(bytes, offset);
    offset += sectionLenInfo.len;
    const sectionLen = sectionLenInfo.val;
    const sectionEnd = offset + sectionLen;

    if (sectionId === 0 && sectionEnd <= bytes.length) {
      // Custom section
      const nameLenInfo = readVarUint(bytes, offset);
      const nameLen = nameLenInfo.val;
      const nameOffset = offset + nameLenInfo.len;
      const name = decoder.decode(bytes.subarray(nameOffset, nameOffset + nameLen));
      const dataOffset = nameOffset + nameLen;
      const data = bytes.subarray(dataOffset, sectionEnd);
      sections.set(name, data);
    }

    offset = sectionEnd;
  }

  return sections;
}

/**
 * Converts Stellar SDK ScSpecTypeDef to XdrTypeSpec.
 */
export function specTypeDefToTypeSpec(typeDef: xdr.ScSpecTypeDef): XdrTypeSpec {
  switch (typeDef.switch().name) {
    case 'scSpecTypeBool':
      return { type: 'bool' };
    case 'scSpecTypeU32':
      return { type: 'u32' };
    case 'scSpecTypeI32':
      return { type: 'i32' };
    case 'scSpecTypeU64':
      return { type: 'u64' };
    case 'scSpecTypeI64':
      return { type: 'i64' };
    case 'scSpecTypeU128':
      return { type: 'u128' };
    case 'scSpecTypeI128':
      return { type: 'i128' };
    case 'scSpecTypeAddress':
      return { type: 'address' };
    case 'scSpecTypeString':
      return { type: 'string' };
    case 'scSpecTypeSymbol':
      return { type: 'symbol' };
    case 'scSpecTypeBytes':
    case 'scSpecTypeBytesN':
      return { type: 'bytes' };
    case 'scSpecTypeVoid':
      return { type: 'void' };
    case 'scSpecTypeVec':
      return { type: 'vec', element: specTypeDefToTypeSpec(typeDef.vec().elementType()) };
    case 'scSpecTypeOption':
      return { type: 'option', value: specTypeDefToTypeSpec(typeDef.option().valueType()) };
    case 'scSpecTypeTuple':
      return {
        type: 'tuple',
        elements: typeDef.tuple().valueTypes().map(specTypeDefToTypeSpec)
      };
    case 'scSpecTypeMap':
      return {
        type: 'map',
        key: specTypeDefToTypeSpec(typeDef.map().keyType()),
        value: specTypeDefToTypeSpec(typeDef.map().valueType())
      };
    case 'scSpecTypeUdt':
      return { type: 'udt', name: typeDef.udt().name().toString() };
    default:
      return { type: 'string' };
  }
}

/**
 * Converts a raw xdr.ScSpecEntry into structured XdrSpecEntry.
 */
export function convertScSpecEntry(entry: xdr.ScSpecEntry): XdrSpecEntry {
  const kind = entry.switch().name;

  if (kind === 'scSpecEntryFunctionV0') {
    const fn = entry.functionV0();
    return {
      kind: 'function',
      name: fn.name().toString(),
      doc: fn.doc().toString(),
      inputs: fn.inputs().map((inp) => ({
        name: inp.name().toString(),
        type: specTypeDefToTypeSpec(inp.type()),
        doc: inp.doc().toString()
      })),
      outputs: fn.outputs().map(specTypeDefToTypeSpec)
    };
  }

  if (kind === 'scSpecEntryUdtStructV0') {
    const st = entry.udtStructV0();
    return {
      kind: 'udtStruct',
      name: st.name().toString(),
      doc: st.doc().toString(),
      fields: st.fields().map((f) => ({
        name: f.name().toString(),
        type: specTypeDefToTypeSpec(f.type()),
        doc: f.doc().toString()
      }))
    };
  }

  if (kind === 'scSpecEntryUdtEnumV0') {
    const en = entry.udtEnumV0();
    return {
      kind: 'udtEnum',
      name: en.name().toString(),
      doc: en.doc().toString(),
      cases: en.cases().map((c) => ({
        name: c.name().toString(),
        value: c.value(),
        doc: c.doc().toString()
      }))
    };
  }

  if (kind === 'scSpecEntryUdtUnionV0') {
    const un = entry.udtUnionV0();
    return {
      kind: 'udtUnion',
      name: un.name().toString(),
      doc: un.doc().toString(),
      cases: un.cases().map((c) => {
        const cKind = c.switch().name;
        if (cKind === 'scSpecUdtUnionCaseVoidV0') {
          return {
            name: c.voidCase().name().toString(),
            doc: c.voidCase().doc().toString()
          };
        }
        return {
          name: c.tupleCase().name().toString(),
          doc: c.tupleCase().doc().toString()
        };
      })
    };
  }

  return {
    kind: 'function',
    name: 'unknown'
  };
}

/**
 * Parses raw contractspecv0 bytes from buffer into ScSpecEntry array.
 */
export function parseScSpecEntriesFromBuffer(buffer: Uint8Array | Buffer): xdr.ScSpecEntry[] {
  const entries: xdr.ScSpecEntry[] = [];
  try {
    const reader = new (cereal as any).XdrReader(buffer);
    while (!reader.eof()) {
      const entry = xdr.ScSpecEntry.read(reader);
      entries.push(entry);
    }
  } catch (err) {
    console.warn('Failed streaming ScSpecEntries from buffer:', err);
  }
  return entries;
}

/**
 * Parses contractspecv0 entries from compiled contract WASM bytes.
 */
export function parseWasmContractSpec(wasmBuffer: Buffer | Uint8Array): XdrSpecEntry[] {
  try {
    const customSections = extractWasmCustomSections(wasmBuffer);
    const contractSpecBytes = customSections.get('contractspecv0');

    if (contractSpecBytes && contractSpecBytes.length > 0) {
      const rawEntries = parseScSpecEntriesFromBuffer(contractSpecBytes);
      if (rawEntries.length > 0) {
        return rawEntries.map(convertScSpecEntry);
      }
    }

    // Default fallback specs for preview/development when WASM has no embedded spec
    const entries: XdrSpecEntry[] = [
      {
        kind: 'function',
        name: 'initialize',
        inputs: [
          { name: 'admin', type: { type: 'address' } },
          { name: 'config_flags', type: { type: 'vec', element: { type: 'bool' } } }
        ],
        outputs: [],
        doc: 'Initializes the contract with an admin and flags.'
      },
      {
        kind: 'function',
        name: 'submit_proposal',
        inputs: [
          { name: 'title', type: { type: 'string' } },
          { name: 'tags', type: { type: 'vec', element: { type: 'symbol' } } },
          { name: 'metadata', type: { type: 'tuple', elements: [{ type: 'u64' }, { type: 'bool' }] } }
        ],
        outputs: [{ type: 'u32' }],
        doc: 'Submits a new governance proposal.'
      },
      {
        kind: 'udtStruct',
        name: 'AllowanceKey',
        fields: [
          { name: 'from', type: { type: 'address' }, doc: 'Token owner address' },
          { name: 'spender', type: { type: 'address' }, doc: 'Authorized spender address' }
        ],
        doc: 'Key identifying an allowance between two accounts'
      },
      {
        kind: 'udtStruct',
        name: 'AllowanceData',
        fields: [
          { name: 'amount', type: { type: 'i128' }, doc: 'Remaining authorized allowance' },
          { name: 'expiration_ledger', type: { type: 'u32' }, doc: 'Ledger sequence of expiration' }
        ],
        doc: 'Record storing active allowance details'
      },
      {
        kind: 'udtEnum',
        name: 'ContractState',
        cases: [
          { name: 'Pending', value: 0, doc: 'Contract initialized but inactive' },
          { name: 'Active', value: 1, doc: 'Contract fully operational' },
          { name: 'Paused', value: 2, doc: 'Contract temporarily halted' },
          { name: 'Archived', value: 3, doc: 'Contract archived' }
        ],
        doc: 'Operational state of the contract'
      },
      {
        kind: 'udtUnion',
        name: 'DataKey',
        cases: [
          { name: 'Admin', doc: 'Contract administrator address' },
          { name: 'Counter', doc: 'Global operation counter' },
          { name: 'State', doc: 'Contract operational status' },
          { name: 'Allowance', doc: 'Token allowance mapping' }
        ],
        doc: 'Contract storage key variants'
      }
    ];
    return entries;
  } catch (err) {
    console.error('Failed to parse WASM contract spec:', err);
    return [];
  }
}

/**
 * Safe stringifier for values containing BigInt or Buffer.
 */
export function safeNativeStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value, (_key, val) => {
    if (typeof val === 'bigint') return val.toString();
    if (val instanceof Uint8Array || Buffer.isBuffer(val)) {
      return `0x${Buffer.from(val).toString('hex')}`;
    }
    return val;
  }, 2);
}

/**
 * Decodes an ScVal using contract ABI metadata with support for complex structs and enums.
 */
export function decodeScValWithAbi(
  scValOrBase64: xdr.ScVal | string,
  specEntries?: XdrSpecEntry[] | null,
  typeHint?: string
): DecodedStorageValue {
  let scVal: xdr.ScVal;
  let rawXdr = '';

  if (typeof scValOrBase64 === 'string') {
    rawXdr = scValOrBase64.trim();
    try {
      scVal = xdr.ScVal.fromXDR(rawXdr, 'base64');
    } catch {
      // Fallback for plain non-XDR strings
      return {
        type: 'string',
        displayValue: scValOrBase64,
        nativeValue: scValOrBase64,
        rawXdr: scValOrBase64
      };
    }
  } else {
    scVal = scValOrBase64;
    try {
      rawXdr = scVal.toXDR('base64');
    } catch {
      rawXdr = '';
    }
  }

  const armName = scVal.switch().name;

  // 1. Check for Complex Struct (encoded as scvMap with symbol keys or scvVec)
  if (armName === 'scvMap') {
    const mapEntries = scVal.map() ?? [];
    const fieldsRecord: Record<string, unknown> = {};
    const fieldDetails: Array<{ name: string; type: string; value: unknown }> = [];

    for (const entry of mapEntries) {
      let fieldKey = 'unknown';
      try {
        const nativeKey = scValToNative(entry.key());
        fieldKey = String(nativeKey);
      } catch {
        fieldKey = 'field';
      }

      const decodedVal = decodeScValWithAbi(entry.val(), specEntries);
      fieldsRecord[fieldKey] = decodedVal.nativeValue;
      fieldDetails.push({
        name: fieldKey,
        type: decodedVal.type,
        value: decodedVal.nativeValue
      });
    }

    // Attempt to match against struct specifications
    let matchedStructName = typeHint;
    if (!matchedStructName && specEntries) {
      const keys = Object.keys(fieldsRecord);
      const structSpec = specEntries.find(
        (s) =>
          s.kind === 'udtStruct' &&
          s.fields &&
          s.fields.some((f) => keys.includes(f.name))
      );
      if (structSpec) {
        matchedStructName = structSpec.name;
      }
    }

    const typeLabel = matchedStructName ? `Struct(${matchedStructName})` : 'Struct';
    return {
      type: typeLabel,
      typeName: matchedStructName,
      isUdt: Boolean(matchedStructName),
      displayValue: safeNativeStringify(fieldsRecord),
      nativeValue: fieldsRecord,
      rawXdr,
      structFields: fieldDetails
    };
  }

  // 2. Check for Tagged Union / Enum with payload (scvVec starting with symbol tag)
  if (armName === 'scvVec') {
    const vecItems = scVal.vec() ?? [];
    if (vecItems.length > 0 && vecItems[0].switch().name === 'scvSymbol') {
      const tag = vecItems[0].sym().toString();
      const payloadValues = vecItems.slice(1).map((item) => decodeScValWithAbi(item, specEntries).nativeValue);

      let matchedUnionName = typeHint;
      if (!matchedUnionName && specEntries) {
        const unionSpec = specEntries.find(
          (u) =>
            u.kind === 'udtUnion' &&
            u.cases &&
            u.cases.some((c) => c.name === tag)
        );
        if (unionSpec) {
          matchedUnionName = unionSpec.name;
        }
      }

      const unionLabel = matchedUnionName ? `Union(${matchedUnionName}::${tag})` : `Union(${tag})`;
      const display =
        payloadValues.length > 0
          ? `${tag}(${payloadValues.map((v) => safeNativeStringify(v)).join(', ')})`
          : tag;

      return {
        type: unionLabel,
        typeName: matchedUnionName,
        isUdt: true,
        displayValue: display,
        nativeValue: { tag, values: payloadValues },
        rawXdr,
        enumVariant: { name: tag, tag }
      };
    }

    // Generic Vec
    const decodedItems = vecItems.map((item) => decodeScValWithAbi(item, specEntries).nativeValue);
    return {
      type: 'Vec',
      displayValue: safeNativeStringify(decodedItems),
      nativeValue: decodedItems,
      rawXdr
    };
  }

  // 3. Check for Enum (scvU32 or scvSymbol)
  if (armName === 'scvU32') {
    const num = scVal.u32();
    let matchedEnum = typeHint ? specEntries?.find((e) => e.name === typeHint) : null;
    if (!matchedEnum && specEntries) {
      matchedEnum = specEntries.find(
        (e) => e.kind === 'udtEnum' && e.cases && e.cases.some((c) => c.value === num)
      );
    }

    if (matchedEnum && matchedEnum.cases) {
      const matchedCase = matchedEnum.cases.find((c) => c.value === num);
      if (matchedCase) {
        return {
          type: `Enum(${matchedEnum.name})`,
          typeName: matchedEnum.name,
          isUdt: true,
          displayValue: `${matchedCase.name} (${num})`,
          nativeValue: num,
          rawXdr,
          enumVariant: { name: matchedCase.name, value: num }
        };
      }
    }

    return {
      type: 'u32',
      displayValue: String(num),
      nativeValue: num,
      rawXdr
    };
  }

  if (armName === 'scvSymbol') {
    const sym = scVal.sym().toString();
    if (specEntries) {
      const enumSpec = specEntries.find(
        (e) => e.kind === 'udtEnum' && e.cases && e.cases.some((c) => c.name === sym)
      );
      if (enumSpec) {
        const matchedCase = enumSpec.cases?.find((c) => c.name === sym);
        return {
          type: `Enum(${enumSpec.name})`,
          typeName: enumSpec.name,
          isUdt: true,
          displayValue: sym,
          nativeValue: sym,
          rawXdr,
          enumVariant: { name: sym, value: matchedCase?.value }
        };
      }
    }

    return {
      type: 'symbol',
      displayValue: sym,
      nativeValue: sym,
      rawXdr
    };
  }

  // 4. Default / Primitive fallback via scValToNative
  try {
    const native = scValToNative(scVal);
    let typeName = armName.replace(/^scv/, '').toLowerCase();
    if (armName === 'scvAddress') typeName = 'address';
    if (armName === 'scvI128' || armName === 'scvU128') typeName = 'i128';
    if (armName === 'scvI64' || armName === 'scvU64') typeName = 'i64';
    if (armName === 'scvBool') typeName = 'bool';

    return {
      type: typeName,
      displayValue: safeNativeStringify(native),
      nativeValue: native,
      rawXdr
    };
  } catch {
    return {
      type: armName,
      displayValue: rawXdr,
      nativeValue: rawXdr,
      rawXdr
    };
  }
}
