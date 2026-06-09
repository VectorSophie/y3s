// Runtime-only selection state (never persisted). Tracks selected videoIds and
// the last-clicked index to support shift-range selection.

import { Emitter } from "./store";

export class SelectionStore extends Emitter<Set<string>> {
  private selected = new Set<string>();
  private lastIndex: number | null = null;

  get size(): number {
    return this.selected.size;
  }

  has(videoId: string): boolean {
    return this.selected.has(videoId);
  }

  values(): Set<string> {
    return new Set(this.selected);
  }

  /** Toggle a single row; remembers its index for later range selection. */
  toggle(videoId: string, index: number): void {
    if (this.selected.has(videoId)) this.selected.delete(videoId);
    else this.selected.add(videoId);
    this.lastIndex = index;
    this.emit(this.values());
  }

  /** Select exactly one row (plain click). */
  setSingle(videoId: string, index: number): void {
    this.selected = new Set([videoId]);
    this.lastIndex = index;
    this.emit(this.values());
  }

  /**
   * Shift-click range: select everything between the last clicked index and
   * `index` within the currently visible/ordered list.
   */
  selectRange(index: number, orderedVideoIds: string[]): void {
    const anchor = this.lastIndex ?? index;
    const [lo, hi] = anchor < index ? [anchor, index] : [index, anchor];
    for (let i = lo; i <= hi; i++) {
      const id = orderedVideoIds[i];
      if (id) this.selected.add(id);
    }
    this.lastIndex = index;
    this.emit(this.values());
  }

  /** Add a set of ids (used by drag-select). `additive` keeps the existing set. */
  applyDrag(ids: Set<string>, additive: boolean): void {
    if (!additive) this.selected = new Set();
    for (const id of ids) this.selected.add(id);
    this.emit(this.values());
  }

  selectAll(videoIds: string[]): void {
    this.selected = new Set(videoIds);
    this.emit(this.values());
  }

  clear(): void {
    if (this.selected.size === 0) return;
    this.selected = new Set();
    this.lastIndex = null;
    this.emit(this.values());
  }

  /** Drop ids that no longer exist (after a delete) without emitting noise. */
  prune(validIds: Set<string>): void {
    let changed = false;
    for (const id of this.selected) {
      if (!validIds.has(id)) {
        this.selected.delete(id);
        changed = true;
      }
    }
    if (changed) this.emit(this.values());
  }
}
