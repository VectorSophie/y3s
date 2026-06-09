// Alt-drag rubber-band selection over the track list. Only engages while Alt is
// held on mousedown, so normal scrolling and clicking are never disrupted.

import { h } from "./components";

interface Target {
  el: HTMLElement;
  videoId: string;
}

export interface DragSelectOptions {
  surface: HTMLElement;
  getTargets: () => Target[];
  onSelect: (ids: Set<string>, additive: boolean) => void;
}

export function enableDragSelect(opts: DragSelectOptions): () => void {
  const { surface } = opts;
  let rect: HTMLElement | null = null;
  let startX = 0;
  let startY = 0;
  let additive = false;

  const onDown = (e: MouseEvent) => {
    // Require Alt; ignore clicks on interactive controls.
    if (!e.altKey || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, input, a, select")) return;

    e.preventDefault();
    additive = e.shiftKey || e.metaKey || e.ctrlKey;
    startX = e.clientX;
    startY = e.clientY;

    rect = h("div", { class: "pf-marquee" });
    surface.append(rect);
    surface.classList.add("pf-list--dragging");

    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("mouseup", onUp, true);
  };

  const onMove = (e: MouseEvent) => {
    if (!rect) return;
    const left = Math.min(startX, e.clientX);
    const top = Math.min(startY, e.clientY);
    const right = Math.max(startX, e.clientX);
    const bottom = Math.max(startY, e.clientY);

    const sRect = surface.getBoundingClientRect();
    Object.assign(rect.style, {
      left: `${left - sRect.left + surface.scrollLeft}px`,
      top: `${top - sRect.top + surface.scrollTop}px`,
      width: `${right - left}px`,
      height: `${bottom - top}px`,
    });

    const hits = new Set<string>();
    for (const t of opts.getTargets()) {
      const r = t.el.getBoundingClientRect();
      const intersects = r.left < right && r.right > left && r.top < bottom && r.bottom > top;
      if (intersects) hits.add(t.videoId);
    }
    opts.onSelect(hits, additive);
  };

  const onUp = () => {
    rect?.remove();
    rect = null;
    surface.classList.remove("pf-list--dragging");
    window.removeEventListener("mousemove", onMove, true);
    window.removeEventListener("mouseup", onUp, true);
  };

  surface.addEventListener("mousedown", onDown);
  return () => {
    surface.removeEventListener("mousedown", onDown);
    onUp();
  };
}
