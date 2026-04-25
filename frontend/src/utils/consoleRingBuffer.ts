export const CONSOLE_RING_HEADER_INTS = 8;
export const CONSOLE_RING_DEFAULT_CAPACITY = 4 * 1024 * 1024;
export const CONSOLE_RING_MAX_ENTRY_BYTES = 64 * 1024;

export const enum ConsoleRingHeaderIndex {
  WRITE_CURSOR = 0,
  READ_CURSOR = 1,
  DROPPED_MESSAGES = 2,
  SEQUENCE = 3,
}

const UINT32_MASK = 0xff;

export function writeUint32Wrapped(target: Uint8Array, start: number, value: number): void {
  target[start] = value & UINT32_MASK;
  target[(start + 1) % target.length] = (value >>> 8) & UINT32_MASK;
  target[(start + 2) % target.length] = (value >>> 16) & UINT32_MASK;
  target[(start + 3) % target.length] = (value >>> 24) & UINT32_MASK;
}

export function readUint32Wrapped(source: Uint8Array, start: number): number {
  const b0 = source[start];
  const b1 = source[(start + 1) % source.length];
  const b2 = source[(start + 2) % source.length];
  const b3 = source[(start + 3) % source.length];
  return (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0;
}

export function writeBytesWrapped(target: Uint8Array, start: number, payload: Uint8Array): void {
  const firstChunkLength = Math.min(payload.length, target.length - start);
  target.set(payload.subarray(0, firstChunkLength), start);

  if (firstChunkLength < payload.length) {
    target.set(payload.subarray(firstChunkLength), 0);
  }
}

export function readBytesWrapped(source: Uint8Array, start: number, length: number): Uint8Array {
  const firstChunkLength = Math.min(length, source.length - start);

  if (firstChunkLength === length) {
    return source.slice(start, start + length);
  }

  const merged = new Uint8Array(length);
  merged.set(source.subarray(start, start + firstChunkLength), 0);
  merged.set(source.subarray(0, length - firstChunkLength), firstChunkLength);
  return merged;
}
