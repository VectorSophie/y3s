import { expect, test } from "vitest";
import { edgeSpeed, rowsInBand } from "../src/content/drag-select";

test("rowsInBand picks rows overlapping the dragged band, either direction", () => {
  const boxes = [0, 100, 200, 300].map((t) => ({ top: t, bottom: t + 90 }));
  expect(rowsInBand(boxes, 50, 210)).toEqual([0, 1, 2]);
  expect(rowsInBand(boxes, 210, 50)).toEqual([0, 1, 2]);
  expect(rowsInBand(boxes, 92, 98)).toEqual([]);
  expect(rowsInBand([{ top: 10, bottom: 10 }], 0, 50)).toEqual([]);
});

test("edgeSpeed scrolls near the edges only, faster further in", () => {
  expect(edgeSpeed(400, 150, 900)).toBe(0);
  expect(edgeSpeed(160, 150, 900)).toBeLessThan(0);
  expect(edgeSpeed(100, 150, 900)).toBeLessThan(edgeSpeed(190, 150, 900));
  expect(edgeSpeed(890, 150, 900)).toBeGreaterThan(edgeSpeed(860, 150, 900));
});
