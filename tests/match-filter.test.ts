import { describe, expect, test } from "vitest";
import { inPlaylistOrder, matchRows } from "../src/core/match";
import {
  duplicateIds,
  extraCopies,
  formatTotal,
  isUnavailableTitle,
  isVisible,
  matchesQuery,
  sortOrder,
  type RowData,
} from "../src/core/filter";

const server = [
  { playlistItemId: "a", videoId: "v1" },
  { playlistItemId: "b", videoId: "v2" },
  { playlistItemId: "c", videoId: "v1" },
  { playlistItemId: "d", videoId: "v3" },
];

describe("matchRows", () => {
  test("pairs repeated videos in order", () => {
    expect(matchRows(["v1", "v2", "v1", "v3"], server)).toEqual(["a", "b", "c", "d"]);
  });
  test("missing rows and extra rows get null", () => {
    expect(matchRows(["v2", null, "v9", "v1"], server)).toEqual(["b", null, null, "a"]);
  });
});

describe("inPlaylistOrder", () => {
  test("true for a manual view, ignoring hidden items", () => {
    expect(inPlaylistOrder(["a", "c", "d"], server)).toBe(true);
  });
  test("false when YouTube shows a different order", () => {
    expect(inPlaylistOrder(["d", "a", "b"], server)).toBe(false);
  });
});

const row = (p: Partial<RowData>): RowData => ({
  videoId: "x",
  title: "",
  channel: "",
  duration: null,
  unavailable: false,
  ...p,
});

describe("filtering", () => {
  test("all words must match, accents and case ignored", () => {
    const r = row({ title: "Café Jazz live", channel: "Night FM" });
    expect(matchesQuery(r, "cafe night")).toBe(true);
    expect(matchesQuery(r, "jazz piano")).toBe(false);
    expect(matchesQuery(r, "  ")).toBe(true);
  });
  test("duplicates and extra copies", () => {
    const rows = [row({ videoId: "a" }), row({ videoId: "b" }), row({ videoId: "a" }), row({ videoId: "a" })];
    expect([...duplicateIds(rows)]).toEqual(["a"]);
    expect(extraCopies(rows)).toEqual([2, 3]);
  });
  test("chips", () => {
    const dups = new Set(["a"]);
    expect(isVisible(row({ videoId: "a" }), "", "dups", dups)).toBe(true);
    expect(isVisible(row({ videoId: "b" }), "", "dups", dups)).toBe(false);
    expect(isVisible(row({ unavailable: true }), "", "unavail", dups)).toBe(true);
  });
  test("unavailable titles from page and API", () => {
    expect(isUnavailableTitle("[Private video]")).toBe(true);
    expect(isUnavailableTitle("Deleted video")).toBe(true);
    expect(isUnavailableTitle("Private video diaries ep 3")).toBe(false);
  });
});

describe("sortOrder", () => {
  const rows = [
    row({ title: "beta", channel: "Z", duration: 30 }),
    row({ title: "Alpha 10", channel: "A", duration: null }),
    row({ title: "alpha 2", channel: "A", duration: 300 }),
  ];
  test("title is case-insensitive and numeric-aware", () => {
    expect(sortOrder(rows, "title", [0, 1, 2])).toEqual([2, 1, 0]);
  });
  test("channel then title", () => {
    expect(sortOrder(rows, "channel", [0, 1, 2])).toEqual([2, 1, 0]);
  });
  test("durations put unknown last either way", () => {
    expect(sortOrder(rows, "short", [0, 1, 2])).toEqual([0, 2, 1]);
    expect(sortOrder(rows, "long", [0, 1, 2])).toEqual([2, 0, 1]);
  });
  test("manual restores original positions", () => {
    expect(sortOrder(rows, "manual", [2, 0, 1])).toEqual([1, 2, 0]);
  });
  test("shuffle is a permutation", () => {
    expect(sortOrder(rows, "shuffle", [0, 1, 2], () => 0.5).sort()).toEqual([0, 1, 2]);
  });
  test("formatTotal", () => {
    expect(formatTotal(59 * 60)).toBe("59m");
    expect(formatTotal(3 * 3600 + 5 * 60 + 9)).toBe("3h 5m");
  });
});
