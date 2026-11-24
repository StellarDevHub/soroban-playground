import type { WasmMemoryProfile } from "@/utils/wasmInspector";

/** Soroban contracts run with a 256 KB linear-memory ceiling. */
export const SOROBAN_MEMORY_CEILING_BYTES = 256 * 1024;
/** Usage ratio at which developers are warned. */
export const MEMORY_WARN_RATIO = 0.8;

export type MemorySegment = "data" | "stack" | "heap";
export type MemoryPressure = "ok" | "warning" | "critical";

export interface SegmentUsage {
  data: number;
  stack: number;
  heap: number;
  total: number;
  /** total / ceiling, uncapped (can exceed 1). */
  ratio: number;
  pressure: MemoryPressure;
}

/** Stack vs heap vs data-segment usage derived from a profile. */
export function computeSegmentUsage(
  profile: Pick<
    WasmMemoryProfile,
    "staticDataBytes" | "stackEstimateBytes" | "heapMinBytes"
  >,
  ceiling: number = SOROBAN_MEMORY_CEILING_BYTES,
): SegmentUsage {
  const data = Math.max(0, profile.staticDataBytes || 0);
  const stack = Math.max(0, profile.stackEstimateBytes || 0);
  const heap = Math.max(0, profile.heapMinBytes ?? 0);
  const total = data + stack + heap;
  const ratio = ceiling > 0 ? total / ceiling : 0;
  const pressure: MemoryPressure =
    ratio >= 1 ? "critical" : ratio >= MEMORY_WARN_RATIO ? "warning" : "ok";
  return { data, stack, heap, total, ratio, pressure };
}

/** RGBA colours per segment; `free` is unallocated space. */
export const SEGMENT_COLORS: Record<
  MemorySegment | "free",
  [number, number, number, number]
> = {
  data: [244, 63, 94, 255], // rose
  stack: [245, 158, 11, 255], // amber
  heap: [52, 211, 153, 255], // emerald
  free: [30, 41, 59, 255], // slate
};

export const HEATMAP_COLS = 64;
export const HEATMAP_ROWS = 16;
export const HEATMAP_CELL_PX = 6;

/**
 * Number of heatmap cells each segment occupies. One cell covers
 * ceiling / (cols * rows) bytes; any used segment gets at least one cell so
 * it stays visible. The result never exceeds the grid size.
 */
export function allocateCells(
  usage: Pick<SegmentUsage, "data" | "stack" | "heap">,
  cols: number = HEATMAP_COLS,
  rows: number = HEATMAP_ROWS,
  ceiling: number = SOROBAN_MEMORY_CEILING_BYTES,
): Record<MemorySegment, number> {
  const capacity = cols * rows;
  const bytesPerCell = ceiling / capacity;
  const cells: Record<MemorySegment, number> = { data: 0, stack: 0, heap: 0 };
  let remaining = capacity;
  for (const seg of ["data", "stack", "heap"] as MemorySegment[]) {
    const bytes = usage[seg];
    if (bytes <= 0) continue;
    const want = Math.max(1, Math.round(bytes / bytesPerCell));
    cells[seg] = Math.min(want, remaining);
    remaining -= cells[seg];
  }
  return cells;
}

/**
 * Paints the heatmap into an existing pixel buffer **in place** (no
 * allocation). Cells fill row-major in the order data, stack, heap, then free.
 */
export function paintHeatmap(
  pixels: Uint8ClampedArray,
  cells: Record<MemorySegment, number>,
  cols: number = HEATMAP_COLS,
  rows: number = HEATMAP_ROWS,
  cellPx: number = HEATMAP_CELL_PX,
): void {
  const width = cols * cellPx;
  const order: Array<MemorySegment | "free"> = [];
  for (const seg of ["data", "stack", "heap"] as MemorySegment[]) {
    for (let i = 0; i < cells[seg]; i++) order.push(seg);
  }
  while (order.length < cols * rows) order.push("free");

  for (let cell = 0; cell < cols * rows; cell++) {
    const [r, g, b, a] = SEGMENT_COLORS[order[cell]];
    const cx = (cell % cols) * cellPx;
    const cy = Math.floor(cell / cols) * cellPx;
    for (let y = 0; y < cellPx; y++) {
      for (let x = 0; x < cellPx; x++) {
        // 1px gutter on the right/bottom edge of each cell for a grid look.
        const gutter = x === cellPx - 1 || y === cellPx - 1;
        const o = ((cy + y) * width + (cx + x)) * 4;
        pixels[o] = gutter ? 15 : r;
        pixels[o + 1] = gutter ? 23 : g;
        pixels[o + 2] = gutter ? 42 : b;
        pixels[o + 3] = a;
      }
    }
  }
}

/**
 * Two `ImageData` buffers allocated **once** and recycled for every frame:
 * draw into the back buffer, present it, then swap. This avoids creating a
 * fresh `ImageData` (and its pixel array) per redraw, which leaked memory.
 */
export class DoubleBufferedImageData {
  readonly width: number;
  readonly height: number;
  private buffers: [ImageData, ImageData] | null;
  private back = 0;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.buffers = [new ImageData(width, height), new ImageData(width, height)];
  }

  /** The buffer to draw the next frame into. */
  get backBuffer(): ImageData {
    if (!this.buffers) throw new Error("DoubleBufferedImageData disposed");
    return this.buffers[this.back];
  }

  /** Marks the back buffer as presented and returns it; next draw uses the other. */
  swap(): ImageData {
    const presented = this.backBuffer;
    this.back = this.back === 0 ? 1 : 0;
    return presented;
  }

  get disposed(): boolean {
    return this.buffers === null;
  }

  /** Drops references so the pixel arrays can be garbage collected. */
  dispose(): void {
    this.buffers = null;
  }
}
