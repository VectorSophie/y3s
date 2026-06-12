import { expect, test } from "vitest";
import { parseDurationText, formatSeconds } from "../src/shared/utils";

test("parseDurationText handles M:SS and H:MM:SS", () => {
  expect(parseDurationText("3:33")).toBe(213);
  expect(parseDurationText("1:02:03")).toBe(3723);
  expect(parseDurationText("0:09")).toBe(9);
});

test("parseDurationText returns undefined for junk/empty", () => {
  expect(parseDurationText(undefined)).toBeUndefined();
  expect(parseDurationText("LIVE")).toBeUndefined();
  expect(parseDurationText("")).toBeUndefined();
});

test("formatSeconds formats with/without hours", () => {
  expect(formatSeconds(213)).toBe("3:33");
  expect(formatSeconds(3723)).toBe("1:02:03");
  expect(formatSeconds(0)).toBe("0:00");
});
