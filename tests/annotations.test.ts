import { beforeEach, expect, test } from "vitest";
import { injectAnnotationStyles, setRowClass, ensureCheckbox, ANNOTATION_STYLE_ID } from "../src/content/annotations";

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

test("injectAnnotationStyles adds one stylesheet, idempotently", () => {
  injectAnnotationStyles();
  injectAnnotationStyles();
  expect(document.querySelectorAll(`#${ANNOTATION_STYLE_ID}`)).toHaveLength(1);
});

test("setRowClass toggles a class on the row element", () => {
  const el = document.createElement("div");
  setRowClass(el, "selected", true);
  expect(el.classList.contains("y3s-row--selected")).toBe(true);
  setRowClass(el, "selected", false);
  expect(el.classList.contains("y3s-row--selected")).toBe(false);
});

test("ensureCheckbox inserts one checkbox and calls back on change", () => {
  const el = document.createElement("div");
  let toggled = false;
  ensureCheckbox(el, () => (toggled = true));
  ensureCheckbox(el, () => {}); // idempotent
  const boxes = el.querySelectorAll("input.y3s-check");
  expect(boxes).toHaveLength(1);
  (boxes[0] as HTMLInputElement).click();
  expect(toggled).toBe(true);
});
