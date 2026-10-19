import { describe, expect, test } from "vitest";
import {
  anchorsOf,
  marker as m,
  moveRows,
  movePhase,
  phaseFromRows,
  phaseIds,
  placeAnchors,
  removePhase,
  rowsOnly,
  sectionOf,
  sections,
  sortSection,
  splitEvery,
  startPhaseAt,
} from "../src/core/phases";

// a b | A: c d e | B: f g
const base = () => ["a", "b", m("A"), "c", "d", "e", m("B"), "f", "g"];

describe("sections", () => {
  test("unphased first, then phases in order", () => {
    expect(sections(base())).toEqual([
      { phase: null, rows: ["a", "b"] },
      { phase: "A", rows: ["c", "d", "e"] },
      { phase: "B", rows: ["f", "g"] },
    ]);
    expect(sectionOf(base(), "e")).toBe("A");
    expect(sectionOf(base(), "a")).toBe(null);
    expect(phaseIds(base())).toEqual(["A", "B"]);
  });
});

describe("moving videos", () => {
  test("into a phase goes to its end, keeping relative order", () => {
    expect(moveRows(base(), new Set(["g", "a"]), { phase: "A" })).toEqual(["b", m("A"), "c", "d", "e", "a", "g", m("B"), "f"]);
  });
  test("to the unphased top section", () => {
    expect(moveRows(base(), new Set(["f"]), { phase: null })).toEqual(["a", "b", "f", m("A"), "c", "d", "e", m("B"), "g"]);
  });
  test("top and bottom are the very ends of the playlist", () => {
    expect(moveRows(base(), new Set(["d"]), "top")[0]).toBe("d");
    expect(moveRows(base(), new Set(["c"]), "bottom").at(-1)).toBe("c");
  });
});

describe("moving phases", () => {
  test("up/down/top/bottom carry their videos; unphased stays first", () => {
    expect(movePhase(base(), "B", "up")).toEqual(["a", "b", m("B"), "f", "g", m("A"), "c", "d", "e"]);
    expect(movePhase(base(), "A", "down")).toEqual(["a", "b", m("B"), "f", "g", m("A"), "c", "d", "e"]);
    expect(movePhase(base(), "B", "top")).toEqual(movePhase(base(), "B", "up"));
    expect(movePhase(base(), "A", "bottom")).toEqual(movePhase(base(), "A", "down"));
    expect(movePhase(base(), "A", "up")).toEqual(base());
  });
});

describe("sorting within a phase", () => {
  test("only that phase changes", () => {
    expect(sortSection(base(), "A", (r) => [...r].reverse())).toEqual(["a", "b", m("A"), "e", "d", "c", m("B"), "f", "g"]);
  });
  test("must be a permutation", () => {
    expect(() => sortSection(base(), "A", () => ["c"])).toThrow();
  });
});

describe("creating and removing", () => {
  test("start phase here splits without moving anything", () => {
    expect(startPhaseAt(base(), "N", "d")).toEqual(["a", "b", m("A"), "c", m("N"), "d", "e", m("B"), "f", "g"]);
  });
  test("selection at the end of a section just gets a divider", () => {
    expect(phaseFromRows(base(), "N", new Set(["d", "e"]))).toEqual(["a", "b", m("A"), "c", m("N"), "d", "e", m("B"), "f", "g"]);
  });
  test("scattered selection is gathered after the first video's section", () => {
    expect(phaseFromRows(base(), "N", new Set(["a", "d", "g"]))).toEqual([
      "b",
      m("N"),
      "a",
      "d",
      "g",
      m("A"),
      "c",
      "e",
      m("B"),
      "f",
    ]);
  });
  test("remove phase merges its videos up", () => {
    expect(removePhase(base(), "A")).toEqual(["a", "b", "c", "d", "e", m("B"), "f", "g"]);
  });
  test("split every n", () => {
    const seq = splitEvery(base(), 3, (n) => `S${n}`);
    expect(seq).toEqual([m("S0"), "a", "b", "c", m("S1"), "d", "e", "f", m("S2"), "g"]);
  });
});

describe("saving and restoring", () => {
  test("anchors round-trip", () => {
    const a = anchorsOf(base());
    expect(a).toEqual([
      { id: "A", after: "b" },
      { id: "B", after: "e" },
    ]);
    expect(placeAnchors(rowsOnly(base()), a)).toEqual({ seq: base(), pending: [] });
  });
  test("empty phases and leading phases survive", () => {
    const seq = [m("X"), m("Y"), "a", m("Z"), m("W"), "b"];
    expect(placeAnchors(rowsOnly(seq), anchorsOf(seq)).seq).toEqual(seq);
  });
  test("dividers after rows not on the page wait", () => {
    const { seq, pending } = placeAnchors(["a", "b"], [
      { id: "A", after: "a" },
      { id: "B", after: "zz" },
    ]);
    expect(seq).toEqual(["a", m("A"), "b"]);
    expect(pending).toEqual([{ id: "B", after: "zz" }]);
  });
});

import { isContiguous, isRangeName } from "../src/core/phases";
describe("contiguity and range names", () => {
  test("a run inside one section is contiguous; across a divider or with gaps it isn't", () => {
    expect(isContiguous(base(), new Set(["d"]))).toBe(true);
    expect(isContiguous(base(), new Set(["c", "d"]))).toBe(true);
    expect(isContiguous(base(), new Set(["c", "e"]))).toBe(false);
    expect(isContiguous(base(), new Set(["e", "f"]))).toBe(false);
    expect(isContiguous(base(), new Set())).toBe(false);
  });
  test("range names", () => {
    expect(isRangeName("Videos 1–25")).toBe(true);
    expect(isRangeName("Chill")).toBe(false);
  });
});
