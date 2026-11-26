import test from "node:test";
import assert from "node:assert";
import {
  colorForPeer,
  mergePresence,
  presenceToPeers,
  pruneStalePresence,
  type PeerPresence,
  type TimedPeerPresence,
} from "../../collaboration/yjsPresence";

const now = 1_700_000_000_000;

function peer(id: string, line: number): PeerPresence {
  return {
    id,
    name: `Peer ${id}`,
    color: colorForPeer(id),
    cursor: { line, column: 1 },
    lastActive: now,
  };
}

test("three concurrent peer presence updates merge without duplicates", () => {
  let presence = new Map<string, TimedPeerPresence>();
  presence = mergePresence(presence, peer("a", 1), now);
  presence = mergePresence(presence, peer("b", 2), now);
  presence = mergePresence(presence, peer("c", 3), now);
  presence = mergePresence(presence, peer("b", 9), now);

  const visible = presenceToPeers(presence, "self");

  assert.strictEqual(visible.length, 3);
  assert.strictEqual(new Set(visible.map((item) => item.id)).size, 3);
  assert.strictEqual(visible.find((item) => item.id === "b")?.cursor?.line, 9);
});

test("stale cursors are pruned after the presence TTL", () => {
  let presence = new Map<string, TimedPeerPresence>();
  presence = mergePresence(presence, peer("a", 1), now);
  presence = mergePresence(presence, peer("b", 2), now + 14_000);

  const pruned = pruneStalePresence(presence, now + 15_000);

  assert.deepStrictEqual(Array.from(pruned.keys()), ["b"]);
});
