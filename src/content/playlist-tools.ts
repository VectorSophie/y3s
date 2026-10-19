// Tools added to YouTube's own playlist page: a filter bar with chips and
// sort, hover checkboxes and drag-select with a selection bar, collapsible
// phases, keyboard navigation, and edits that apply on the page at once and
// are saved to YouTube after an undo window.

import {
  duplicateIds,
  extraCopies,
  formatTotal,
  isUnavailableTitle,
  isVisible,
  sortOrder,
  SORTS,
  type Chip,
  type SortKey,
} from "../core/filter";
import { inPlaylistOrder, matchRows } from "../core/match";
import {
  anchorsOf,
  isPhase,
  marker,
  moveRows,
  movePhase,
  phaseFromRows,
  phaseId,
  placeAnchors,
  removePhase,
  sections,
  sortSection,
  splitEvery,
  startPhaseAt,
  type Anchor,
} from "../core/phases";
import { applyChanges, planChanges, type ServerItem } from "../core/plan";
import { CONFIRM_WRITES_OVER, DAILY_QUOTA, MAX_QUEUE_IDS, QUOTA_COST, SAVE_DELAY_MS } from "../shared/constants";
import type { ApiError, Change } from "../shared/types";
import { count, messageForError } from "../shared/utils";
import { chromeBackend, type Backend, type ServerTrack } from "./backend";
import { DragSelect } from "./drag-select";
import { loadPhases, savePhases, type StoredAnchor, type StoredPhase } from "./phase-store";
import { confirmDialog, isDialogOpen, openHelp } from "./ui/dialog";
import { h, icon, ICONS, isEditable } from "./ui/dom";
import { closeMenu, isMenuOpen, toggleMenu, type MenuItem } from "./ui/menu";
import { showSnack } from "./ui/snackbar";
import { currentPlaylistId, readRow, SEL, type Row } from "./yt-dom";

export type Access = "checking" | "unconfigured" | "signed-out" | "view-only" | "editable" | "error";

interface PhaseMeta {
  name: string;
  collapsed: boolean;
}

interface Snapshot {
  seq: string[];
  phases: [string, PhaseMeta][];
  removed: HTMLElement[];
  extraRemoved: string[];
  sortKey: SortKey;
}

const ITEM = "y3sItem"; // dataset: playlistItemId of a row
const ORIG = "y3sOrig"; // dataset: row's position in YouTube's own view
const KEY = "y3sKey"; // dataset: key of a row or phase divider in sequences

const SPLIT_SIZES = [25, 50, 100];

export class PlaylistTools {
  readonly list: HTMLElement;
  readonly contents: HTMLElement;
  playlistId: string | null;
  access: Access = "checking";

  private query = "";
  private chip: Chip = "all";
  private sortKey: SortKey = "manual";
  private selected = new Set<HTMLElement>();
  private focusRow: HTMLElement | null = null;
  private anchorRow: HTMLElement | null = null;
  private data = new Map<HTMLElement, Row>();
  private dups = new Set<string>();
  private seq = 0;
  private obs: MutationObserver;
  private refreshTimer = 0;
  private drag: DragSelect;
  private dragBase = new Set<HTMLElement>();

  // phases
  private phases = new Map<string, PhaseMeta>();
  private phaseEls = new Map<string, HTMLElement>();
  private pendingPhases: StoredPhase[] = [];
  /** Last full set of placed dividers, to put back any YouTube re-render drops. */
  private lastStored: StoredPhase[] = [];
  private phasesLoaded = false;
  private persistTimer = 0;
  private phaseSeq = 0;

  // syncing with YouTube
  private accessError = "";
  private server: ServerItem[] | null = null;
  private serverTitles = new Map<string, string>();
  private hiddenUnavailable: string[] = [];
  private extraRemoved = new Set<string>();
  private manualView = true;
  private savedOnce = false;
  private history: Snapshot[] = [];
  private savedSnap: Snapshot | null = null;
  private saveTimer = 0;
  private saving: Promise<void> | null = null;
  private resave = false;
  private blocked = false;
  private loading = false;
  private generation = 0;

  // UI
  readonly bar: HTMLElement;
  readonly empty: HTMLElement;
  private searchInput!: HTMLInputElement;
  private clearBtn!: HTMLElement;
  private chipEls!: Record<Chip, HTMLElement>;
  private sortChip!: HTMLElement;
  private sortLabel!: HTMLElement;
  private phasesChip!: HTMLElement;
  private phasesLabel!: HTMLElement;
  private chipAction!: HTMLButtonElement;
  private statsText!: HTMLElement;
  private loadAllBtn!: HTMLButtonElement;
  private accountBtn!: HTMLButtonElement;
  private selCount!: HTMLElement;
  private selectAllBtn!: HTMLButtonElement;
  private moveBtns!: HTMLButtonElement[];
  private removeBtn!: HTMLButtonElement;
  private toPhaseBtn!: HTMLButtonElement;

  constructor(list: HTMLElement, private backend: Backend = chromeBackend) {
    this.list = list;
    this.contents = list.querySelector<HTMLElement>("#contents") ?? list;
    this.playlistId = currentPlaylistId();
    this.bar = this.buildBar();
    this.empty = h(
      "div",
      { class: "y3s-empty", hidden: true },
      h("p", { class: "y3s-empty-title", text: "No videos match" }),
      h("button", { class: "y3s-btn", text: "Clear filters", onclick: () => this.clearFilters() }),
    );
    list.before(this.bar, this.empty);
    this.obs = new MutationObserver(() => {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = window.setTimeout(() => this.refresh(), 100);
    });
    this.obs.observe(this.contents, { childList: true });
    this.drag = new DragSelect(this.contents, {
      rows: () => this.visibleRows(),
      topInset: () => Math.max(56, this.bar.getBoundingClientRect().bottom),
      begin: (additive) => {
        this.dragBase = additive ? new Set(this.selected) : new Set();
        closeMenu();
      },
      update: (hit) => {
        this.selected = new Set([...this.dragBase, ...hit]);
        this.anchorRow = hit.at(-1) ?? this.anchorRow;
        this.render();
      },
      end: () => this.render(),
      cancel: () => {
        this.selected = new Set(this.dragBase);
        this.render();
      },
    });
    this.refresh();
    void this.loadStoredPhases();
    void this.loadAccess();
  }

  destroy(): void {
    this.flushOnLeave();
    this.persistNow();
    this.generation++;
    this.obs.disconnect();
    this.drag.destroy();
    clearTimeout(this.refreshTimer);
    this.bar.remove();
    this.empty.remove();
    this.list.classList.remove("y3s-selecting");
    for (const el of this.phaseEls.values()) el.remove();
    for (const r of this.rows()) {
      r.querySelector(":scope > .y3s-cbwrap")?.remove();
      r.classList.remove("y3s-row", "y3s-hidden", "y3s-removed", "y3s-selected", "y3s-focus", "y3s-collapsed");
    }
    closeMenu();
  }

  /** YouTube reuses the page for a different playlist: start over. */
  checkPlaylistId(): void {
    const id = currentPlaylistId();
    if (id === this.playlistId) return;
    this.flushOnLeave();
    this.persistNow();
    this.generation++;
    this.playlistId = id;
    Object.assign(this, {
      query: "",
      chip: "all",
      sortKey: "manual",
      focusRow: null,
      anchorRow: null,
      server: null,
      hiddenUnavailable: [],
      manualView: true,
      savedOnce: false,
      history: [],
      savedSnap: null,
      blocked: false,
      access: "checking",
      pendingPhases: [],
      phasesLoaded: false,
    });
    this.selected.clear();
    this.extraRemoved.clear();
    for (const el of this.phaseEls.values()) el.remove();
    this.phaseEls.clear();
    this.phases.clear();
    this.searchInput.value = "";
    for (const r of this.rows()) {
      delete r.dataset[ITEM];
      delete r.dataset[ORIG];
    }
    this.updateSortLabel();
    this.refresh();
    void this.loadStoredPhases();
    void this.loadAccess();
  }

  // ───────────────────────────────────────────────────────────── data

  rows(): HTMLElement[] {
    return [...this.contents.children].filter((el): el is HTMLElement => el.matches(SEL.playlistRow));
  }
  private live = (r: HTMLElement) => !r.classList.contains("y3s-removed");
  /** Rows the user can see and act on (not filtered out, removed or folded away). */
  visibleRows(): HTMLElement[] {
    return this.rows().filter(
      (r) => this.live(r) && !r.classList.contains("y3s-hidden") && !r.classList.contains("y3s-collapsed"),
    );
  }
  private continuation(): Element | null {
    return this.contents.querySelector(`:scope > ${SEL.continuation}`);
  }
  private get canEdit() {
    return this.access === "editable" && !this.blocked;
  }
  private get canReorder() {
    return this.canEdit && this.manualView;
  }
  private get filtering() {
    return !!this.query.trim() || this.chip !== "all";
  }

  private decorate(row: HTMLElement): void {
    if (row.dataset[ORIG] == null) row.dataset[ORIG] = String(this.seq++);
    if (row.dataset[KEY] == null) row.dataset[KEY] = `r${row.dataset[ORIG]}`;
    row.classList.add("y3s-row");
    if (row.querySelector(":scope > .y3s-cbwrap")) return;
    const cb = h("span", { class: "y3s-cb", role: "checkbox", "aria-checked": "false", "aria-label": "Select video" });
    cb.append(icon(ICONS.check));
    const wrap = h("div", { class: "y3s-cbwrap" }, cb);
    wrap.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleRow(row, e.shiftKey);
    });
    row.prepend(wrap);
  }

  refresh(): void {
    const rows = this.rows();
    rows.forEach((r) => this.decorate(r));
    this.data = new Map(rows.map((r) => [r, readRow(r)]));
    for (const r of this.selected) if (!r.isConnected || !this.live(r)) this.selected.delete(r);
    this.matchToServer();
    this.placePendingPhases();
    this.dups = duplicateIds(rows.filter(this.live).map((r) => this.data.get(r)!));
    this.applyFilter();
    this.render();
  }

  /** Link newly seen rows to playlist items from the API. */
  private matchToServer(): void {
    if (!this.server) return;
    const byOrig = this.rows().sort((a, b) => Number(a.dataset[ORIG]) - Number(b.dataset[ORIG]));
    const taken = new Set(byOrig.map((r) => r.dataset[ITEM]).filter(Boolean));
    const fresh = byOrig.filter((r) => !r.dataset[ITEM]);
    if (fresh.length) {
      const free = this.server.filter((s) => !taken.has(s.playlistItemId));
      const ids = matchRows(
        fresh.map((r) => this.data.get(r)!.videoId),
        free,
      );
      fresh.forEach((r, i) => {
        if (ids[i]) r.dataset[ITEM] = ids[i]!;
      });
    }
    const matched = byOrig.map((r) => r.dataset[ITEM] ?? null);
    if (!this.savedOnce) this.manualView = inPlaylistOrder(matched, this.server);

    // Unavailable videos YouTube hides from the page.
    const shownIds = new Set(matched.filter(Boolean));
    const pos = new Map(this.server.map((s, i) => [s.playlistItemId, i]));
    const lastShown = Math.max(-1, ...[...shownIds].map((id) => pos.get(id!) ?? -1));
    const done = !this.continuation();
    this.hiddenUnavailable = this.server
      .filter((s, i) => !shownIds.has(s.playlistItemId) && (done || i < lastShown))
      .filter((s) => isUnavailableTitle(this.serverTitles.get(s.playlistItemId) ?? ""))
      .map((s) => s.playlistItemId);
  }

  private applyFilter(): void {
    const folded = new Set([...this.phases].filter(([, p]) => p.collapsed).map(([id]) => id));
    let cur: string | null = null;
    for (const el of this.contents.children) {
      const k = (el as HTMLElement).dataset?.[KEY];
      if (k && isPhase(k)) {
        cur = phaseId(k);
        continue;
      }
      const d = this.data.get(el as HTMLElement);
      if (!d) continue;
      el.classList.toggle("y3s-hidden", !isVisible(d, this.query, this.chip, this.dups));
      // While filtering, matches show even inside folded phases.
      el.classList.toggle("y3s-collapsed", !this.filtering && cur !== null && folded.has(cur));
    }
    if (this.focusRow && !this.visibleRows().includes(this.focusRow)) this.setFocus(null);
  }

  // ─────────────────────────────────────────────────────── sequences

  /** Rows and phase dividers in page order, as keys. */
  private seqNow(): string[] {
    return [...this.contents.children]
      .map((el) => (el as HTMLElement).dataset?.[KEY])
      .filter((k): k is string => !!k && (isPhase(k) || k.startsWith("r")));
  }
  private keyOf = (el: HTMLElement) => el.dataset[KEY]!;
  private elByKey(): Map<string, HTMLElement> {
    const m = new Map<string, HTMLElement>();
    for (const el of this.contents.children) {
      const k = (el as HTMLElement).dataset?.[KEY];
      if (k) m.set(k, el as HTMLElement);
    }
    for (const [id, el] of this.phaseEls) m.set(marker(id), el);
    return m;
  }
  /** Put rows and dividers in this order (anything not listed stays put). */
  private applySeq(seq: string[]): void {
    const els = this.elByKey();
    const end = this.continuation();
    for (const k of seq) {
      const el = els.get(k);
      if (el) this.contents.insertBefore(el, end);
    }
    for (const el of this.phaseEls.values()) if (!seq.includes(this.keyOf(el))) el.remove();
  }

  // ─────────────────────────────────────────────────────────────── UI

  private buildBar(): HTMLElement {
    this.searchInput = h("input", {
      type: "text",
      placeholder: "Filter this playlist",
      "aria-label": "Filter this playlist",
      spellcheck: "false",
      autocomplete: "off",
      oninput: () => {
        this.query = this.searchInput.value;
        this.applyFilter();
        this.render();
      },
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === "ArrowDown") {
          e.preventDefault();
          this.searchInput.blur();
          this.setFocus(this.visibleRows()[0] ?? null);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          if (this.searchInput.value) this.clearQuery();
          else this.searchInput.blur();
        }
      },
    });
    this.clearBtn = h(
      "button",
      { class: "y3s-icon-btn y3s-clear", "aria-label": "Clear filter", onclick: () => this.clearQuery() },
      icon(ICONS.close),
    );
    const search = h(
      "div",
      { class: "y3s-search", onclick: () => this.searchInput.focus() },
      icon(ICONS.search),
      this.searchInput,
      this.clearBtn,
    );

    const chip = (key: Chip, label: string) =>
      h("button", { class: "y3s-chip", "aria-pressed": "false", onclick: () => this.setChip(key) }, label);
    this.chipEls = { all: chip("all", "All"), dups: chip("dups", "Duplicates"), unavail: chip("unavail", "Unavailable") };
    this.sortLabel = h("span", { text: "Sort" });
    this.sortChip = h(
      "button",
      { class: "y3s-chip y3s-chip-icon", "aria-haspopup": "menu", onclick: () => this.openSort() },
      icon(ICONS.sort),
      this.sortLabel,
    );
    this.phasesLabel = h("span", { text: "Phases" });
    this.phasesChip = h(
      "button",
      { class: "y3s-chip y3s-chip-icon", "aria-haspopup": "menu", onclick: () => this.openPhasesMenu() },
      icon(ICONS.phases),
      this.phasesLabel,
    );
    this.chipAction = h("button", { class: "y3s-btn y3s-btn-text", onclick: () => this.runChipAction() });

    this.statsText = h("span");
    this.loadAllBtn = h("button", { class: "y3s-link", text: "Load all", onclick: () => void this.loadAll() });
    this.accountBtn = h("button", { class: "y3s-link", onclick: () => void this.signIn() });
    const helpBtn = h(
      "button",
      { class: "y3s-icon-btn", "aria-label": "Keyboard shortcuts", title: "Keyboard shortcuts (?)", onclick: openHelp },
      icon(ICONS.keyboard),
    );

    const normal = h(
      "div",
      { class: "y3s-bar-normal" },
      h(
        "div",
        { class: "y3s-bar-row" },
        search,
        h("div", { class: "y3s-stats" }, this.statsText, this.loadAllBtn, this.accountBtn, helpBtn),
      ),
      h(
        "div",
        { class: "y3s-chips", role: "toolbar", "aria-label": "Filters" },
        this.chipEls.all,
        this.chipEls.dups,
        this.chipEls.unavail,
        h("span", { class: "y3s-chip-sep" }),
        this.sortChip,
        this.phasesChip,
        this.chipAction,
      ),
    );

    this.selCount = h("span", { class: "y3s-sel-count" });
    const act = (label: string, ic: string, fn: (e: MouseEvent) => void) =>
      h("button", { class: "y3s-btn", onclick: fn }, icon(ic), h("span", { text: label }));
    this.selectAllBtn = h("button", { class: "y3s-btn y3s-btn-text", onclick: () => this.selectAllVisible() });
    this.moveBtns = [
      act("Move to top", ICONS.top, () => void this.moveTo("top")),
      act("Move to bottom", ICONS.bottom, () => void this.moveTo("bottom")),
    ];
    this.toPhaseBtn = act("Move to phase", ICONS.phases, () => this.openMoveToPhase(this.toPhaseBtn));
    this.removeBtn = act("Remove", ICONS.trash, () => this.removeSelected());
    const selecting = h(
      "div",
      { class: "y3s-bar-select" },
      h(
        "button",
        { class: "y3s-icon-btn", "aria-label": "Clear selection", onclick: () => this.clearSelection() },
        icon(ICONS.close),
      ),
      this.selCount,
      this.selectAllBtn,
      h(
        "div",
        { class: "y3s-sel-actions" },
        act("Play", ICONS.play, () => this.playSelected()),
        ...this.moveBtns,
        this.toPhaseBtn,
        this.removeBtn,
      ),
    );
    return h("div", { class: "y3s-bar" }, normal, selecting);
  }

  render(): void {
    const all = this.rows();
    const live = all.filter(this.live);
    const vis = live.filter((r) => !r.classList.contains("y3s-hidden"));
    const total = live.reduce((s, r) => s + (this.data.get(r)?.duration ?? 0), 0);
    const filtering = this.filtering;
    const more = !!this.continuation();
    const hidden = this.hiddenUnavailable.filter((id) => !this.extraRemoved.has(id)).length;
    const unavail = live.filter((r) => this.data.get(r)?.unavailable).length + hidden;
    const dupRows = live.filter((r) => this.dups.has(this.data.get(r)?.videoId ?? "")).length;

    this.statsText.textContent = filtering
      ? `${vis.length} of ${live.length}${more ? "+" : ""} videos`
      : `${count(live.length, "video")}${more ? "+" : ""} · ${formatTotal(total)}`;
    this.loadAllBtn.hidden = !more || this.loading;
    this.clearBtn.hidden = !this.query;

    const acct: Partial<Record<Access, string>> = {
      "signed-out": "Sign in to edit",
      "view-only": "View only",
      error: "Retry",
    };
    this.accountBtn.hidden = !acct[this.access];
    this.accountBtn.textContent = acct[this.access] ?? "";
    this.accountBtn.disabled = this.access === "view-only";
    this.accountBtn.title =
      this.access === "view-only" ? "You can filter, sort and section this playlist, but only its owner can change it" : "";

    this.chipEls.dups.textContent = dupRows ? `Duplicates · ${dupRows}` : "Duplicates";
    this.chipEls.unavail.textContent = unavail ? `Unavailable · ${unavail}` : "Unavailable";
    for (const [k, el] of Object.entries(this.chipEls)) el.setAttribute("aria-pressed", String(this.chip === k));
    this.phasesLabel.textContent = this.phases.size ? `Phases · ${this.phases.size}` : "Phases";

    const canRemove = this.access !== "view-only";
    if (this.chip === "dups" && this.dups.size && canRemove) {
      this.chipAction.hidden = false;
      this.chipAction.textContent = "Remove extra copies";
    } else if (this.chip === "unavail" && unavail && canRemove) {
      this.chipAction.hidden = false;
      this.chipAction.textContent = `Remove ${unavail} unavailable`;
    } else this.chipAction.hidden = true;

    this.empty.hidden = !(filtering && vis.length === 0 && !(this.chip === "unavail" && hidden));

    const n = this.selected.size;
    this.bar.classList.toggle("y3s-selecting", n > 0);
    this.list.classList.toggle("y3s-selecting", n > 0);
    this.selCount.textContent = `${n} selected`;
    const shown = this.visibleRows();
    const unselected = shown.filter((r) => !this.selected.has(r)).length;
    this.selectAllBtn.hidden = unselected === 0;
    this.selectAllBtn.textContent = filtering ? `Select all ${shown.length} matching` : `Select all ${shown.length}`;
    for (const b of [...this.moveBtns, this.removeBtn]) b.hidden = this.access === "view-only";
    this.toPhaseBtn.hidden = this.phases.size === 0;
    for (const b of this.moveBtns) {
      const off = this.access === "editable" && !this.manualView;
      b.setAttribute("aria-disabled", String(off));
      b.title = off ? "Set the playlist's Sort to Manual on YouTube to reorder" : "";
    }
    for (const r of all) {
      const on = this.selected.has(r);
      r.classList.toggle("y3s-selected", on);
      r.querySelector(":scope > .y3s-cbwrap > .y3s-cb")?.setAttribute("aria-checked", String(on));
    }
    this.renderPhases();
  }

  private setChip(k: Chip): void {
    this.chip = this.chip === k && k !== "all" ? "all" : k;
    this.applyFilter();
    this.render();
  }
  private clearQuery(): void {
    this.searchInput.value = this.query = "";
    this.applyFilter();
    this.render();
  }
  clearFilters(): void {
    this.chip = "all";
    this.clearQuery();
  }
  setQuery(q: string): void {
    this.searchInput.value = this.query = q;
    this.applyFilter();
    this.render();
  }

  // ─────────────────────────────────────────────── selection and focus

  toggleRow(row: HTMLElement, range = false): void {
    const vis = this.visibleRows();
    if (range && this.anchorRow && vis.includes(this.anchorRow) && vis.includes(row)) {
      const [a, b] = [vis.indexOf(this.anchorRow), vis.indexOf(row)].sort((x, y) => x - y);
      const on = !this.selected.has(row);
      for (const r of vis.slice(a, b + 1)) on ? this.selected.add(r) : this.selected.delete(r);
    } else if (this.selected.has(row)) this.selected.delete(row);
    else this.selected.add(row);
    this.anchorRow = row;
    this.setFocus(row, false);
    this.render();
  }
  clearSelection(): void {
    this.selected.clear();
    this.render();
  }
  selectAllVisible(): void {
    for (const r of this.visibleRows()) this.selected.add(r);
    this.render();
  }
  private setFocus(row: HTMLElement | null, scroll = true): void {
    this.focusRow?.classList.remove("y3s-focus");
    this.focusRow = row;
    if (!row) return;
    row.classList.add("y3s-focus");
    if (scroll) row.scrollIntoView({ block: "nearest" });
  }
  private moveFocus(d: number, extend = false): void {
    const vis = this.visibleRows();
    if (!vis.length) return;
    let i = this.focusRow ? vis.indexOf(this.focusRow) : -1;
    i = i < 0 ? (d > 0 ? 0 : vis.length - 1) : Math.max(0, Math.min(vis.length - 1, i + d));
    if (extend) {
      if (this.focusRow) this.selected.add(this.focusRow);
      this.selected.add(vis[i]);
      this.anchorRow = vis[i];
      this.render();
    }
    this.setFocus(vis[i]);
  }
  get selectedCount(): number {
    return this.selected.size;
  }

  // ─────────────────────────────────────────────────────────── edits

  private orderedSelection(): HTMLElement[] {
    return this.rows().filter((r) => this.selected.has(r));
  }
  private renumber(): void {
    let n = 0;
    for (const r of this.rows()) {
      if (!this.live(r)) continue;
      n++;
      const idx = r.querySelector(SEL.rowIndex);
      if (idx && /^\d*$/.test(idx.textContent?.trim() ?? "")) idx.textContent = String(n);
    }
  }
  private snapshot(): Snapshot {
    return {
      seq: this.seqNow(),
      phases: [...this.phases].map(([id, p]) => [id, { ...p }]),
      removed: this.rows().filter((r) => !this.live(r)),
      extraRemoved: [...this.extraRemoved],
      sortKey: this.sortKey,
    };
  }
  private restore(s: Snapshot): void {
    this.phases = new Map(s.phases.map(([id, p]) => [id, { ...p }]));
    for (const id of this.phases.keys()) this.ensurePhaseEl(id);
    for (const [id, el] of [...this.phaseEls]) {
      if (!this.phases.has(id)) {
        el.remove();
        this.phaseEls.delete(id);
      }
    }
    this.applySeq(s.seq);
    for (const r of this.rows()) r.classList.toggle("y3s-removed", s.removed.includes(r));
    this.extraRemoved = new Set(s.extraRemoved);
    this.sortKey = s.sortKey;
    this.updateSortLabel();
    this.renumber();
    this.refresh();
    this.persistNow();
  }

  /** Apply an edit on the page now; save it to YouTube after the undo window. */
  private commit(label: string, edit: () => void, save = true): void {
    const before = this.snapshot();
    this.savedSnap ??= before;
    this.history.push(before);
    edit();
    this.renumber();
    this.refresh();
    this.persistNow();
    showSnack(label, { label: "Undo", run: () => this.undo() }, SAVE_DELAY_MS);
    if (save && this.canEdit) this.scheduleSave();
  }

  undo(): void {
    const s = this.history.pop();
    if (!s) return;
    this.restore(s);
    showSnack("Undone", this.history.length ? { label: "Undo", run: () => this.undo() } : undefined);
    if (this.canEdit) this.scheduleSave();
  }
  get canUndo(): boolean {
    return this.history.length > 0;
  }

  /** Why an edit can't happen right now, already told to the user; or false. */
  private blockedReason(kind: "remove" | "reorder"): boolean {
    switch (this.access) {
      case "checking":
        showSnack("Checking whether you can edit this playlist…");
        return true;
      case "unconfigured":
        showSnack(messageForError({ code: "AUTH_NOT_CONFIGURED", message: "" }));
        return true;
      case "signed-out":
        showSnack("Sign in to edit your playlists", { label: "Sign in", run: () => void this.signIn() });
        return true;
      case "view-only":
        showSnack("Only the playlist's owner can change it");
        return true;
      case "error":
        showSnack(this.accessError || "Couldn't check this playlist", {
          label: "Retry",
          run: () => void this.loadAccess(),
        });
        return true;
      case "editable":
        if (this.blocked) {
          showSnack("Some changes didn't save. Reload to keep editing.", { label: "Reload", run: () => location.reload() }, 0);
          return true;
        }
        if (kind === "reorder" && !this.manualView) {
          showSnack("To reorder, set this playlist's Sort to Manual on YouTube first");
          return true;
        }
        return false;
    }
  }

  /**
   * Reorders that are fine anywhere (sorting, phases): saved on playlists you
   * can reorder, page-only elsewhere. Loads the whole list first when saving.
   * Returns the label suffix, or null to abort.
   */
  private async prepareReorder(): Promise<string | null> {
    if (this.canReorder) return (await this.ensureAllLoaded()) ? "" : null;
    return " (only on this page)";
  }

  async moveTo(where: "top" | "bottom"): Promise<void> {
    if (!this.selected.size || this.blockedReason("reorder")) return;
    if (!(await this.ensureAllLoaded())) return;
    const sel = this.orderedSelection();
    this.commit(`Moved ${count(sel.length, "video")} to ${where}`, () => {
      this.applySeq(moveRows(this.seqNow(), new Set(sel.map(this.keyOf)), where));
      this.sortKey = "manual";
      this.updateSortLabel();
    });
    sel[0]?.scrollIntoView({ block: "nearest" });
  }

  removeSelected(): void {
    if (!this.selected.size || this.blockedReason("remove")) return;
    const sel = this.orderedSelection();
    this.commit(`Removed ${count(sel.length, "video")}`, () => {
      sel.forEach((r) => r.classList.add("y3s-removed"));
      this.selected.clear();
    });
  }

  private runChipAction(): void {
    if (this.chip === "dups") this.removeExtraCopies();
    else if (this.chip === "unavail") this.removeUnavailable();
  }

  removeExtraCopies(): void {
    if (this.blockedReason("remove")) return;
    const live = this.rows().filter(this.live);
    const extra = extraCopies(live.map((r) => this.data.get(r)!)).map((i) => live[i]);
    if (!extra.length) return;
    this.commit(`Removed ${count(extra.length, "extra copy", "extra copies")}`, () => {
      extra.forEach((r) => {
        r.classList.add("y3s-removed");
        this.selected.delete(r);
      });
      this.chip = "all";
    });
  }

  removeUnavailable(): void {
    if (this.blockedReason("remove")) return;
    const rows = this.rows().filter((r) => this.live(r) && this.data.get(r)?.unavailable);
    const hidden = this.hiddenUnavailable.filter((id) => !this.extraRemoved.has(id));
    const n = rows.length + hidden.length;
    if (!n) return;
    this.commit(`Removed ${count(n, "unavailable video")}`, () => {
      rows.forEach((r) => {
        r.classList.add("y3s-removed");
        this.selected.delete(r);
      });
      hidden.forEach((id) => this.extraRemoved.add(id));
      this.chip = "all";
    });
  }

  private playIds(rows: HTMLElement[], shuffle = false): void {
    let ids = rows.map((r) => this.data.get(r)?.videoId).filter((v): v is string => !!v);
    if (!ids.length) return;
    if (shuffle) {
      ids = [...ids];
      for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
    }
    if (ids.length > MAX_QUEUE_IDS) showSnack(`Playing the first ${MAX_QUEUE_IDS} of ${ids.length}`);
    location.assign(`https://www.youtube.com/watch_videos?video_ids=${ids.slice(0, MAX_QUEUE_IDS).join(",")}`);
  }
  playSelected(): void {
    this.playIds(this.orderedSelection());
  }

  // ─────────────────────────────────────────────────────────── sorting

  private updateSortLabel(): void {
    const label = SORTS.find(([k]) => k === this.sortKey)?.[1] ?? "";
    this.sortLabel.textContent = this.sortKey === "manual" ? "Sort" : `Sort: ${label.replace(/ \(A–Z\)| first| current order| once/, "")}`;
    this.sortChip.setAttribute("aria-pressed", String(this.sortKey !== "manual"));
  }

  private openSort(): void {
    toggleMenu(this.sortChip, [
      ...(this.phases.size ? [{ heading: "Sorts inside each phase" } as MenuItem] : []),
      ...SORTS.map(([key, label]) => ({ label, checked: key === this.sortKey, run: () => void this.sortBy(key) })),
    ]);
  }

  /** New order for some rows (as keys). */
  private sortedKeys(keys: string[], key: SortKey): string[] {
    const els = this.elByKey();
    const rows = keys.map((k) => els.get(k)!);
    return sortOrder(
      rows.map((r) => this.data.get(r)!),
      key,
      rows.map((r) => Number(r.dataset[ORIG])),
    ).map((i) => keys[i]);
  }

  /** Sorts the whole playlist, or each phase separately when there are phases. */
  async sortBy(key: SortKey): Promise<void> {
    const suffix = await this.prepareReorder();
    if (suffix === null) return;
    const label = SORTS.find(([k]) => k === key)![1];
    const msg = key === "manual" ? "Back to playlist order" : `Sorted: ${label}`;
    this.commit(msg + (key === "manual" ? "" : suffix), () => {
      let seq = this.seqNow();
      for (const s of sections(seq)) seq = sortSection(seq, s.phase, (r) => this.sortedKeys(r, key));
      this.applySeq(seq);
      this.sortKey = key;
      this.updateSortLabel();
    });
  }

  // ─────────────────────────────────────────────────────────── phases

  private newPhaseId(): string {
    return `${Date.now().toString(36)}${(this.phaseSeq++).toString(36)}`;
  }

  private ensurePhaseEl(id: string): HTMLElement {
    let el = this.phaseEls.get(id);
    if (el) return el;
    const name = h("span", { class: "y3s-phase-name" });
    const meta = h("span", { class: "y3s-phase-meta" });
    const toggle = h(
      "button",
      { class: "y3s-icon-btn y3s-phase-toggle", "aria-label": "Expand phase", onclick: () => this.togglePhase(id) },
      icon(ICONS.chevron),
    );
    const more: HTMLButtonElement = h(
      "button",
      { class: "y3s-icon-btn", "aria-label": "Phase actions", "aria-haspopup": "menu", onclick: () => this.openPhaseMenu(id, more) },
      icon(ICONS.more),
    );
    el = h(
      "div",
      {
        class: "y3s-phase",
        role: "heading",
        "aria-level": "3",
        onclick: (e: MouseEvent) => {
          if (!(e.target as Element).closest("button, input")) this.togglePhase(id);
        },
        ondblclick: (e: MouseEvent) => {
          if ((e.target as Element).closest(".y3s-phase-name")) this.renamePhase(id);
        },
      },
      toggle,
      h("div", { class: "y3s-phase-title" }, name, meta),
      more,
    );
    el.dataset[KEY] = marker(id);
    this.phaseEls.set(id, el);
    return el;
  }

  /** Header text, counts and fold state. */
  private renderPhases(): void {
    if (!this.phases.size) return;
    const filtering = this.filtering;
    const els = this.elByKey();
    for (const s of sections(this.seqNow())) {
      if (s.phase === null) continue;
      const p = this.phases.get(s.phase);
      const el = this.phaseEls.get(s.phase);
      if (!p || !el) continue;
      const rows = s.rows.map((k) => els.get(k)!).filter((r) => r && this.live(r));
      const secs = rows.reduce((t, r) => t + (this.data.get(r)?.duration ?? 0), 0);
      const matches = rows.filter((r) => !r.classList.contains("y3s-hidden")).length;
      const selectedHere = rows.filter((r) => this.selected.has(r)).length;
      (el.querySelector(".y3s-phase-name") as HTMLElement).textContent = p.name;
      (el.querySelector(".y3s-phase-meta") as HTMLElement).textContent = [
        filtering ? `${matches} of ${count(rows.length, "video")}` : count(rows.length, "video"),
        rows.length ? formatTotal(secs) : "",
        selectedHere ? `${selectedHere} selected` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      const folded = p.collapsed && !filtering;
      el.classList.toggle("y3s-folded", folded);
      el.hidden = filtering && matches === 0;
      const t = el.querySelector(".y3s-phase-toggle")!;
      t.setAttribute("aria-label", folded ? "Expand phase" : "Collapse phase");
      t.setAttribute("aria-expanded", String(!folded));
    }
  }

  phaseNames(): string[] {
    return sections(this.seqNow())
      .filter((s) => s.phase !== null)
      .map((s) => this.phases.get(s.phase!)?.name ?? "");
  }

  togglePhase(id: string, collapsed?: boolean): void {
    const p = this.phases.get(id);
    if (!p) return;
    p.collapsed = collapsed ?? !p.collapsed;
    if (p.collapsed) {
      // Folded rows can't stay selected or focused.
      for (const r of this.rowsOfPhase(id)) this.selected.delete(r);
    }
    this.applyFilter();
    this.render();
  }

  setAllCollapsed(collapsed: boolean): void {
    for (const id of this.phases.keys()) this.togglePhase(id, collapsed);
  }

  rowsOfPhase(id: string | null): HTMLElement[] {
    const els = this.elByKey();
    const s = sections(this.seqNow()).find((x) => x.phase === id);
    return (s?.rows ?? []).map((k) => els.get(k)!).filter((r) => r && this.live(r));
  }

  private addPhase(id: string, name: string, collapsed: boolean): void {
    this.phases.set(id, { name, collapsed });
    this.ensurePhaseEl(id);
  }

  private nextName(): string {
    const used = new Set([...this.phases.values()].map((p) => p.name));
    for (let n = this.phases.size + 1; ; n++) if (!used.has(`Phase ${n}`)) return `Phase ${n}`;
  }

  /** "Start phase here": a divider before the focused (or first selected) video. */
  startPhaseHere(row = this.focusRow ?? this.orderedSelection()[0]): void {
    if (!row) {
      showSnack("Focus or select the video where the phase should start");
      return;
    }
    const id = this.newPhaseId();
    const name = this.nextName();
    this.commit(
      `Started ${name}`,
      () => {
        this.addPhase(id, name, false);
        this.applySeq(startPhaseAt(this.seqNow(), id, this.keyOf(row)));
      },
      false,
    );
    this.renamePhase(id);
  }

  /** Gather the selected videos into a new phase. */
  async newPhaseFromSelection(): Promise<void> {
    const sel = this.orderedSelection();
    if (!sel.length) return this.startPhaseHere();
    const id = this.newPhaseId();
    const name = this.nextName();
    const next = phaseFromRows(this.seqNow(), id, new Set(sel.map(this.keyOf)));
    const moves = next.filter((k) => !isPhase(k)).join() !== this.seqNow().filter((k) => !isPhase(k)).join();
    const suffix = moves ? await this.prepareReorder() : "";
    if (suffix === null) return;
    this.commit(`New phase with ${count(sel.length, "video")}${suffix}`, () => {
      this.addPhase(id, name, false);
      this.applySeq(phaseFromRows(this.seqNow(), id, new Set(sel.map(this.keyOf))));
      this.selected.clear();
    });
    this.renamePhase(id);
  }

  async splitInto(size: number): Promise<void> {
    if (this.continuation()) {
      showSnack("Loading the whole playlist first…", undefined, 0);
      await this.loadAll();
      if (this.continuation()) return;
    }
    const rows = this.rows().filter(this.live);
    this.commit(
      `Split into ${count(Math.ceil(rows.length / size), "phase")}`,
      () => {
        for (const id of [...this.phases.keys()]) {
          this.phaseEls.get(id)?.remove();
          this.phaseEls.delete(id);
        }
        this.phases.clear();
        const ids: string[] = [];
        const seq = splitEvery(this.seqNow(), size, () => {
          const id = this.newPhaseId();
          ids.push(id);
          return id;
        });
        ids.forEach((id, i) => {
          const from = i * size + 1;
          const to = Math.min(rows.length, (i + 1) * size);
          this.addPhase(id, `Videos ${from}–${to}`, true);
        });
        this.applySeq(seq);
      },
      false,
    );
  }

  async movePhaseTo(id: string, to: "up" | "down" | "top" | "bottom"): Promise<void> {
    const suffix = await this.prepareReorder();
    if (suffix === null) return;
    const name = this.phases.get(id)?.name ?? "phase";
    this.commit(`Moved ${name} ${to === "up" || to === "down" ? to : `to ${to}`}${suffix}`, () =>
      this.applySeq(movePhase(this.seqNow(), id, to)),
    );
  }

  async sortPhase(id: string, key: SortKey): Promise<void> {
    const suffix = await this.prepareReorder();
    if (suffix === null) return;
    const label = SORTS.find(([k]) => k === key)![1];
    this.commit(`Sorted ${this.phases.get(id)?.name}: ${label}${suffix}`, () =>
      this.applySeq(sortSection(this.seqNow(), id, (r) => this.sortedKeys(r, key))),
    );
  }

  async moveSelectionToPhase(id: string | null): Promise<void> {
    const sel = this.orderedSelection();
    if (!sel.length) return;
    const suffix = await this.prepareReorder();
    if (suffix === null) return;
    const name = id === null ? "the top (no phase)" : (this.phases.get(id)?.name ?? "phase");
    this.commit(`Moved ${count(sel.length, "video")} to ${name}${suffix}`, () => {
      this.applySeq(moveRows(this.seqNow(), new Set(sel.map(this.keyOf)), { phase: id }));
      this.selected.clear();
    });
  }

  removePhase(id: string): void {
    const name = this.phases.get(id)?.name ?? "phase";
    this.commit(
      `Removed ${name} (videos kept)`,
      () => {
        this.applySeq(removePhase(this.seqNow(), id));
        this.phases.delete(id);
        this.phaseEls.get(id)?.remove();
        this.phaseEls.delete(id);
      },
      false,
    );
  }

  clearPhases(): void {
    if (!this.phases.size) return;
    this.commit(
      `Cleared ${count(this.phases.size, "phase")}`,
      () => {
        for (const el of this.phaseEls.values()) el.remove();
        this.phaseEls.clear();
        this.phases.clear();
        this.pendingPhases = [];
      },
      false,
    );
  }

  renamePhase(id: string): void {
    const el = this.phaseEls.get(id);
    const p = this.phases.get(id);
    if (!el || !p || el.querySelector("input")) return;
    const nameEl = el.querySelector(".y3s-phase-name") as HTMLElement;
    const input = h("input", { class: "y3s-phase-input", value: p.name, "aria-label": "Phase name", maxlength: "80" });
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      if (save && v && v !== p.name) {
        p.name = v;
        this.persistNow();
      }
      input.remove();
      nameEl.hidden = false;
      this.render();
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") finish(true);
      else if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
    input.addEventListener("click", (e) => e.stopPropagation());
    nameEl.hidden = true;
    nameEl.after(input);
    input.focus();
    input.select();
  }

  private openPhasesMenu(): void {
    const items: MenuItem[] = [];
    const sel = this.selected.size;
    items.push(
      sel
        ? { label: `New phase from ${count(sel, "selected video")}`, run: () => void this.newPhaseFromSelection() }
        : { label: "Start phase at focused video", disabled: !this.focusRow, run: () => this.startPhaseHere() },
    );
    const total = this.rows().filter(this.live).length;
    const sizes = SPLIT_SIZES.filter((n) => n < total + (this.continuation() ? 1000 : 0));
    if (sizes.length) {
      items.push({ sep: true });
      for (const n of sizes) {
        items.push({
          label: `${this.phases.size ? "Re-split" : "Split"} into phases of ${n}`,
          run: () => void this.splitInto(n),
        });
      }
    }
    if (this.phases.size) {
      items.push(
        { sep: true },
        { label: "Expand all", run: () => this.setAllCollapsed(false) },
        { label: "Collapse all", run: () => this.setAllCollapsed(true) },
        { label: "Clear all phases", run: () => this.clearPhases() },
      );
    }
    toggleMenu(this.phasesChip, items);
  }

  private openPhaseMenu(id: string, anchor: HTMLElement): void {
    const ids = sections(this.seqNow())
      .filter((s) => s.phase !== null)
      .map((s) => s.phase!);
    const i = ids.indexOf(id);
    const rows = this.rowsOfPhase(id);
    toggleMenu(anchor, [
      { label: "Play phase", disabled: !rows.length, run: () => this.playIds(rows) },
      { label: "Shuffle play", disabled: !rows.length, run: () => this.playIds(rows, true) },
      {
        label: "Select all in phase",
        disabled: !rows.length,
        run: () => {
          this.togglePhase(id, false);
          for (const r of this.rowsOfPhase(id)) this.selected.add(r);
          this.render();
        },
      },
      { sep: true },
      { heading: "Sort this phase" },
      ...SORTS.filter(([k]) => k !== "manual").map(([k, label]) => ({
        label,
        disabled: rows.length < 2,
        run: () => void this.sortPhase(id, k),
      })),
      { sep: true },
      { label: "Move up", disabled: i <= 0, run: () => void this.movePhaseTo(id, "up") },
      { label: "Move down", disabled: i >= ids.length - 1, run: () => void this.movePhaseTo(id, "down") },
      { label: "Move to top", disabled: i <= 0, run: () => void this.movePhaseTo(id, "top") },
      { label: "Move to bottom", disabled: i >= ids.length - 1, run: () => void this.movePhaseTo(id, "bottom") },
      { sep: true },
      { label: "Rename", run: () => this.renamePhase(id) },
      { label: "Remove phase (keep videos)", run: () => this.removePhase(id) },
    ]);
  }

  private openMoveToPhase(anchor: HTMLElement): void {
    const secs = sections(this.seqNow());
    toggleMenu(anchor, [
      ...(secs[0].rows.length
        ? [{ label: "No phase (top)", run: () => void this.moveSelectionToPhase(null) } as MenuItem]
        : []),
      ...secs
        .filter((s) => s.phase !== null)
        .map((s) => ({ label: this.phases.get(s.phase!)?.name ?? "", run: () => void this.moveSelectionToPhase(s.phase) })),
      { sep: true },
      { label: "New phase…", run: () => void this.newPhaseFromSelection() },
    ]);
  }

  // ─────────────────────────────────────────── phases: saving and restoring

  private anchorFor(row: HTMLElement, nthOf: Map<HTMLElement, number>): StoredAnchor {
    const item = row.dataset[ITEM];
    return { ...(item ? { item } : {}), videoId: this.data.get(row)?.videoId ?? null, nth: nthOf.get(row) ?? 0 };
  }

  private nthMap(): Map<HTMLElement, number> {
    const seen = new Map<string, number>();
    const out = new Map<HTMLElement, number>();
    for (const r of this.rows()) {
      if (!this.live(r)) continue;
      const v = this.data.get(r)?.videoId ?? "";
      const n = seen.get(v) ?? 0;
      out.set(r, n);
      seen.set(v, n + 1);
    }
    return out;
  }

  private resolve(a: StoredAnchor): HTMLElement | null {
    const live = this.rows().filter(this.live);
    if (a.item) {
      const r = live.find((x) => x.dataset[ITEM] === a.item);
      if (r) return r;
      if (this.server) return null; // item known to be gone or not loaded
    }
    const nth = this.nthMap();
    return live.find((r) => this.data.get(r)?.videoId === a.videoId && nth.get(r) === a.nth) ?? null;
  }

  private async loadStoredPhases(): Promise<void> {
    const id = this.playlistId;
    const gen = this.generation;
    if (!id) return;
    const stored = await loadPhases(id);
    if (gen !== this.generation) return;
    this.phasesLoaded = true;
    // Phases open folded, so a long playlist starts compact.
    for (const p of stored) this.addPhase(p.id, p.name, true);
    this.pendingPhases = stored;
    this.refresh();
  }

  /** Put stored dividers in place once the rows they follow are on the page. */
  private placePendingPhases(): void {
    const pendingIds = new Set(this.pendingPhases.map((p) => p.id));
    const lost = [...this.phases.keys()].filter((id) => !pendingIds.has(id) && !this.phaseEls.get(id)?.isConnected);
    if (lost.length) {
      const known = new Map(this.lastStored.map((p) => [p.id, p]));
      for (const id of lost) {
        const p = known.get(id);
        if (p) this.pendingPhases.push(p);
        else this.phases.delete(id);
      }
    }
    if (!this.pendingPhases.length) return;
    const anchors: Anchor[] = [];
    const keyFor = new Map<string, StoredPhase>();
    for (const p of this.pendingPhases) {
      if (p.after === null) {
        anchors.push({ id: p.id, after: null });
        continue;
      }
      const row = this.resolve(p.after);
      anchors.push({ id: p.id, after: row ? this.keyOf(row) : `?${p.id}` });
      keyFor.set(p.id, p);
    }
    const rowSeq = this.seqNow().filter((k) => !isPhase(k));
    const placedBefore = anchorsOf(this.seqNow());
    const { seq, pending } = placeAnchors(rowSeq, [...placedBefore, ...anchors]);
    this.pendingPhases = pending.map((a) => keyFor.get(a.id)!).filter(Boolean);
    this.applySeq(seq);
    // Phases whose rows never show up (deleted elsewhere) are dropped once
    // the whole playlist is on the page.
    if (!this.continuation() && this.pendingPhases.length) {
      for (const p of this.pendingPhases) this.phases.delete(p.id);
      this.pendingPhases = [];
      this.persistSoon();
    }
  }

  private storedPhases(): StoredPhase[] {
    const nth = this.nthMap();
    const els = this.elByKey();
    const placed = anchorsOf(
      this.seqNow().filter((k) => isPhase(k) || this.live(els.get(k)!)),
    ).map((a) => ({
      id: a.id,
      name: this.phases.get(a.id)?.name ?? "",
      after: a.after === null ? null : this.anchorFor(els.get(a.after)!, nth),
    }));
    return [...placed, ...this.pendingPhases];
  }

  private persistSoon(): void {
    if (!this.phasesLoaded) return;
    clearTimeout(this.persistTimer);
    this.persistTimer = window.setTimeout(() => this.persistNow(), 300);
  }
  /** Write phases to storage now (also called when the page is left). */
  persistNow(): void {
    clearTimeout(this.persistTimer);
    if (!this.phasesLoaded || !this.playlistId) return;
    const stored = this.storedPhases();
    this.lastStored = stored;
    void savePhases(this.playlistId, stored);
  }

  // ─────────────────────────────────────────────── load the whole list

  async loadAll(): Promise<void> {
    if (this.loading || !this.continuation()) return;
    this.loading = true;
    this.render();
    const gen = this.generation;
    const y = scrollY;
    const start = Date.now();
    let last = this.rows().length;
    let stuckSince = Date.now();
    while (this.continuation() && gen === this.generation && Date.now() - start < 180_000) {
      this.continuation()?.scrollIntoView({ block: "end" });
      await new Promise((r) => setTimeout(r, 400));
      const n = this.rows().length;
      if (n !== last) {
        last = n;
        stuckSince = Date.now();
      } else if (Date.now() - stuckSince > 8000) break;
    }
    if (gen !== this.generation) return;
    scrollTo({ top: y });
    this.loading = false;
    this.refresh();
    if (this.continuation()) showSnack("Couldn't load the rest of the playlist. Scroll down and try again.");
  }

  /** Reorders need the whole playlist on the page. */
  private async ensureAllLoaded(): Promise<boolean> {
    if (!this.continuation()) return true;
    showSnack("Loading the whole playlist first…", undefined, 0);
    await this.loadAll();
    if (this.continuation()) return false;
    showSnack(`Loaded ${count(this.rows().filter(this.live).length, "video")}`);
    return true;
  }

  // ────────────────────────────────────────────────── YouTube account

  async loadAccess(): Promise<void> {
    const gen = this.generation;
    const id = this.playlistId;
    this.access = "checking";
    this.render();
    let access: Access;
    let server: ServerTrack[] | null = null;
    try {
      const st = await this.backend.authStatus();
      if (!id) access = "view-only";
      else if (!st.configured) access = "unconfigured";
      else if (!st.signedIn) access = "signed-out";
      else {
        const a = await this.backend.access(id);
        access = a.owned ? "editable" : "view-only";
        if (a.owned) server = await this.backend.items(id);
      }
    } catch (e) {
      access = "error";
      this.accessError = messageForError(e as ApiError);
    }
    if (gen !== this.generation) return;
    this.access = access;
    if (server) {
      this.server = server.map(({ playlistItemId, videoId }) => ({ playlistItemId, videoId }));
      this.serverTitles = new Map(server.map((s) => [s.playlistItemId, s.title]));
    }
    this.refresh();
    // Phase anchors can now use playlist item ids, which survive reorders.
    this.persistSoon();
    // Edits made while we were checking get saved now.
    if (this.canEdit && this.history.length) this.scheduleSave();
  }

  async signIn(): Promise<void> {
    if (this.access === "error") return this.loadAccess();
    if (this.access !== "signed-out") return;
    try {
      await this.backend.signIn();
    } catch (e) {
      showSnack(messageForError(e as ApiError));
      return;
    }
    await this.loadAccess();
    const now = this.access as Access; // loadAccess changed it
    if (now === "editable") showSnack("Signed in. You can edit this playlist.");
    else if (now === "view-only") showSnack("Signed in. This playlist belongs to someone else.");
  }

  // ───────────────────────────────────────────────────────── saving

  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.save(), SAVE_DELAY_MS);
  }

  /** The writes that would make YouTube match the page. */
  pendingChanges(): Change[] {
    if (!this.server) return [];
    const rows = this.rows().filter((r) => r.dataset[ITEM]);
    const removed = new Set([
      ...rows.filter((r) => !this.live(r)).map((r) => r.dataset[ITEM]!),
      ...this.extraRemoved,
    ]);
    let shown = rows.filter(this.live).map((r) => r.dataset[ITEM]!);
    if (!this.canReorder) {
      // Order on the page is only a view here; save deletions only.
      const pos = new Map(this.server.map((s, i) => [s.playlistItemId, i]));
      shown = shown.sort((a, b) => pos.get(a)! - pos.get(b)!);
    }
    return planChanges(this.server, shown, removed);
  }

  /** Save now. `unattended` skips the confirm (used when leaving the page). */
  async save(unattended = false): Promise<void> {
    clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    if (!this.canEdit || !this.server || !this.playlistId) return;
    if (this.saving) {
      this.resave = true;
      return this.saving;
    }
    const changes = this.pendingChanges();
    if (!changes.length) {
      this.history = [];
      this.savedSnap = null;
      return;
    }
    if (changes.length > CONFIRM_WRITES_OVER) {
      if (unattended) return;
      const units = changes.length * QUOTA_COST.update;
      const ok = await confirmDialog({
        title: "Save these changes to YouTube?",
        body: [
          `This takes ${count(changes.length, "change")} and uses about ${units.toLocaleString()} of your ${DAILY_QUOTA.toLocaleString()} daily YouTube API units.`,
          ...(units > DAILY_QUOTA
            ? ["That's more than a day's quota, so saving will stop partway. The rest can be saved tomorrow."]
            : []),
        ],
        confirm: "Save",
        cancel: "Undo changes",
      });
      if (!ok) {
        if (this.savedSnap) this.restore(this.savedSnap);
        this.history = [];
        this.savedSnap = null;
        showSnack("Changes undone");
        return;
      }
    }
    this.saving = this.doSave(this.playlistId, changes);
    await this.saving;
  }

  private async doSave(playlistId: string, changes: Change[]): Promise<void> {
    const gen = this.generation;
    this.history = [];
    this.savedSnap = null;
    const many = changes.length > 1;
    showSnack(many ? `Saving 0 of ${changes.length}…` : "Saving…", undefined, 0);
    let result;
    try {
      result = await this.backend.apply(playlistId, changes, (done, total) => {
        if (gen === this.generation) showSnack(`Saving ${done} of ${total}…`, undefined, 0);
      });
    } catch (e) {
      result = { applied: 0, error: e as ApiError };
    }
    this.saving = null;
    if (gen !== this.generation || !this.server) return;

    const applied = changes.slice(0, result.applied);
    this.server = applyChanges(this.server, applied);
    this.savedOnce = true;
    const deleted = new Set(applied.filter((c) => c.kind === "delete").map((c) => c.playlistItemId));
    for (const r of this.rows()) if (deleted.has(r.dataset[ITEM] ?? "")) r.remove();
    for (const id of deleted) this.extraRemoved.delete(id);
    this.hiddenUnavailable = this.hiddenUnavailable.filter((id) => !deleted.has(id));

    if (result.error) {
      this.blocked = true;
      const saved = result.applied ? ` (${result.applied} of ${changes.length} saved)` : "";
      showSnack(`Couldn't save: ${messageForError(result.error)}${saved}`, {
        label: "Reload",
        run: () => location.reload(),
      }, 0);
    } else if (!this.resave && !this.saveTimer) {
      showSnack("Saved to YouTube", undefined, 3000);
    }
    this.refresh();
    this.persistSoon();
    if (this.resave) {
      this.resave = false;
      this.scheduleSave();
    }
  }

  /** Called when leaving the page: save small pending edits right away. */
  flushOnLeave(): void {
    if (this.saveTimer) void this.save(true);
  }

  // ───────────────────────────────────────────────────────── keyboard

  onKey(e: KeyboardEvent): void {
    if (e.defaultPrevented || isDialogOpen() || isMenuOpen() || this.drag.dragging) return;
    const t = e.target as HTMLElement | null;
    if (isEditable(t) || t?.closest?.("ytd-searchbox, #search, tp-yt-paper-dialog")) return;
    if (e.ctrlKey || e.metaKey || e.altKey) {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "z" && this.canUndo) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.undo();
      }
      return;
    }
    const sel = this.selected.size > 0;
    let handled = true;
    switch (e.key) {
      case "j":
        this.moveFocus(1);
        break;
      case "k":
        this.moveFocus(-1);
        break;
      case "J":
        this.moveFocus(1, true);
        break;
      case "K":
        this.moveFocus(-1, true);
        break;
      case "x":
        if (this.focusRow) this.toggleRow(this.focusRow);
        else handled = false;
        break;
      case "Enter":
        if (this.focusRow && !t?.closest?.("button, a, .y3s-phase")) this.data.get(this.focusRow)?.anchor?.click();
        else handled = false;
        break;
      case "/":
        this.searchInput.focus();
        this.searchInput.select();
        break;
      case "g":
        this.setFocus(this.visibleRows()[0] ?? null);
        break;
      case "G":
        this.setFocus(this.visibleRows().at(-1) ?? null);
        break;
      case "t":
      case "b":
        if (sel) void this.moveTo(e.key === "t" ? "top" : "bottom");
        else handled = false;
        break;
      case "p":
        if (sel) void this.newPhaseFromSelection();
        else if (this.focusRow) this.startPhaseHere();
        else handled = false;
        break;
      case "c": {
        const k = this.focusRow ? this.keyOf(this.focusRow) : null;
        const s = k ? sections(this.seqNow()).find((x) => x.rows.includes(k)) : null;
        if (s?.phase) this.togglePhase(s.phase, true);
        else handled = false;
        break;
      }
      case "C":
        if (this.phases.size) this.setAllCollapsed(![...this.phases.values()].every((p) => p.collapsed));
        else handled = false;
        break;
      case "Delete":
      case "Backspace":
        if (sel) this.removeSelected();
        else handled = false;
        break;
      case "z":
        if (this.canUndo) this.undo();
        else handled = false;
        break;
      case "?":
        openHelp();
        break;
      case "Escape":
        if (sel) this.clearSelection();
        else if (this.query || this.chip !== "all") this.clearFilters();
        else if (this.focusRow) this.setFocus(null);
        else handled = false;
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }
}
