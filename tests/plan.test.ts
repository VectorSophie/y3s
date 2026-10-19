import { describe, expect, test } from "vitest";
import {
  applyChanges,
  desiredOrder,
  longestIncreasing,
  planChanges,
  planMoves,
  type ServerItem,
} from "../src/core/plan";

const items = (n: number): ServerItem[] =>
  Array.from({ length: n }, (_, i) => ({ playlistItemId: `p${i}`, videoId: `v${i}` }));
const ids = (l: ServerItem[]) => l.map((s) => s.playlistItemId);

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}
function shuffle<T>(a: T[], rnd: () => number): T[] {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

describe("longestIncreasing", () => {
  test("finds a longest run", () => {
    const keep = longestIncreasing([3, 0, 1, 4, 2, 5]);
    expect(keep.size).toBe(4);
    const vals = [...keep].sort((a, b) => a - b).map((i) => [3, 0, 1, 4, 2, 5][i]);
    expect(vals).toEqual([...vals].sort((a, b) => a - b));
  });
  test("empty and sorted", () => {
    expect(longestIncreasing([]).size).toBe(0);
    expect(longestIncreasing([0, 1, 2]).size).toBe(3);
  });
});

describe("planMoves", () => {
  test("no-op when already in order", () => {
    expect(planMoves(["a", "b", "c"], ["a", "b", "c"])).toEqual([]);
  });

  test("move 3 to top costs 3 writes", () => {
    const cur = ids(items(10));
    const target = ["p7", "p2", "p9", ...cur.filter((x) => !["p7", "p2", "p9"].includes(x))];
    const moves = planMoves(cur, target);
    expect(moves).toHaveLength(3);
  });

  test("move 3 to bottom costs 3 writes (not n-3)", () => {
    const cur = ids(items(50));
    const sel = ["p0", "p1", "p20"];
    const target = [...cur.filter((x) => !sel.includes(x)), ...sel];
    expect(planMoves(cur, target)).toHaveLength(3);
  });

  test("random permutations: replaying moves reaches the target with n - LIS writes", () => {
    const rnd = seeded(42);
    for (let round = 0; round < 300; round++) {
      const n = 1 + Math.floor(rnd() * 40);
      const server = items(n);
      const target = shuffle(ids(server), rnd);
      const moves = planMoves(ids(server), target);
      const result = applyChanges(
        server,
        moves.map((m) => ({ kind: "move" as const, playlistItemId: m.id, videoId: "", position: m.position })),
      );
      expect(ids(result)).toEqual(target);
      const tIdx = new Map(target.map((id, i) => [id, i]));
      const lis = longestIncreasing(ids(server).map((id) => tIdx.get(id)!)).size;
      expect(moves.length).toBe(n - lis);
    }
  });

  test("rejects mismatched lists", () => {
    expect(() => planMoves(["a"], ["b"])).toThrow();
    expect(() => planMoves(["a", "b"], ["a"])).toThrow();
  });
});

describe("desiredOrder", () => {
  test("hidden items travel with the shown item before them; tail stays at end", () => {
    const server = items(6); // p1 and p5 are hidden on the page
    const shown = ["p3", "p0", "p4", "p2"];
    expect(desiredOrder(server, shown)).toEqual(["p3", "p0", "p1", "p4", "p2", "p5"]);
  });
  test("leading hidden items stay first", () => {
    const server = items(3);
    expect(desiredOrder(server, ["p2", "p1"])).toEqual(["p0", "p2", "p1"]);
  });
});

describe("planChanges", () => {
  test("deletes first, then moves, and the result matches the page", () => {
    const server = items(8);
    const removed = new Set(["p2", "p6"]);
    const shown = ["p5", "p0", "p1", "p2", "p3", "p4", "p6", "p7"];
    const changes = planChanges(server, shown, removed);
    expect(changes.filter((c) => c.kind === "delete").map((c) => c.playlistItemId)).toEqual(["p2", "p6"]);
    expect(changes.findIndex((c) => c.kind === "move")).toBe(2);
    expect(changes.filter((c) => c.kind === "move")).toHaveLength(1);
    expect(ids(applyChanges(server, changes))).toEqual(["p5", "p0", "p1", "p3", "p4", "p7"]);
  });

  test("random edits always land exactly", () => {
    const rnd = seeded(7);
    for (let round = 0; round < 200; round++) {
      const n = 2 + Math.floor(rnd() * 30);
      const server = items(n);
      const hidden = new Set(ids(server).filter(() => rnd() < 0.1));
      const shown = shuffle(ids(server).filter((id) => !hidden.has(id)), rnd);
      const removed = new Set([...ids(server)].filter(() => rnd() < 0.2));
      const result = ids(applyChanges(server, planChanges(server, shown, removed)));
      expect(result.filter((id) => !hidden.has(id))).toEqual(shown.filter((id) => !removed.has(id)));
      expect(result.length).toBe(n - removed.size);
    }
  });

  test("unknown ids are rejected", () => {
    expect(() => planChanges(items(2), ["p0", "zz"], new Set())).toThrow();
  });
});
