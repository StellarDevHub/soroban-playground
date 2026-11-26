export interface LayoutNodeInput {
  id: string;
  depth?: number;
  parentId?: string;
}

export interface LayoutEdgeInput {
  id: string;
  source: string;
  target: string;
}

export interface GraphPosition {
  x: number;
  y: number;
}

export type GraphPositions = Record<string, GraphPosition>;

export interface LayoutRequest {
  requestId: number;
  nodes: LayoutNodeInput[];
  edges: LayoutEdgeInput[];
}

export interface LayoutResponse {
  requestId: number;
  positions: GraphPositions;
}

const NODE_WIDTH = 260;
const NODE_HEIGHT = 140;
const COLUMN_GAP = NODE_WIDTH + 60;
const ROW_GAP = NODE_HEIGHT + 30;
const MAX_SWEEPS = 2;

/**
 * Dependency-free Dagre-style layered layout: longest-path layering followed
 * by barycenter sweeps to reduce edge crossings. Runs in a Web Worker so a
 * ledger tick never blocks the main thread.
 */
export function computeDagreLikeLayout(
  nodes: readonly LayoutNodeInput[],
  edges: readonly LayoutEdgeInput[],
): GraphPositions {
  if (nodes.length === 0) return {};

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const depths = new Map<string, number>();

  const resolveDepth = (id: string, visiting: Set<string>): number => {
    const cached = depths.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0;

    visiting.add(id);
    const node = nodeById.get(id);
    const parentDepth =
      node?.parentId && nodeById.has(node.parentId)
        ? resolveDepth(node.parentId, visiting) + 1
        : (node?.depth ?? 0);
    const resolved = Math.max(0, parentDepth);
    visiting.delete(id);
    depths.set(id, resolved);
    return resolved;
  };

  nodes.forEach((node) => {
    resolveDepth(node.id, new Set<string>());
  });

  const layers = new Map<number, string[]>();
  nodes.forEach((node) => {
    const depth = depths.get(node.id) ?? node.depth ?? 0;
    const layer = layers.get(depth) ?? [];
    layer.push(node.id);
    layers.set(depth, layer);
  });

  const orderedDepths = Array.from(layers.keys()).sort((a, b) => a - b);

  for (let sweep = 0; sweep < MAX_SWEEPS; sweep += 1) {
    orderedDepths.forEach((depth, layerIndex) => {
      const layer = layers.get(depth);
      if (!layer || layer.length < 2) return;

      const previousLayer =
        layerIndex > 0 ? layers.get(orderedDepths[layerIndex - 1]) : undefined;
      if (!previousLayer) return;

      const positionInParentLayer = new Map(
        previousLayer.map((id, index) => [id, index]),
      );
      const parentCounts = new Map<string, number[]>();
      edges.forEach((edge) => {
        const parentIndex = positionInParentLayer.get(edge.source);
        if (parentIndex === undefined) return;
        const counts = parentCounts.get(edge.target) ?? [];
        counts.push(parentIndex);
        parentCounts.set(edge.target, counts);
      });

      layer.sort((left, right) => {
        const leftParents = parentCounts.get(left) ?? [];
        const rightParents = parentCounts.get(right) ?? [];
        const barycenter = (values: number[], fallback: number) =>
          values.length > 0
            ? values.reduce((sum, value) => sum + value, 0) / values.length
            : fallback;
        const difference =
          barycenter(leftParents, layer.indexOf(left)) -
          barycenter(rightParents, layer.indexOf(right));
        return difference !== 0 ? difference : left.localeCompare(right);
      });
    });
  }

  const positions: GraphPositions = {};
  orderedDepths.forEach((depth) => {
    const layer = layers.get(depth) ?? [];
    const rowOffset = (layer.length * ROW_GAP) / 2 - ROW_GAP / 2;
    layer.forEach((id, index) => {
      positions[id] = {
        x: depth * COLUMN_GAP,
        y: index * ROW_GAP - rowOffset,
      };
    });
  });

  return positions;
}

export interface GasNodeInput {
  id: string;
  raw?: unknown;
}

const GAS_KEY_HINTS = [
  "gas",
  "cpu",
  "instruction",
  "resourcefee",
  "resource_fee",
];

function readGasCost(value: unknown, depth = 0): number {
  if (depth > 4 || value === null || typeof value !== "object") return 0;

  if (Array.isArray(value)) {
    return value.reduce(
      (sum, item) => sum + readGasCost(item, depth + 1),
      0,
    );
  }

  let total = 0;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase().replace(/[-_\s]/g, "");
    if (
      GAS_KEY_HINTS.some((hint) => normalizedKey.includes(hint)) &&
      typeof nested === "number" &&
      Number.isFinite(nested)
    ) {
      total += nested;
      continue;
    }
    total += readGasCost(nested, depth + 1);
  }

  return total;
}

export type GasHotspotLevel = 0 | 1 | 2;

/** 2 = hottest 20%, 1 = above 40% of peak, 0 = normal. */
export function buildGasHotspotLevels(
  nodes: readonly GasNodeInput[],
  edges: readonly LayoutEdgeInput[],
): Record<string, GasHotspotLevel> {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const costs = edges.map((edge) => readGasCost(nodeById.get(edge.target)?.raw));
  const peak = costs.reduce((max, cost) => Math.max(max, cost), 0);

  const levels: Record<string, GasHotspotLevel> = {};
  edges.forEach((edge, index) => {
    const cost = costs[index];
    levels[edge.id] =
      peak > 0 && cost >= peak * 0.8
        ? 2
        : peak > 0 && cost >= peak * 0.4
          ? 1
          : 0;
  });

  return levels;
}

export function isLayoutResponse(value: unknown): value is LayoutResponse {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<LayoutResponse>;
  return (
    typeof candidate.requestId === "number" &&
    candidate.positions !== null &&
    typeof candidate.positions === "object"
  );
}
