import { expect, test } from "vitest";
import type { NativeRow } from "../src/shared/types";
import { toJSON, toCSV, toMarkdown } from "../src/state/exporters";

function row(p: Partial<NativeRow>): NativeRow {
  return { videoId: "v1", title: "Title", channel: "Chan", durationText: "3:33", index: 0, el: {} as HTMLElement, ...p };
}

test("toJSON emits an array of plain fields (no el)", () => {
  const json = JSON.parse(toJSON([row({})]));
  expect(json[0]).toEqual({
    position: 1,
    title: "Title",
    channel: "Chan",
    videoId: "v1",
    duration: "3:33",
    url: "https://www.youtube.com/watch?v=v1",
  });
  expect(json[0].el).toBeUndefined();
});

test("toCSV has header + escapes commas/quotes", () => {
  const csv = toCSV([row({ title: 'A, "B"' })]);
  const lines = csv.split("\n");
  expect(lines[0]).toBe("position,title,channel,videoId,duration,url");
  expect(lines[1]).toContain('"A, ""B"""');
});

test("toMarkdown emits a numbered list with links", () => {
  const md = toMarkdown([row({})]);
  expect(md).toBe("1. [Title](https://www.youtube.com/watch?v=v1) — Chan (3:33)");
});
