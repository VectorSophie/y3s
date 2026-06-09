// Top toolbar (search + filter chips + sort) and the sticky selection action
// bar. Both are dumb-ish views driven by callbacks; the Drawer owns state.

import { count } from "../shared/utils";
import { h, icon } from "./components";

export type FilterId = "all" | "selected" | "unphased" | "duplicates";
export type SortId = "current" | "reverse" | "title" | "channel";

const FILTERS: Array<{ id: FilterId; label: string }> = [
  { id: "all", label: "All" },
  { id: "selected", label: "Selected" },
  { id: "unphased", label: "Unphased" },
  { id: "duplicates", label: "Duplicates" },
];

const SORTS: Array<{ id: SortId; label: string }> = [
  { id: "current", label: "Current order" },
  { id: "reverse", label: "Reverse order" },
  { id: "title", label: "Title A–Z" },
  { id: "channel", label: "Channel A–Z" },
];

export interface ToolbarCallbacks {
  onSearch: (query: string) => void;
  onFilter: (filter: FilterId) => void;
  onSort: (sort: SortId) => void;
}

export class Toolbar {
  readonly el: HTMLElement;
  private input: HTMLInputElement;
  private chips = new Map<FilterId, HTMLButtonElement>();
  private sortSelect: HTMLSelectElement;

  constructor(cb: ToolbarCallbacks) {
    this.input = h("input", {
      class: "pf-search__input",
      type: "search",
      placeholder: "Search title or channel…   ( / )",
      "aria-label": "Search playlist",
      oninput: (e: Event) => cb.onSearch((e.target as HTMLInputElement).value),
    }) as HTMLInputElement;

    const search = h(
      "div",
      { class: "pf-search" },
      icon("search"),
      this.input,
    );

    const chipRow = h("div", { class: "pf-chips" });
    for (const f of FILTERS) {
      const chip = h(
        "button",
        {
          class: "pf-chip" + (f.id === "all" ? " is-active" : ""),
          onClick: () => cb.onFilter(f.id),
        },
        f.label,
        h("span", { class: "pf-chip__count" }, ""),
      ) as HTMLButtonElement;
      this.chips.set(f.id, chip);
      chipRow.append(chip);
    }

    this.sortSelect = h(
      "select",
      {
        class: "pf-sort",
        "aria-label": "Sort order",
        onchange: (e: Event) => cb.onSort((e.target as HTMLSelectElement).value as SortId),
      },
      ...SORTS.map((s) => h("option", { value: s.id }, s.label)),
    ) as HTMLSelectElement;

    this.el = h(
      "div",
      { class: "pf-toolbar" },
      search,
      h(
        "div",
        { class: "pf-toolbar__row" },
        chipRow,
        h("label", { class: "pf-sort-wrap" }, icon("sort"), this.sortSelect),
      ),
    );
  }

  focusSearch(): void {
    this.input.focus();
    this.input.select();
  }

  clearSearch(): boolean {
    if (!this.input.value) return false;
    this.input.value = "";
    this.input.dispatchEvent(new Event("input"));
    return true;
  }

  setActiveFilter(id: FilterId): void {
    for (const [key, chip] of this.chips) chip.classList.toggle("is-active", key === id);
  }

  setChipCounts(counts: Partial<Record<FilterId, number>>): void {
    for (const [id, chip] of this.chips) {
      const span = chip.querySelector(".pf-chip__count") as HTMLElement;
      const n = counts[id];
      span.textContent = n == null ? "" : String(n);
      span.style.display = n == null ? "none" : "";
    }
  }
}

export interface ActionBarCallbacks {
  onClear: () => void;
  onDelete: () => void;
  onMoveTop: () => void;
  onMoveBottom: () => void;
  onAssignPhase: (anchor: HTMLElement) => void;
}

/** Sticky bar that appears when ≥1 track is selected. */
export class ActionBar {
  readonly el: HTMLElement;
  private label: HTMLElement;

  constructor(cb: ActionBarCallbacks) {
    this.label = h("span", { class: "pf-actionbar__count" }, "0 selected");

    const assignBtn = h(
      "button",
      { class: "pf-btn pf-btn--ghost", onClick: (e: Event) => cb.onAssignPhase(e.currentTarget as HTMLElement) },
      icon("layers"),
      "Phase",
    );

    this.el = h(
      "div",
      { class: "pf-actionbar", hidden: true },
      this.label,
      h(
        "div",
        { class: "pf-actionbar__btns" },
        h("button", { class: "pf-btn pf-btn--ghost", title: "Move to top", onClick: cb.onMoveTop }, icon("top"), "Top"),
        h("button", { class: "pf-btn pf-btn--ghost", title: "Move to bottom", onClick: cb.onMoveBottom }, icon("bottom"), "Bottom"),
        assignBtn,
        h("button", { class: "pf-btn pf-btn--danger", title: "Delete selected", onClick: cb.onDelete }, icon("trash"), "Delete"),
        h("button", { class: "pf-btn pf-btn--ghost", title: "Clear selection", onClick: cb.onClear }, icon("close"), "Clear"),
      ),
    );
  }

  setCount(n: number): void {
    this.label.textContent = `${count(n, "track")} selected`;
    this.el.toggleAttribute("hidden", n === 0);
  }
}
