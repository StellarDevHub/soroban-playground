import type { BinaryenLike } from "./wasmOptCore";

export async function loadBinaryen(): Promise<BinaryenLike> {
  const binaryenModule = await import("binaryen");
  return binaryenModule.default as unknown as BinaryenLike;
}
