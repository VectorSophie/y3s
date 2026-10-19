import { describe, expect, test } from "vitest";
import { advance, contains, current, locate, setShuffle, shuffled, startPlay, watchUrl } from "../src/core/phase-play";

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ videoId: `v${i}`, index: 40 + i }));
const ids = (s: ReturnType<typeof startPlay>) => s.order.map((i) => s.items[i].videoId);
function seeded(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

describe("phase playback order", () => {
  test("plays in order and stops at the end without loop", () => {
    let s = startPlay({ playlistId: "PL", name: "P", items: items(3), loop: false, shuffle: false });
    expect(s.pending).toBe("v0");
    const seen = [current(s)!.videoId];
    for (let n = advance(s); n; n = advance(s)) {
      s = n;
      seen.push(current(s)!.videoId);
    }
    expect(seen).toEqual(["v0", "v1", "v2"]);
  });

  test("loops back to the first video", () => {
    let s = startPlay({ playlistId: "PL", name: "P", items: items(3), loop: true, shuffle: false });
    const seen: string[] = [];
    for (let k = 0; k < 7; k++) {
      seen.push(current(s)!.videoId);
      s = advance(s)!;
    }
    expect(seen).toEqual(["v0", "v1", "v2", "v0", "v1", "v2", "v0"]);
  });

  test("shuffle loop reshuffles each round, covers every video, never repeats back to back", () => {
    const rnd = seeded(3);
    let s = startPlay({ playlistId: "PL", name: "P", items: items(5), loop: true, shuffle: true }, rnd);
    const seen: string[] = [];
    for (let k = 0; k < 50; k++) {
      seen.push(current(s)!.videoId);
      s = advance(s, rnd)!;
    }
    for (let round = 0; round < 10; round++) expect(new Set(seen.slice(round * 5, round * 5 + 5)).size).toBe(5);
    for (let k = 1; k < seen.length; k++) expect(seen[k]).not.toBe(seen[k - 1]);
  });

  test("toggling shuffle keeps the current video", () => {
    let s = startPlay({ playlistId: "PL", name: "P", items: items(6), loop: true, shuffle: false });
    s = advance(advance(s)!)!; // v2
    const on = setShuffle(s, true, seeded(9));
    expect(current(on)!.videoId).toBe("v2");
    expect(new Set(ids(on)).size).toBe(6);
    const off = setShuffle(on, false);
    expect(current(off)!.videoId).toBe("v2");
    expect(ids(off)).toEqual(["v0", "v1", "v2", "v3", "v4", "v5"]);
  });

  test("locate prefers the copy at or after the current position", () => {
    const its = [
      { videoId: "a", index: 1 },
      { videoId: "b", index: 2 },
      { videoId: "a", index: 3 },
    ];
    let s = startPlay({ playlistId: "PL", name: "P", items: its, loop: false, shuffle: false });
    s = advance(s)!;
    expect(locate(s, "a")).toBe(2);
    expect(locate(s, "zz")).toBe(-1);
    expect(contains(s, "b")).toBe(true);
    expect(contains(s, null)).toBe(false);
  });

  test("shuffled avoids a given first item and is a permutation", () => {
    for (let k = 0; k < 50; k++) {
      const a = shuffled(4, seeded(k), 2);
      expect(a[0]).not.toBe(2);
      expect([...a].sort()).toEqual([0, 1, 2, 3]);
    }
  });

  test("watch url keeps the playlist and position", () => {
    const s = startPlay({ playlistId: "PL1", name: "P", items: items(1), loop: false, shuffle: false });
    expect(watchUrl(s, s.items[0])).toBe("/watch?v=v0&list=PL1&index=40");
  });
});
