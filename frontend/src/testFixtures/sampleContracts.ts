export function leb(value: number): number[] {
  const out: number[] = [];
  let remaining = value >>> 0;
  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining !== 0) byte |= 0x80;
    out.push(byte);
  } while (remaining !== 0);
  return out;
}

export function customSection(name: string, payload: number[]): number[] {
  const nameBytes = Array.from(new TextEncoder().encode(name));
  const nameLength = leb(nameBytes.length);
  const body = [
    ...leb(nameLength.length + nameBytes.length + payload.length),
    ...nameLength,
    ...nameBytes,
    ...payload,
  ];
  return [0x00, ...body];
}

interface SampleContractOptions {
  functionCount?: number;
  debugNameBytes?: number;
  dwarfBytes?: number;
  producersBytes?: number;
  identifiers?: string[];
}

function specPayload(identifiers: string[]): number[] {
  const out: number[] = [];
  for (const identifier of identifiers) {
    const bytes = Array.from(new TextEncoder().encode(identifier));
    out.push(0, 0, 0, bytes.length, ...bytes);
  }
  return out;
}

function validNameSection(functionCount: number, targetBytes: number): number[] {
  const pattern = "contract_function_with_a_deliberately_long_symbol_name_";
  const targetLength = Math.max(16, Math.floor(targetBytes / Math.max(1, functionCount)) - 8);
  let name = "";
  while (name.length < targetLength) name += pattern;
  const nameBytes = Array.from(new TextEncoder().encode(name.slice(0, targetLength)));
  const entries: number[] = [];
  for (let index = 0; index < functionCount; index += 1) {
    entries.push(...leb(index), ...leb(nameBytes.length), ...nameBytes);
  }
  const subsectionPayload = [...leb(functionCount), ...entries];
  const subsection = [0x01, ...leb(subsectionPayload.length), ...subsectionPayload];
  return customSection("name", subsection);
}

export function buildSampleContract(options: SampleContractOptions = {}): Uint8Array {
  const functionCount = options.functionCount ?? 12;
  const debugNameBytes = options.debugNameBytes ?? 6000;
  const dwarfBytes = options.dwarfBytes ?? 4000;
  const producersBytes = options.producersBytes ?? 600;
  const identifiers = options.identifiers ?? [
    "initialize",
    "transfer",
    "balance",
    "allowance",
  ];

  const typeSection = [0x01, ...leb(4), 0x01, 0x60, 0x00, 0x00];
  const funcPayload = [...leb(functionCount), ...Array(functionCount).fill(0x00)];
  const functionSection = [0x03, ...leb(funcPayload.length), ...funcPayload];

  const exportName = Array.from(new TextEncoder().encode("init"));
  const exportPayload = [0x01, ...leb(exportName.length), ...exportName, 0x00, 0x00];
  const exportSection = [0x07, ...leb(exportPayload.length), ...exportPayload];

  const bodies: number[] = [];
  for (let index = 0; index < functionCount; index += 1) {
    bodies.push(...leb(2), 0x00, 0x0b);
  }
  const codePayload = [...leb(functionCount), ...bodies];
  const codeSection = [0x0a, ...leb(codePayload.length), ...codePayload];

  const specSection = customSection("contractspecv0", specPayload(identifiers));
  const envSection = customSection("contractenvmetav0", [0x00, 0x00, 0x00, 0x01]);
  const nameSection = validNameSection(functionCount, debugNameBytes);
  const producersSection = customSection(
    "producers",
    Array.from({ length: producersBytes }, (_, index) => (index % 26) + 97),
  );
  const dwarfSection = customSection(
    ".debug_info",
    Array.from({ length: dwarfBytes }, (_, index) => index % 251),
  );

  return new Uint8Array([
    0x00,
    0x61,
    0x73,
    0x6d,
    0x01,
    0x00,
    0x00,
    0x00,
    ...specSection,
    ...envSection,
    ...typeSection,
    ...functionSection,
    ...exportSection,
    ...codeSection,
    ...nameSection,
    ...producersSection,
    ...dwarfSection,
  ]);
}
