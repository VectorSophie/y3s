// Light-DOM annotations on native rows. A single injected stylesheet (the only
// way to style YouTube's own elements) plus class toggles + a checkbox affordance.

export const ANNOTATION_STYLE_ID = "y3s-annotations";

export type RowFlag = "hidden" | "dup" | "selected" | "focused";

const STYLES = `
ytd-playlist-video-renderer.y3s-row-rel { position: relative; }
.y3s-row--hidden { display: none !important; }
.y3s-row--dup { box-shadow: inset 3px 0 0 #e6a23c; border-radius: 6px; }
.y3s-row--selected { background: rgba(224,52,75,0.12) !important; box-shadow: inset 3px 0 0 #e0344b; border-radius: 6px; }
.y3s-row--focused { outline: 2px solid #4a8cff; outline-offset: -3px; border-radius: 6px; }
.y3s-check {
  position: absolute; left: 2px; top: 8px; z-index: 5;
  width: 16px; height: 16px; accent-color: #e0344b; cursor: pointer;
}
`;

export function injectAnnotationStyles(): void {
  if (document.getElementById(ANNOTATION_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = ANNOTATION_STYLE_ID;
  style.textContent = STYLES;
  document.head.append(style);
}

export function setRowClass(el: HTMLElement, flag: RowFlag, on: boolean): void {
  el.classList.toggle(`y3s-row--${flag}`, on);
}

/** Insert a selection checkbox into a row (once). Calls back with checked state. */
export function ensureCheckbox(row: HTMLElement, onToggle: (checked: boolean) => void): void {
  if (row.querySelector("input.y3s-check")) return;
  row.classList.add("y3s-row-rel");
  const box = document.createElement("input");
  box.type = "checkbox";
  box.className = "y3s-check";
  // Single click handler: stops the row's own click and reports the (already
  // toggled) checked state. Works in real browsers and jsdom alike.
  box.addEventListener("click", (e) => {
    e.stopPropagation();
    onToggle(box.checked);
  });
  row.prepend(box);
}

/** Reflect selection state into a row's checkbox + class. */
export function setRowChecked(row: HTMLElement, checked: boolean): void {
  const box = row.querySelector("input.y3s-check") as HTMLInputElement | null;
  if (box) box.checked = checked;
  setRowClass(row, "selected", checked);
}

/** Remove all y3s annotations + checkboxes from a row (teardown). */
export function clearRow(row: HTMLElement): void {
  row.querySelector("input.y3s-check")?.remove();
  row.classList.remove(
    "y3s-row-rel",
    "y3s-row--hidden",
    "y3s-row--dup",
    "y3s-row--selected",
    "y3s-row--focused",
  );
}
