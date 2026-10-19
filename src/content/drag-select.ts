// Press the left mouse button on a row and drag to select a range of rows,
// with a selection rectangle and auto-scroll at the screen edges. A click that
// doesn't move still opens the video; YouTube's own reorder handle and menu
// buttons are left alone. Ctrl/Cmd/Shift while starting adds to the selection.

import { h } from "./ui/dom";
import { SEL } from "./yt-dom";

/** Where a drag must not start: controls and YouTube's own drag handle. */
const EXCLUDE = [
  "button:not(.y3s-cb)",
  "input",
  "textarea",
  "[contenteditable]",
  "#index-container",
  "#reorder",
  "ytd-menu-renderer",
  "#menu",
  "yt-icon-button",
].join(", ");

const THRESHOLD = 6; // px before a press becomes a drag
const EDGE = 48; // px from the top/bottom edge where auto-scroll kicks in
const MAX_SPEED = 28; // px per frame

/** Indexes of the boxes overlapping the vertical band [y1, y2] (page coordinates). */
export function rowsInBand(boxes: { top: number; bottom: number }[], y1: number, y2: number): number[] {
  const lo = Math.min(y1, y2);
  const hi = Math.max(y1, y2);
  const out: number[] = [];
  boxes.forEach((b, i) => {
    if (b.bottom > b.top && b.bottom > lo && b.top < hi) out.push(i);
  });
  return out;
}

/** Scroll speed for a pointer at clientY: negative near the top, positive near the bottom. */
export function edgeSpeed(clientY: number, top: number, bottom: number): number {
  if (clientY < top + EDGE) return -Math.ceil(MAX_SPEED * Math.min(1, (top + EDGE - clientY) / EDGE));
  if (clientY > bottom - EDGE) return Math.ceil(MAX_SPEED * Math.min(1, (clientY - (bottom - EDGE)) / EDGE));
  return 0;
}

export interface DragHost {
  /** Rows that can be selected right now (visible ones). */
  rows(): HTMLElement[];
  /** Height covered at the top of the window (masthead + sticky bar). */
  topInset(): number;
  begin(additive: boolean): void;
  update(hit: HTMLElement[]): void;
  end(): void;
  cancel(): void;
}

export class DragSelect {
  private press: { x: number; y: number; additive: boolean } | null = null;
  private active = false;
  private pointer = { x: 0, y: 0 };
  private box: HTMLElement | null = null;
  private raf = 0;

  constructor(
    private root: HTMLElement,
    private host: DragHost,
  ) {
    root.addEventListener("pointerdown", this.onDown);
    root.addEventListener("dragstart", this.onDragStart, true);
  }

  get dragging(): boolean {
    return this.active;
  }

  destroy(): void {
    this.stop(true);
    this.root.removeEventListener("pointerdown", this.onDown);
    this.root.removeEventListener("dragstart", this.onDragStart, true);
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0 || e.pointerType === "touch") return;
    const t = e.target as Element | null;
    if (!t || t.closest(EXCLUDE) || !t.closest(SEL.playlistRow)) return;
    this.press = { x: e.clientX, y: e.clientY + scrollY, additive: e.ctrlKey || e.metaKey || e.shiftKey };
    this.pointer = { x: e.clientX, y: e.clientY };
    window.addEventListener("pointermove", this.onMove, true);
    window.addEventListener("pointerup", this.onUp, true);
    window.addEventListener("pointercancel", this.onCancel, true);
    window.addEventListener("keydown", this.onKey, true);
  };

  // Links and thumbnails would otherwise start a native drag and swallow the
  // pointer events.
  private onDragStart = (e: DragEvent) => {
    if (this.press) e.preventDefault();
  };

  private onMove = (e: PointerEvent) => {
    if (!this.press) return;
    this.pointer = { x: e.clientX, y: e.clientY };
    if (!this.active) {
      if (Math.hypot(e.clientX - this.press.x, e.clientY + scrollY - this.press.y) < THRESHOLD) return;
      this.active = true;
      document.documentElement.classList.add("y3s-dragging");
      window.getSelection()?.removeAllRanges();
      this.box = h("div", { class: "y3s-marquee", "aria-hidden": "true" });
      document.body.append(this.box);
      this.host.begin(this.press.additive);
      this.raf = requestAnimationFrame(this.tick);
    }
    e.preventDefault();
    this.paint();
  };

  private tick = () => {
    if (!this.active) return;
    const v = edgeSpeed(this.pointer.y, this.host.topInset(), innerHeight);
    if (v) {
      scrollBy(0, v);
      this.paint();
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  private paint(): void {
    if (!this.press || !this.box) return;
    const x2 = this.pointer.x;
    const y2 = this.pointer.y + scrollY;
    const left = Math.min(this.press.x, x2);
    const top = Math.min(this.press.y, y2);
    Object.assign(this.box.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${Math.abs(x2 - this.press.x)}px`,
      height: `${Math.abs(y2 - this.press.y)}px`,
    });
    const rows = this.host.rows();
    const boxes = rows.map((r) => {
      const b = r.getBoundingClientRect();
      return { top: b.top + scrollY, bottom: b.bottom + scrollY };
    });
    this.host.update(rowsInBand(boxes, this.press.y, y2).map((i) => rows[i]));
  }

  private onUp = () => {
    const wasActive = this.active;
    this.stop(false);
    if (wasActive) {
      // The click that follows this mouseup must not open a video.
      const swallow = (ev: Event) => {
        ev.preventDefault();
        ev.stopImmediatePropagation();
      };
      window.addEventListener("click", swallow, true);
      setTimeout(() => window.removeEventListener("click", swallow, true), 0);
      this.host.end();
    }
  };

  private onCancel = () => this.stop(true);

  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.active) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.stop(true);
    }
  };

  private stop(cancel: boolean): void {
    const wasActive = this.active;
    this.press = null;
    this.active = false;
    cancelAnimationFrame(this.raf);
    this.box?.remove();
    this.box = null;
    document.documentElement.classList.remove("y3s-dragging");
    window.removeEventListener("pointermove", this.onMove, true);
    window.removeEventListener("pointerup", this.onUp, true);
    window.removeEventListener("pointercancel", this.onCancel, true);
    window.removeEventListener("keydown", this.onKey, true);
    if (cancel && wasActive) this.host.cancel();
  }
}
