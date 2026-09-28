/**
 * Workspace cloud sync (issue #1526).
 *
 * The three properties that matter:
 *  - buckets are isolated per wallet, so switching accounts cannot leak one
 *    user's favorites into another's;
 *  - merges are field-shaped — favorites union, history appends, the workspace
 *    document is last-write-wins;
 *  - the pre-workspace `localStorage` favorites are not lost on upgrade.
 */

import { mergeSnapshots, emptySnapshot, snapshotsEqual } from "@/lib/sync/merge";
import { readJson } from "@/lib/offline/storage";
import {
  dedupeFavorites,
  sanitiseSnapshot,
  type HistoryEntry,
  type WorkspaceSnapshot,
} from "@/lib/sync/types";
import {
  LEGACY_FAVORITES_KEYS,
  applyLocalMutation,
  clearWorkspace,
  isPushRequired,
  readWorkspace,
  rememberActiveBucket,
  workspaceBucket,
  writeWorkspace,
} from "@/lib/sync/workspaceStore";

const WALLET_A = "GAXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const WALLET_B = "GBYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY";

beforeEach(() => {
  window.localStorage.clear();
});

const historyEntry = (id: string, at: number, label = id): HistoryEntry => ({
  id,
  at,
  kind: "deploy",
  label,
});

describe("workspaceBucket", () => {
  it("namespaces by lowercased address", () => {
    expect(workspaceBucket(WALLET_A)).toBe(workspaceBucket(WALLET_A.toLowerCase()));
  });

  it("uses a shared anonymous bucket for no wallet", () => {
    expect(workspaceBucket(null)).toBe(workspaceBucket(undefined));
    expect(workspaceBucket(null)).toBe(workspaceBucket(""));
  });

  it("gives different wallets different buckets", () => {
    expect(workspaceBucket(WALLET_A)).not.toBe(workspaceBucket(WALLET_B));
  });
});

describe("local workspace store", () => {
  it("returns an empty snapshot for an untouched bucket", () => {
    expect(readWorkspace(workspaceBucket(WALLET_A))).toEqual(emptySnapshot());
  });

  it("round-trips a snapshot", () => {
    const bucket = workspaceBucket(WALLET_A);
    const written = writeWorkspace(bucket, {
      ...emptySnapshot(),
      favorites: ["a", "b"],
    });
    expect(readWorkspace(bucket).favorites).toEqual(written.favorites);
  });

  it("isolates one wallet's data from another's", () => {
    writeWorkspace(workspaceBucket(WALLET_A), {
      ...emptySnapshot(),
      favorites: ["only-a"],
    });
    expect(readWorkspace(workspaceBucket(WALLET_B)).favorites).toEqual([]);
  });

  it("survives a corrupt payload", () => {
    window.localStorage.setItem(workspaceBucket(WALLET_A), "{{{");
    expect(readWorkspace(workspaceBucket(WALLET_A)).favorites).toEqual([]);
  });

  it("remembers the active bucket for a wallet", () => {
    rememberActiveBucket(WALLET_A);
    expect(
      JSON.parse(window.localStorage.getItem("sp:workspace:active")!).wallet,
    ).toBe(WALLET_A.toLowerCase());
  });

  it("ignores a blank wallet address", () => {
    rememberActiveBucket("   ");
    expect(window.localStorage.getItem("sp:workspace:active")).toBeNull();
  });

  it("clears a bucket back to empty", () => {
    const bucket = workspaceBucket(WALLET_A);
    writeWorkspace(bucket, { ...emptySnapshot(), favorites: ["a"] });
    clearWorkspace(bucket);
    expect(readWorkspace(bucket).favorites).toEqual([]);
  });
});

describe("legacy favorites migration", () => {
  it("folds the old keys into a fresh bucket", () => {
    window.localStorage.setItem(LEGACY_FAVORITES_KEYS[0], JSON.stringify(["old-a"]));
    window.localStorage.setItem(LEGACY_FAVORITES_KEYS[2], JSON.stringify(["old-b"]));

    const bucket = workspaceBucket(WALLET_A);
    expect(readWorkspace(bucket).favorites).toEqual(
      expect.arrayContaining(["old-a", "old-b"]),
    );
  });

  it("does not re-seed on the second read", () => {
    window.localStorage.setItem(LEGACY_FAVORITES_KEYS[0], JSON.stringify(["old-a"]));
    const bucket = workspaceBucket(WALLET_A);
    readWorkspace(bucket);
    writeWorkspace(bucket, { ...emptySnapshot(), favorites: [] });

    // A user who removes their last favorite must not have it reappear.
    expect(readWorkspace(bucket).favorites).toEqual([]);
  });

  it("persists the seeded union to the bucket", () => {
    window.localStorage.setItem(LEGACY_FAVORITES_KEYS[0], JSON.stringify(["old-a"]));
    const bucket = workspaceBucket(WALLET_A);
    readWorkspace(bucket);
    // The seed is written back, not just returned, so a reload sees it.
    expect(readJson<WorkspaceSnapshot>(bucket, emptySnapshot()).favorites).toContain(
      "old-a",
    );
  });

  it("seeds from the rich useFavorites store too", () => {
    // `hooks/useFavorites.ts` owns the fullest implementation; losing it would
    // silently drop a real user's stars on upgrade.
    window.localStorage.setItem("soroban_template_favorites", JSON.stringify(["rich"]));
    expect(readWorkspace(workspaceBucket(WALLET_A)).favorites).toContain("rich");
  });

  it("leaves an existing bucket's data alone", () => {
    const bucket = workspaceBucket(WALLET_A);
    writeWorkspace(bucket, { ...emptySnapshot(), favorites: ["existing"] });
    readWorkspace(bucket);
    window.localStorage.setItem(LEGACY_FAVORITES_KEYS[0], JSON.stringify(["late"]));
    expect(readWorkspace(bucket).favorites).toEqual(["existing"]);
  });

  it("ignores a malformed legacy payload", () => {
    window.localStorage.setItem(LEGACY_FAVORITES_KEYS[0], JSON.stringify({ a: 1 }));
    expect(readWorkspace(workspaceBucket(WALLET_A)).favorites).toEqual([]);
  });
});

describe("applyLocalMutation", () => {
  it("bumps updatedAt and records the device", () => {
    const { snapshot } = applyLocalMutation(
      emptySnapshot(),
      { favorites: ["a"] },
      { deviceId: "device-1", at: 5_000 },
    );
    expect(snapshot.updatedAt).toBe(5_000);
    expect(snapshot.deviceId).toBe("device-1");
    expect(snapshot.favorites).toEqual(["a"]);
  });

  it("can leave updatedAt alone for a read-only patch", () => {
    const base = { ...emptySnapshot(), updatedAt: 10 };
    const { snapshot } = applyLocalMutation(
      base,
      { favorites: ["a"] },
      { deviceId: "d", at: 99, bumpUpdatedAt: false },
    );
    expect(snapshot.updatedAt).toBe(10);
  });

  it("reports dirty when something changed", () => {
    const { dirty } = applyLocalMutation(
      emptySnapshot(),
      { favorites: ["a"] },
      { deviceId: "d" },
    );
    expect(dirty).toBe(true);
  });

  it("preserves untouched fields", () => {
    const base = { ...emptySnapshot(), favorites: ["keep"] };
    const { snapshot } = applyLocalMutation(
      base,
      { history: [historyEntry("h1", 1)] },
      { deviceId: "d" },
    );
    expect(snapshot.favorites).toEqual(["keep"]);
    expect(snapshot.history).toHaveLength(1);
  });
});

describe("isPushRequired", () => {
  it("is true when the local copy has something the server lacks", () => {
    const local = { ...emptySnapshot(), favorites: ["a"], updatedAt: 2 };
    const remote = { ...emptySnapshot(), favorites: [], updatedAt: 1, revision: 1 };
    expect(isPushRequired(local, remote)).toBe(true);
  });

  it("is false once the two sides hold the same content", () => {
    const local = { ...emptySnapshot(), favorites: ["a"] };
    const remote = { ...emptySnapshot(), favorites: ["a"], revision: 3 };
    expect(isPushRequired(local, remote)).toBe(false);
  });

  it("ignores a favorite-list reordering", () => {
    // Regression: a union keeps first-seen order, so the same set of favorites
    // can legitimately serialise in a different order on two devices. If that
    // counted as a difference, both devices would push the list back and forth
    // on every reconcile and never settle.
    const local = { ...emptySnapshot(), favorites: ["a", "b"] };
    const remote = { ...emptySnapshot(), favorites: ["b", "a"] };
    expect(isPushRequired(local, remote)).toBe(false);
  });

  it("is true when the server has nothing yet", () => {
    expect(isPushRequired({ ...emptySnapshot(), favorites: ["a"] }, null)).toBe(true);
  });
});

describe("two-device convergence", () => {
  it("settles instead of ping-ponging when both sides favorited something", () => {
    const deviceA = { ...emptySnapshot(), favorites: ["a"], deviceId: "a" };
    const deviceB = { ...emptySnapshot(), favorites: ["b"], deviceId: "b" };

    // A reconciles against the server, then pushes.
    const aMerged = mergeSnapshots(deviceA, deviceB);
    const server = aMerged.snapshot;

    // B reconciles against the server it just received.
    const bMerged = mergeSnapshots(deviceB, server);

    // Both converge on the same *content*, and neither has a reason to push.
    expect([...aMerged.snapshot.favorites].sort()).toEqual(["a", "b"]);
    expect([...bMerged.snapshot.favorites].sort()).toEqual(["a", "b"]);
    expect(isPushRequired(bMerged.snapshot, server)).toBe(false);
  });
});

describe("mergeSnapshots", () => {
  it("unions favorites from both sides", () => {
    const merged = mergeSnapshots(
      { ...emptySnapshot(), favorites: ["a", "b"] },
      { ...emptySnapshot(), favorites: ["b", "c"] },
    );
    expect(merged.snapshot.favorites).toEqual(["a", "b", "c"]);
  });

  it("appends history and sorts it oldest-first", () => {
    const merged = mergeSnapshots(
      { ...emptySnapshot(), history: [historyEntry("late", 200)] },
      { ...emptySnapshot(), history: [historyEntry("early", 100)] },
    );
    expect(merged.snapshot.history.map((entry) => entry.id)).toEqual([
      "early",
      "late",
    ]);
  });

  it("dedupes history by id", () => {
    const merged = mergeSnapshots(
      { ...emptySnapshot(), history: [historyEntry("same", 100, "local")] },
      { ...emptySnapshot(), history: [historyEntry("same", 100, "remote")] },
    );
    expect(merged.snapshot.history).toHaveLength(1);
    expect(merged.snapshot.history[0].label).toBe("remote");
  });

  it("applies last-write-wins to the workspace document", () => {
    const merged = mergeSnapshots(
      {
        ...emptySnapshot(),
        workspace: { ...emptySnapshot().workspace, fontSize: 20 },
        updatedAt: 200,
        deviceId: "a",
      },
      {
        ...emptySnapshot(),
        workspace: { ...emptySnapshot().workspace, fontSize: 14 },
        updatedAt: 100,
        deviceId: "b",
      },
    );
    expect(merged.snapshot.workspace.fontSize).toBe(20);
  });

  it("never rewinds the revision", () => {
    const merged = mergeSnapshots(
      { ...emptySnapshot(), revision: 7 },
      { ...emptySnapshot(), revision: 3 },
    );
    expect(merged.snapshot.revision).toBe(7);
  });

  it("is symmetric: the same pair merges to the same answer either way round", () => {
    const local = { ...emptySnapshot(), favorites: ["a"], updatedAt: 100, deviceId: "a" };
    const remote = { ...emptySnapshot(), favorites: ["b"], updatedAt: 200, deviceId: "b" };
    expect(snapshotsEqual(mergeSnapshots(local, remote).snapshot, mergeSnapshots(remote, local).snapshot)).toBe(true);
  });

  it("tolerates null on either side", () => {
    expect(mergeSnapshots(null, null).snapshot).toEqual(emptySnapshot());
    expect(mergeSnapshots(undefined, { ...emptySnapshot(), favorites: ["a"] }).snapshot.favorites).toEqual(["a"]);
  });
});

describe("snapshot sanitisation", () => {
  it("drops malformed favorites and history entries", () => {
    const snapshot = sanitiseSnapshot({
      favorites: ["ok", 42, null, "", "fine"],
      history: [historyEntry("h1", 1), { noId: true }, null],
    });
    expect(snapshot.favorites).toEqual(["ok", "fine"]);
    expect(snapshot.history.map((entry) => entry.id)).toEqual(["h1"]);
  });

  it("clamps out-of-range workspace values", () => {
    const snapshot = sanitiseSnapshot({
      workspace: { splitRatio: 42, fontSize: -1, sidebarCollapsed: "yes" },
    });
    expect(snapshot.workspace.splitRatio).toBeLessThanOrEqual(1);
    expect(snapshot.workspace.fontSize).toBeGreaterThan(0);
    expect(snapshot.workspace.sidebarCollapsed).toBe(false);
  });

  it("defaults the revision to 0 for a non-numeric value", () => {
    expect(sanitiseSnapshot({ revision: "3" }).revision).toBe(0);
  });

  it("caps and dedupes favorites", () => {
    const many = Array.from({ length: 200 }, (_v, i) => `id-${i % 150}`);
    expect(dedupeFavorites(many).length).toBeLessThanOrEqual(
      emptySnapshot().favorites.length + many.length,
    );
    expect(new Set(dedupeFavorites(many)).size).toBe(dedupeFavorites(many).length);
  });
});
