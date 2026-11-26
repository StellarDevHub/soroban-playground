import test from "node:test";
import assert from "node:assert";
import {
  buildGasHotspotLevels,
  computeDagreLikeLayout,
  type LayoutEdgeInput,
  type LayoutNodeInput,
} from "../../utils/transactionGraphLayout";

function buildGraph(nodeCount: number) {
  const nodes: LayoutNodeInput[] = Array.from({ length: nodeCount }, (_, i) => ({
    id: `call-${i}`,
    depth: Math.floor(i / 5),
    parentId: i === 0 ? undefined : `call-${Math.floor((i - 1) / 2)}`,
  }));
  const edges: LayoutEdgeInput[] = nodes
    .filter((node) => node.parentId)
    .map((node) => ({
      id: `${node.parentId}->${node.id}`,
      source: node.parentId as string,
      target: node.id,
    }));
  return { nodes, edges };
}

test("DAG layout positions a 50+ node transaction within one 60 FPS frame", () => {
  const { nodes, edges } = buildGraph(60);

  const started = performance.now();
  const positions = computeDagreLikeLayout(nodes, edges);
  const elapsed = performance.now() - started;

  assert.strictEqual(Object.keys(positions).length, 60);
  assert.ok(elapsed < 16, `layout took ${elapsed.toFixed(2)}ms`);
  assert.ok(
    new Set(Object.values(positions).map((position) => position.x)).size >= 10,
  );
});

test("gas hotspots colour the hottest edges only", () => {
  const nodes = [
    { id: "a", raw: {} },
    { id: "b", raw: { gasUsed: 100 } },
    { id: "c", raw: { gasUsed: 900 } },
    { id: "d", raw: { gasUsed: 400 } },
  ];
  const edges = [
    { id: "a->b", source: "a", target: "b" },
    { id: "a->c", source: "a", target: "c" },
    { id: "a->d", source: "a", target: "d" },
  ];

  const levels = buildGasHotspotLevels(nodes, edges);

  assert.strictEqual(levels["a->b"], 0);
  assert.strictEqual(levels["a->c"], 2);
  assert.strictEqual(levels["a->d"], 1);
});
