import { expect, test } from "vitest";
import type { NativeRow } from "../src/shared/types";
import { findDuplicateVideoIds, totalRuntimeSeconds, rowMatchesQuery } from "../src/state/qol-derive";

function row(p: Partial<NativeRow>): NativeRow {
  return { videoId: "x", title: "t", index: 0, el: {} as HTMLElement, ...p };
}

test("findDuplicateVideoIds flags videoIds appearing more than once", () => {
  const rows = [row({ videoId: "a" }), row({ videoId: "b" }), row({ videoId: "a" })];
  expect([...findDuplicateVideoIds(rows)]).toEqual(["a"]);
});

test("totalRuntimeSeconds sums durationSec, ignoring missing", () => {
  const rows = [row({ durationSec: 213 }), row({ durationSec: 9 }), row({})];
  expect(totalRuntimeSeconds(rows)).toBe(222);
});

test("rowMatchesQuery matches title or channel, case-insensitive; empty matches all", () => {
  const r = row({ title: "Never Gonna", channel: "Rick Astley" });
  expect(rowMatchesQuery(r, "")).toBe(true);
  expect(rowMatchesQuery(r, "never")).toBe(true);
  expect(rowMatchesQuery(r, "astley")).toBe(true);
  expect(rowMatchesQuery(r, "despacito")).toBe(false);
});
