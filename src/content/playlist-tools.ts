// Tools added to YouTube's own playlist page: a filter bar with chips and
// sort, hover checkboxes with a selection bar, keyboard navigation, and edits
// that apply on the page at once and are saved to YouTube after an undo window.

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
import { applyChanges, planChanges, type ServerItem } from "../core/plan";
import { CONFIRM_WRITES_OVER, DAILY_QUOTA, MAX_QUEUE_IDS, QUOTA_COST, SAVE_DELAY_MS } from "../shared/constants";
import type { ApiError, Change } from "../shared/types";
import { count, messageForError } from "../shared/utils";
import { chromeBackend, type Backend, type ServerTrack } from "./backend";
import { h, icon, ICONS, isEditable } from "./ui/dom";
import { confirmDialog, isDialogOpen, openHelp } from "./ui/dialog";
import { closeMenu, isMenuOpen, toggleMenu } from "./ui/menu";
import { showSnack } from "./ui/snackbar";
import { currentPlaylistId, readRow, SEL, type Row } from "./yt-dom";

export type Access = "checking" | "unconfigured" | "signed-out" | "view-only" | "editable" | "error";

interface Snapshot {
  order: HTMLElement[];
  removed: HTMLElement[];
  extraRemoved: string[];
  sortKey: SortKey;
}

const ITEM = "y3sItem"; // dataset key: playlistItemId of a row
const ORIG = "y3sOrig"; // dataset key: row's position in YouTube's own view

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
  private chipAction!: HTMLButtonElement;
  private statsText!: HTMLElement;
  private loadAllBtn!: HTMLButtonElement;
  private accountBtn!: HTMLButtonElement;
  private selCount!: HTMLElement;
  private selectAllBtn!: HTMLButtonElement;
  private moveBtns!: HTMLButtonElement[];
  private removeBtn!: HTMLButtonElement;

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
    this.refresh();
    void this.loadAccess();
  }

  destroy(): void {
    this.flushOnLeave();
    this.generation++;
    this.obs.disconnect();
    clearTimeout(this.refreshTimer);
    this.bar.remove();
    this.empty.remove();
    this.list.classList.remove("y3s-selecting");
    for (const r of this.rows()) {
      r.querySelector(":scope > .y3s-cbwrap")?.remove();
      r.classList.remove("y3s-row", "y3s-hidden", "y3s-removed", "y3s-selected", "y3s-focus");
    }
    closeMenu();
  }

  /** YouTube reuses the page for a different playlist: start over. */
  checkPlaylistId(): void {
    const id = currentPlaylistId();
    if (id === this.playlistId) return;
    this.flushOnLeave();
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
    });
    this.selected.clear();
    this.extraRemoved.clear();
    this.searchInput.value = "";
    for (const r of this.rows()) {
      delete r.dataset[ITEM];
      delete r.dataset[ORIG];
    }
    this.updateSortLabel();
    this.refresh();
    void this.loadAccess();
  }

  // ───────────────────────────────────────────────────────────── data

  rows(): HTMLElement[] {
    return [...this.contents.children].filter((el): el is HTMLElement => el.matches(SEL.playlistRow));
  }
  private live = (r: HTMLElement) => !r.classList.contains("y3s-removed");
  visibleRows(): HTMLElement[] {
    return this.rows().filter((r) => this.live(r) && !r.classList.contains("y3s-hidden"));
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

  private decorate(row: HTMLElement): void {
    if (row.dataset[ORIG] == null) row.dataset[ORIG] = String(this.seq++);
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
    for (const [r, d] of this.data) r.classList.toggle("y3s-hidden", !isVisible(d, this.query, this.chip, this.dups));
    if (this.focusRow && (this.focusRow.classList.contains("y3s-hidden") || !this.live(this.focusRow))) {
      this.setFocus(null);
    }
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
        this.chipAction,
      ),
    );

    this.selCount = h("span", { class: "y3s-sel-count" });
    const act = (label: string, ic: string, fn: () => void) =>
      h("button", { class: "y3s-btn", onclick: fn }, icon(ic), h("span", { text: label }));
    this.selectAllBtn = h("button", { class: "y3s-btn y3s-btn-text", onclick: () => this.selectAllVisible() });
    this.moveBtns = [
      act("Move to top", ICONS.top, () => void this.moveTo("top")),
      act("Move to bottom", ICONS.bottom, () => void this.moveTo("bottom")),
    ];
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
    const filtering = !!this.query.trim() || this.chip !== "all";
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
      this.access === "view-only" ? "You can filter and sort this playlist, but only its owner can change it" : "";

    this.chipEls.dups.textContent = dupRows ? `Duplicates · ${dupRows}` : "Duplicates";
    this.chipEls.unavail.textContent = unavail ? `Unavailable · ${unavail}` : "Unavailable";
    for (const [k, el] of Object.entries(this.chipEls)) el.setAttribute("aria-pressed", String(this.chip === k));

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
    const unselected = vis.filter((r) => !this.selected.has(r)).length;
    this.selectAllBtn.hidden = unselected === 0;
    this.selectAllBtn.textContent = filtering ? `Select all ${vis.length} matching` : `Select all ${vis.length}`;
    for (const b of [...this.moveBtns, this.removeBtn]) b.hidden = this.access === "view-only";
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

  // ─────────────────────────────────────────────────────────── edits

  private orderedSelection(): HTMLElement[] {
    return this.rows().filter((r) => this.selected.has(r));
  }
  private reorder(order: HTMLElement[]): void {
    const end = this.continuation();
    for (const r of order) if (r.isConnected) this.contents.insertBefore(r, end);
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
      order: this.rows(),
      removed: this.rows().filter((r) => !this.live(r)),
      extraRemoved: [...this.extraRemoved],
      sortKey: this.sortKey,
    };
  }
  private restore(s: Snapshot): void {
    this.reorder(s.order);
    for (const r of this.rows()) r.classList.toggle("y3s-removed", s.removed.includes(r));
    this.extraRemoved = new Set(s.extraRemoved);
    this.sortKey = s.sortKey;
    this.updateSortLabel();
    this.renumber();
    this.refresh();
  }

  /** Apply an edit on the page now; save it to YouTube after the undo window. */
  private commit(label: string, edit: () => void, save: boolean): void {
    const before = this.snapshot();
    this.savedSnap ??= before;
    this.history.push(before);
    edit();
    this.renumber();
    this.refresh();
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

  /** Why an edit can't happen right now, already told to the user; or null. */
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

  async moveTo(where: "top" | "bottom"): Promise<void> {
    if (!this.selected.size || this.blockedReason("reorder")) return;
    if (!(await this.ensureAllLoaded())) return;
    const sel = this.orderedSelection();
    const rest = this.rows().filter((r) => !this.selected.has(r));
    this.commit(
      `Moved ${count(sel.length, "video")} to ${where}`,
      () => {
        this.reorder(where === "top" ? [...sel, ...rest] : [...rest, ...sel]);
        this.sortKey = "manual";
        this.updateSortLabel();
      },
      true,
    );
    sel[0]?.scrollIntoView({ block: "nearest" });
  }

  removeSelected(): void {
    if (!this.selected.size || this.blockedReason("remove")) return;
    const sel = this.orderedSelection();
    this.commit(
      `Removed ${count(sel.length, "video")}`,
      () => {
        sel.forEach((r) => r.classList.add("y3s-removed"));
        this.selected.clear();
      },
      true,
    );
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
    this.commit(
      `Removed ${count(extra.length, "extra copy", "extra copies")}`,
      () => {
        extra.forEach((r) => {
          r.classList.add("y3s-removed");
          this.selected.delete(r);
        });
        this.chip = "all";
      },
      true,
    );
  }

  removeUnavailable(): void {
    if (this.blockedReason("remove")) return;
    const rows = this.rows().filter((r) => this.live(r) && this.data.get(r)?.unavailable);
    const hidden = this.hiddenUnavailable.filter((id) => !this.extraRemoved.has(id));
    const n = rows.length + hidden.length;
    if (!n) return;
    this.commit(
      `Removed ${count(n, "unavailable video")}`,
      () => {
        rows.forEach((r) => {
          r.classList.add("y3s-removed");
          this.selected.delete(r);
        });
        hidden.forEach((id) => this.extraRemoved.add(id));
        this.chip = "all";
      },
      true,
    );
  }

  playSelected(): void {
    const ids = this.orderedSelection()
      .map((r) => this.data.get(r)?.videoId)
      .filter((v): v is string => !!v);
    if (!ids.length) return;
    location.assign(`https://www.youtube.com/watch_videos?video_ids=${ids.slice(0, MAX_QUEUE_IDS).join(",")}`);
  }

  // ─────────────────────────────────────────────────────────── sorting

  private updateSortLabel(): void {
    const label = SORTS.find(([k]) => k === this.sortKey)?.[1] ?? "";
    this.sortLabel.textContent = this.sortKey === "manual" ? "Sort" : `Sort: ${label.replace(/ \(A–Z\)| first| current order| once/, "")}`;
    this.sortChip.setAttribute("aria-pressed", String(this.sortKey !== "manual"));
  }

  private openSort(): void {
    toggleMenu(
      this.sortChip,
      SORTS.map(([key, label]) => ({ label, checked: key === this.sortKey, run: () => void this.sortBy(key) })),
    );
  }

  async sortBy(key: SortKey): Promise<void> {
    // On playlists you can reorder, a sort is a real edit; elsewhere it only
    // changes how the page shows the list.
    const save = this.canReorder;
    if (save && !(await this.ensureAllLoaded())) return;
    const rows = this.rows();
    const order = sortOrder(
      rows.map((r) => this.data.get(r)!),
      key,
      rows.map((r) => Number(r.dataset[ORIG])),
    ).map((i) => rows[i]);
    const label = SORTS.find(([k]) => k === key)![1];
    const msg = key === "manual" ? "Back to playlist order" : `Sorted: ${label}`;
    this.commit(
      save || key === "manual" ? msg : `${msg} (only on this page)`,
      () => {
        this.reorder(order);
        this.sortKey = key;
        this.updateSortLabel();
      },
      true,
    );
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
    if (e.defaultPrevented || isDialogOpen() || isMenuOpen()) return;
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
        if (this.focusRow && !t?.closest?.("button, a")) this.data.get(this.focusRow)?.anchor?.click();
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
