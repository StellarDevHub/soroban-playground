/**
 * Offline sync engine primitives (issue #1525).
 *
 * Two things have to be right for the app to be usable offline, and both are
 * easy to get subtly wrong:
 *
 *  1. the outbox must **survive a reload** and must **coalesce** repeated writes,
 *     otherwise a burst of edits turns into a burst of requests and a crashed
 *     tab loses the user's work;
 *  2. the merge engine must be **deterministic** — two devices that see the same
 *     pair of records must reach the same answer without talking to each other.
 */

import { createOutbox, OUTBOX_STORAGE_KEY } from "@/lib/offline/outbox";
import {
  appendLog,
  inferStrategy,
  mergeRecords,
  resolveField,
  unionIds,
} from "@/lib/offline/conflict";
import { safeStorage } from "@/lib/offline/storage";
import { INITIAL_CONNECTIVITY_STATE } from "@/lib/offline/types";

beforeEach(() => {
  window.localStorage.clear();
});

describe("safeStorage", () => {
  it("round-trips a value", () => {
    safeStorage.setItem("probe", "value");
    expect(safeStorage.getItem("probe")).toBe("value");
    expect(safeStorage.length).toBeGreaterThan(0);
  });

  it("reports a length and a key for the in-memory fallback shape", () => {
    // The fallback must satisfy the `Storage` surface the outbox relies on.
    safeStorage.setItem("a", "1");
    expect(safeStorage.key(0)).not.toBeNull();
    // An out-of-range index is `null`, exactly as `Storage.key` specifies.
    expect(safeStorage.key(99)).toBeNull();
  });
});

describe("outbox durability and coalescing", () => {
  it("persists queued operations to storage", () => {
    const outbox = createOutbox();
    outbox.enqueue("op-1", "workspace.push", { a: 1 });
    const stored = JSON.parse(window.localStorage.getItem(OUTBOX_STORAGE_KEY)!);
    expect(stored.operations).toHaveLength(1);
    expect(stored.operations[0].id).toBe("op-1");
  });

  it("rehydrates queued operations after a restart", () => {
    createOutbox().enqueue("op-1", "workspace.push", { a: 1 });
    // A second outbox over the same key models a page reload.
    const reloaded = createOutbox();
    expect(reloaded.getState().operations).toHaveLength(1);
    expect(reloaded.getState().operations[0].payload).toEqual({ a: 1 });
  });

  it("coalesces re-enqueues of the same id into one operation", () => {
    const outbox = createOutbox();
    outbox.enqueue("workspace:ga", "workspace.push", { revision: 1 });
    outbox.enqueue("workspace:ga", "workspace.push", { revision: 2 });
    outbox.enqueue("workspace:ga", "workspace.push", { revision: 3 });

    const operations = outbox.getState().operations;
    expect(operations).toHaveLength(1);
    expect(operations[0].payload).toEqual({ revision: 3 });
  });

  it("keeps distinct ids separate and drains oldest-first", () => {
    const outbox = createOutbox();
    outbox.enqueue("a", "kind", 1);
    outbox.enqueue("b", "kind", 2);
    expect(outbox.pending().map((op) => op.id)).toEqual(["a", "b"]);
  });

  it("removes an operation once it is resolved", () => {
    const outbox = createOutbox();
    outbox.enqueue("a", "kind", 1);
    expect(outbox.resolve("a")).toBe(true);
    expect(outbox.getState().operations).toHaveLength(0);
    expect(outbox.resolve("a")).toBe(false);
  });

  it("records a failure and increments the attempt count", () => {
    const outbox = createOutbox();
    outbox.enqueue("a", "kind", 1);
    expect(outbox.reject("a", new Error("network down"))).toBe(true);

    const [operation] = outbox.getState().operations;
    expect(operation.attempts).toBe(1);
    expect(operation.lastError).toBe("network down");
    expect(outbox.reject("missing", new Error("x"))).toBe(false);
  });

  it("normalises a non-Error rejection into a message", () => {
    const outbox = createOutbox();
    outbox.enqueue("a", "kind", 1);
    outbox.reject("a", "string failure");
    expect(outbox.getState().operations[0].lastError).toBe("string failure");

    outbox.reject("a", {});
    expect(outbox.getState().operations[0].lastError).toBe("Unknown error");
  });

  it("drops malformed persisted entries instead of throwing", () => {
    window.localStorage.setItem(
      OUTBOX_STORAGE_KEY,
      JSON.stringify({ operations: [null, { id: 42 }, { id: "ok", kind: "k", queuedAt: 1 }] }),
    );
    const outbox = createOutbox();
    expect(outbox.getState().operations.map((op) => op.id)).toEqual(["ok"]);
  });

  it("survives a corrupt payload", () => {
    window.localStorage.setItem(OUTBOX_STORAGE_KEY, "{not json");
    expect(createOutbox().getState().operations).toEqual([]);
  });

  it("compacts to the newest operations", () => {
    const outbox = createOutbox();
    outbox.enqueue("a", "kind", 1);
    outbox.enqueue("b", "kind", 2);
    outbox.enqueue("c", "kind", 3);
    outbox.compact(1);
    expect(outbox.getState().operations.map((op) => op.id)).toEqual(["c"]);
  });

  it("notifies subscribers on every change", () => {
    const outbox = createOutbox();
    const listener = jest.fn();
    const unsubscribe = outbox.subscribe(listener);
    outbox.enqueue("a", "kind", 1);
    expect(listener).toHaveBeenCalled();
    const before = listener.mock.calls.length;
    unsubscribe();
    outbox.enqueue("b", "kind", 2);
    expect(listener.mock.calls).toHaveLength(before);
  });
});

describe("unionIds", () => {
  it("keeps first-seen order", () => {
    expect(unionIds(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("ignores empty and duplicate entries", () => {
    expect(unionIds(["a", "", "a"], ["a", "b"])).toEqual(["a", "b"]);
  });

  it("is commutative with respect to membership", () => {
    expect([...unionIds(["a", "b"], ["c"])].sort()).toEqual(
      [...unionIds(["c"], ["a", "b"])].sort(),
    );
  });
});

describe("appendLog", () => {
  it("merges and sorts oldest-first", () => {
    const merged = appendLog(
      [{ id: "b", at: 200 }],
      [{ id: "a", at: 100 }],
    );
    expect(merged.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("dedupes on id, letting the remote copy win", () => {
    const merged = appendLog(
      [{ id: "a", at: 1, label: "local" }],
      [{ id: "a", at: 1, label: "remote" }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].label).toBe("remote");
  });

  it("breaks equal timestamps deterministically by id", () => {
    const first = appendLog([{ id: "b", at: 5 }], [{ id: "a", at: 5 }]);
    const second = appendLog([{ id: "a", at: 5 }], [{ id: "b", at: 5 }]);
    expect(first.map((e) => e.id)).toEqual(second.map((e) => e.id));
  });

  it("skips entries without a usable id", () => {
    const merged = appendLog(
      [{ id: "a", at: 1 }],
      [undefined as never, { at: 2 } as never],
    );
    expect(merged.map((e) => e.id)).toEqual(["a"]);
  });
});

describe("inferStrategy", () => {
  it("picks union for two id lists", () => {
    expect(inferStrategy(["a"], ["b"])).toBe("union");
  });

  it("picks append for two id-keyed logs", () => {
    expect(inferStrategy([{ id: "a" }], [{ id: "b" }])).toBe("append");
  });

  it("falls back to newest-wins for scalars", () => {
    expect(inferStrategy("a", "b")).toBe("newest-wins");
    expect(inferStrategy({ a: 1 }, { a: 2 })).toBe("newest-wins");
  });
});

describe("resolveField", () => {
  it("is a no-op when the values already agree", () => {
    const outcome = resolveField("a", "same", "same", { updatedAt: 1 }, { updatedAt: 2 });
    expect(outcome.value).toBe("same");
    expect(outcome.conflicts).toHaveLength(0);
    expect(outcome.dirty).toBe(false);
  });

  it("prefers the newer side under newest-wins", () => {
    const outcome = resolveField("a", "local", "remote", { updatedAt: 200 }, { updatedAt: 100 });
    expect(outcome.value).toBe("local");
    expect(outcome.dirty).toBe(false);
    expect(outcome.conflicts[0].resolution).toBe("local");
  });

  it("marks the field dirty when the remote side wins", () => {
    const outcome = resolveField("a", "local", "remote", { updatedAt: 100 }, { updatedAt: 200 });
    expect(outcome.value).toBe("remote");
    expect(outcome.dirty).toBe(true);
  });

  it("breaks an exact timestamp tie deterministically on deviceId", () => {
    const versions = { updatedAt: 100 };
    const fromA = resolveField("a", "a", "b", { ...versions, deviceId: "aaa" }, { ...versions, deviceId: "bbb" });
    const fromB = resolveField("a", "b", "a", { ...versions, deviceId: "bbb" }, { ...versions, deviceId: "aaa" });
    expect(fromA.value).toBe(fromB.value);
  });

  it("honours an explicit local-wins override", () => {
    const outcome = resolveField("a", "local", "remote", { updatedAt: 1 }, { updatedAt: 999 }, "local-wins");
    expect(outcome.value).toBe("local");
  });

  it("honours an explicit remote-wins override", () => {
    const outcome = resolveField("a", "local", "remote", { updatedAt: 999 }, { updatedAt: 1 }, "remote-wins");
    expect(outcome.value).toBe("remote");
  });

  it("falls back to manual when the override cannot be applied", () => {
    const outcome = resolveField("a", { x: 1 }, { y: 2 }, { updatedAt: 1 }, { updatedAt: 2 }, "union");
    expect(outcome.conflicts[0].resolution).toBe("manual");
  });
});

describe("mergeRecords", () => {
  it("takes fields that exist on only one side", () => {
    const merged = mergeRecords({ a: 1, localOnly: 2 }, { a: 1, remoteOnly: 3 });
    expect(merged.value).toMatchObject({ a: 1, localOnly: 2, remoteOnly: 3 });
    expect(merged.dirty).toBe(false);
  });

  it("is not dirty when a union only echoes the local side", () => {
    // The merged value equals what we already have, so there is nothing to push
    // — a push here would be a wasted round-trip on every reconcile.
    const merged = mergeRecords({ favorites: ["a", "b"] }, { favorites: ["a", "b"] });
    expect(merged.dirty).toBe(false);
  });

  it("is dirty when the union adds a remote-only id", () => {
    const merged = mergeRecords(
      { favorites: ["a"] },
      { favorites: ["a", "b"] },
      { localVersion: { updatedAt: 1 }, remoteVersion: { updatedAt: 2 } },
    );
    expect(merged.value.favorites).toEqual(["a", "b"]);
    expect(merged.dirty).toBe(true);
  });

  it("is not dirty when the local side is ahead", () => {
    const merged = mergeRecords(
      { favorites: ["a", "b"] },
      { favorites: ["a"] },
      { localVersion: { updatedAt: 1 }, remoteVersion: { updatedAt: 2 } },
    );
    expect(merged.value.favorites).toEqual(["a", "b"]);
    expect(merged.dirty).toBe(false);
  });

  it("applies a per-field strategy override", () => {
    const merged = mergeRecords(
      { pinned: "local" },
      { pinned: "remote" },
      { overrides: { pinned: "local-wins" } },
    );
    expect(merged.value.pinned).toBe("local");
  });

  it("reports manual conflicts separately", () => {
    const merged = mergeRecords(
      { shape: { a: 1 } },
      { shape: { b: 2 } },
      { overrides: { shape: "union" } },
    );
    expect(merged.manual).toHaveLength(1);
    expect(merged.manual[0].resolution).toBe("manual");
  });
});

describe("connectivity defaults", () => {
  it("starts unknown with no history", () => {
    expect(INITIAL_CONNECTIVITY_STATE.status).toBe("unknown");
    expect(INITIAL_CONNECTIVITY_STATE.lastOnlineAt).toBeNull();
    expect(INITIAL_CONNECTIVITY_STATE.failureCount).toBe(0);
  });
});
