// The scrollable track table. Renders an ordered mix of phase headers and
// track rows. Owns row DOM so selection updates and drag-select hit-testing
// stay cheap (no full re-render on selection change).

import type { Phase, Track } from "../shared/types";
import { count } from "../shared/utils";
import { h, icon } from "./components";

export type DisplayItem =
  | { kind: "header"; phase: Phase | null; trackCount: number; collapsed: boolean }
  | { kind: "track"; track: Track; index: number; phase?: Phase };

export interface RowModifiers {
  shift: boolean;
  meta: boolean;
}

export interface TrackListCallbacks {
  onRowClick: (videoId: string, index: number, mods: RowModifiers) => void;
  onCheckbox: (videoId: string, index: number) => void;
  onOpen: (track: Track) => void;
  onToggleCollapse: (phaseId: string) => void;
  onRenamePhase: (phaseId: string) => void;
  onDeletePhase: (phaseId: string) => void;
}

interface RowHandle {
  el: HTMLElement;
  index: number;
  videoId: string;
}

export class TrackList {
  readonly el: HTMLElement;
  private rows = new Map<string, RowHandle>();

  constructor(private cb: TrackListCallbacks) {
    this.el = h("div", { class: "pf-list", tabindex: "0" });
  }

  /** Rebuild rows for a new data/search/filter/phase state. */
  render(items: DisplayItem[], selected: Set<string>): void {
    this.rows.clear();
    this.el.replaceChildren();

    if (items.length === 0) {
      this.el.append(
        h(
          "div",
          { class: "pf-empty" },
          h("div", { class: "pf-empty__title" }, "Nothing here"),
          h("div", { class: "pf-empty__hint" }, "No tracks match the current search or filter."),
        ),
      );
      return;
    }

    const frag = document.createDocumentFragment();
    for (const item of items) {
      frag.append(
        item.kind === "header" ? this.renderHeader(item) : this.renderRow(item, selected),
      );
    }
    this.el.append(frag);
  }

  /** Cheap selection refresh — toggle classes/checkboxes on existing rows. */
  updateSelection(selected: Set<string>): void {
    for (const [videoId, handle] of this.rows) {
      const on = selected.has(videoId);
      handle.el.classList.toggle("is-selected", on);
      const box = handle.el.querySelector(".pf-row__check") as HTMLInputElement | null;
      if (box) box.checked = on;
    }
  }

  /** Hit targets for drag-select: visible rows with their bounding rects. */
  hitTargets(): RowHandle[] {
    return [...this.rows.values()];
  }

  private renderHeader(item: Extract<DisplayItem, { kind: "header" }>): HTMLElement {
    const { phase, trackCount, collapsed } = item;
    const dot = h("span", {
      class: "pf-phase__dot",
      style: `background:${phase?.color ?? "var(--pf-muted)"}`,
    });

    const controls = phase
      ? h(
          "div",
          { class: "pf-phase__controls" },
          h("button", { class: "pf-iconbtn", title: "Rename phase", onClick: () => this.cb.onRenamePhase(phase.id) }, icon("link")),
          h("button", { class: "pf-iconbtn", title: "Delete phase", onClick: () => this.cb.onDeletePhase(phase.id) }, icon("trash")),
        )
      : null;

    const chevron = icon("chevron");
    chevron.classList.toggle("is-collapsed", collapsed);

    return h(
      "div",
      {
        class: "pf-phase" + (phase ? "" : " pf-phase--unphased"),
        onClick: () => phase && this.cb.onToggleCollapse(phase.id),
      },
      chevron,
      dot,
      h("span", { class: "pf-phase__title" }, phase?.title ?? "Unphased"),
      h("span", { class: "pf-phase__count" }, count(trackCount, "track")),
      controls,
    );
  }

  private renderRow(
    item: Extract<DisplayItem, { kind: "track" }>,
    selected: Set<string>,
  ): HTMLElement {
    const { track, index, phase } = item;
    const isSel = selected.has(track.videoId);

    const checkbox = h("input", {
      class: "pf-row__check",
      type: "checkbox",
      checked: isSel,
      "aria-label": `Select ${track.title}`,
      onclick: (e: Event) => {
        e.stopPropagation();
        this.cb.onCheckbox(track.videoId, index);
      },
    }) as HTMLInputElement;

    const num = h("span", { class: "pf-row__num" }, String(track.position + 1));

    const thumb = track.thumbnailUrl
      ? h("img", { class: "pf-row__thumb", src: track.thumbnailUrl, alt: "", loading: "lazy" })
      : h("div", { class: "pf-row__thumb pf-row__thumb--empty" }, icon("logo"));

    const meta = h(
      "div",
      { class: "pf-row__meta" },
      h("div", { class: "pf-row__title", title: track.title }, track.title),
      h(
        "div",
        { class: "pf-row__channel" },
        phase ? h("span", { class: "pf-row__phasedot", style: `background:${phase.color}` }) : null,
        track.channelTitle ?? "Unknown channel",
      ),
    );

    const right = h(
      "div",
      { class: "pf-row__right" },
      track.durationText ? h("span", { class: "pf-row__dur" }, track.durationText) : null,
      h(
        "button",
        {
          class: "pf-iconbtn pf-row__open",
          title: "Open on YouTube",
          onclick: (e: Event) => {
            e.stopPropagation();
            this.cb.onOpen(track);
          },
        },
        icon("link"),
      ),
    );

    const row = h(
      "div",
      {
        class: "pf-row" + (isSel ? " is-selected" : ""),
        "data-video-id": track.videoId,
        onClick: (e: Event) => {
          const m = e as MouseEvent;
          this.cb.onRowClick(track.videoId, index, { shift: m.shiftKey, meta: m.ctrlKey || m.metaKey });
        },
      },
      h("div", { class: "pf-row__lead" }, num, checkbox),
      thumb,
      meta,
      right,
    );

    this.rows.set(track.videoId, { el: row, index, videoId: track.videoId });
    return row;
  }
}
