// The in-place panel: composes header, toolbar, action bar, track list, and
// toast, and owns view state (search / filter / sort / grouping) + edit flows.

import { sendMessage } from "../shared/messages";
import type { Result, Track } from "../shared/types";
import { count, fuzzyIncludes, messageForError, runSequential } from "../shared/utils";
import { PhaseStore } from "../state/phase-store";
import { PlaylistStore, type PlaylistState } from "../state/playlist-store";
import { SelectionStore } from "../state/selection-store";
import {
  buildDeletePlan,
  buildMovePlan,
} from "../state/operation-planner";
import { confirmModal, h, icon } from "./components";
import { enableDragSelect } from "./drag-select";
import { PhaseController } from "./phases";
import { bindShortcuts } from "./shortcuts";
import { Toast } from "./toast";
import { TrackList, type DisplayItem } from "./track-list";
import { ActionBar, Toolbar, type FilterId, type SortId } from "./toolbar";

export class Panel {
  readonly el: HTMLElement; // the in-column panel root

  /** Set by panel-root to flip back to YouTube's native list. */
  onShowOriginal?: () => void;

  private body: HTMLElement;
  private titleEl: HTMLElement;
  private countEl: HTMLElement;
  private badge: HTMLElement;

  private toolbar: Toolbar;
  private actionBar: ActionBar;
  private list: TrackList;
  private toast: Toast;
  private phaseCtl: PhaseController;

  private query = "";
  private filter: FilterId = "all";
  private sort: SortId = "current";
  private visibleTrackIds: string[] = [];
  private detachers: Array<() => void> = [];

  constructor(
    private mount: HTMLElement, // shadow root content host (for modals/menus)
    private playlist: PlaylistStore,
    private selection: SelectionStore,
    private phases: PhaseStore,
  ) {
    this.toast = new Toast(mount);
    this.phaseCtl = new PhaseController(mount, phases, this.toast);

    // Header
    this.titleEl = h("div", { class: "pf-head__title" }, "y3s");
    this.countEl = h("div", { class: "pf-head__count" }, "");
    this.badge = h("span", { class: "pf-badge", hidden: true }, "page view");
    const showOriginalBtn = h(
      "button",
      {
        class: "pf-btn pf-btn--ghost pf-head__toggle",
        title: "Show YouTube's original list",
        onClick: () => this.onShowOriginal?.(),
      },
      "Show original",
    );
    const header = h(
      "div",
      { class: "pf-head" },
      h("div", { class: "pf-head__brand" }, icon("logo", 18), h("span", { class: "pf-head__wordmark" }, "y3s")),
      h("div", { class: "pf-head__meta" }, this.titleEl, h("div", { class: "pf-head__sub" }, this.countEl, this.badge)),
      showOriginalBtn,
    );

    // Toolbar + action bar + list
    this.toolbar = new Toolbar({
      onSearch: (q) => this.setQuery(q),
      onFilter: (f) => this.setFilter(f),
      onSort: (s) => this.setSort(s),
    });
    this.actionBar = new ActionBar({
      onClear: () => this.selection.clear(),
      onDelete: () => this.deleteSelected(),
      onMoveTop: () => this.moveSelected("top"),
      onMoveBottom: () => this.moveSelected("bottom"),
      onAssignPhase: (anchor) => this.phaseCtl.openAssignMenu(anchor, [...this.selection.values()]),
    });
    this.list = new TrackList({
      onRowClick: (videoId, index, mods) => this.onRowClick(videoId, index, mods),
      onCheckbox: (videoId, index) => this.selection.toggle(videoId, index),
      onOpen: (track) => window.open(track.url, "_blank", "noopener"),
      onToggleCollapse: (id) => this.phases.toggleCollapsed(id),
      onRenamePhase: (id) => this.phaseCtl.rename(id),
      onDeletePhase: (id) => this.phaseCtl.delete(id),
    });

    this.body = h("div", { class: "pf-body" }, this.toolbar.el, this.actionBar.el, this.list.el);
    this.el = h("section", { class: "pf-panel", role: "region", "aria-label": "y3s playlist editor" }, header, this.body);

    this.wire();
  }

  // ── lifecycle ──────────────────────────────────────────────────────────

  private wire(): void {
    this.detachers.push(
      this.playlist.subscribe((s) => this.onPlaylistChange(s)),
      this.selection.subscribe(() => this.onSelectionChange()),
      this.phases.subscribe(() => this.recompute()),
      bindShortcuts(this.el, {
        clearOrClose: () => this.selection.clear(),
        selectAll: () => this.selection.selectAll(this.visibleTrackIds),
        focusSearch: () => this.toolbar.focusSearch(),
        requestDelete: () => this.deleteSelected(),
        createPhase: () => this.phaseCtl.createAndAssign([...this.selection.values()]),
        openSort: () => this.toast.show("Use the sort dropdown in the toolbar (S)."),
      }),
      enableDragSelect({
        surface: this.list.el,
        getTargets: () => this.list.hitTargets(),
        onSelect: (ids, additive) => this.selection.applyDrag(ids, additive),
      }),
    );
  }

  destroy(): void {
    for (const d of this.detachers) d();
    this.detachers = [];
  }

  // ── view state ─────────────────────────────────────────────────────────

  private setQuery(q: string): void {
    this.query = q;
    this.recompute();
  }
  private setFilter(f: FilterId): void {
    this.filter = f;
    this.toolbar.setActiveFilter(f);
    this.recompute();
  }
  private setSort(s: SortId): void {
    this.sort = s;
    if (s !== "current") this.toast.show("Sort preview only — “Apply to YouTube” is planned.");
    this.recompute();
  }

  private onPlaylistChange(s: PlaylistState): void {
    const src = s.snapshot?.source;
    this.badge.hidden = !(s.isMock || src === "dom");
    this.badge.textContent = s.isMock ? "mock" : "page view";
    if (s.status === "loading") {
      this.titleEl.textContent = "Loading playlist…";
      this.countEl.textContent = "";
      this.list.el.replaceChildren(h("div", { class: "pf-loading" }, "Fetching playlist from YouTube…"));
      return;
    }
    if (s.status === "error" && s.error) {
      this.titleEl.textContent = "Couldn't load playlist";
      this.renderError(messageForError(s.error), s.error.code === "NOT_SIGNED_IN");
      return;
    }
    if (s.snapshot) {
      this.titleEl.textContent = s.snapshot.title ?? "Playlist";
      this.selection.prune(new Set(s.snapshot.items.map((t) => t.videoId)));
      this.recompute();
    }
  }

  private onSelectionChange(): void {
    this.actionBar.setCount(this.selection.size);
    this.updateChipCounts();
    if (this.filter === "selected") this.recompute();
    else this.list.updateSelection(this.selection.values());
  }

  // ── derive + render the visible model ────────────────────────────────────

  private recompute(): void {
    const all = this.playlist.tracks;
    if (this.playlist.get().status !== "ready") return;

    const dupIds = this.duplicateVideoIds(all);
    let tracks = all.filter((t) => this.matchesSearch(t));
    tracks = tracks.filter((t) => this.matchesFilter(t, dupIds));
    tracks = this.sortTracks(tracks);

    const items = this.group(tracks);
    this.list.render(items, this.selection.values());
    this.countEl.textContent = count(all.length, "track");
    this.updateChipCounts();
  }

  private matchesSearch(t: Track): boolean {
    if (!this.query) return true;
    return (
      fuzzyIncludes(t.title, this.query) ||
      fuzzyIncludes(t.channelTitle ?? "", this.query) ||
      t.videoId.includes(this.query)
    );
  }

  private matchesFilter(t: Track, dupIds: Set<string>): boolean {
    switch (this.filter) {
      case "selected":
        return this.selection.has(t.videoId);
      case "unphased":
        return !this.phases.phaseOf(t.videoId);
      case "duplicates":
        return dupIds.has(t.videoId);
      default:
        return true;
    }
  }

  private sortTracks(tracks: Track[]): Track[] {
    const out = [...tracks];
    switch (this.sort) {
      case "reverse":
        return out.sort((a, b) => b.position - a.position);
      case "title":
        return out.sort((a, b) => a.title.localeCompare(b.title));
      case "channel":
        return out.sort((a, b) => (a.channelTitle ?? "").localeCompare(b.channelTitle ?? ""));
      default:
        return out.sort((a, b) => a.position - b.position);
    }
  }

  /** Group tracks under phase headers + an Unphased group; assign flat indices. */
  private group(tracks: Track[]): DisplayItem[] {
    const items: DisplayItem[] = [];
    this.visibleTrackIds = [];
    let index = 0;

    const byPhase = new Map<string, Track[]>();
    const unphased: Track[] = [];
    for (const t of tracks) {
      const phase = this.phases.phaseOf(t.videoId);
      if (phase) (byPhase.get(phase.id) ?? byPhase.set(phase.id, []).get(phase.id)!).push(t);
      else unphased.push(t);
    }

    const showEmpty = this.query === "" && this.filter === "all";

    for (const phase of this.phases.list()) {
      const group = byPhase.get(phase.id) ?? [];
      if (group.length === 0 && !showEmpty) continue;
      items.push({ kind: "header", phase, trackCount: group.length, collapsed: !!phase.collapsed });
      if (!phase.collapsed) {
        for (const t of group) {
          items.push({ kind: "track", track: t, index: index++, phase });
          this.visibleTrackIds.push(t.videoId);
        }
      }
    }

    if (unphased.length > 0) {
      // Only show the "Unphased" header when phases exist (otherwise it's just the list).
      if (this.phases.list().length > 0) {
        items.push({ kind: "header", phase: null, trackCount: unphased.length, collapsed: false });
      }
      for (const t of unphased) {
        items.push({ kind: "track", track: t, index: index++ });
        this.visibleTrackIds.push(t.videoId);
      }
    }
    return items;
  }

  private duplicateVideoIds(all: Track[]): Set<string> {
    const byTitle = new Map<string, Track[]>();
    for (const t of all) {
      const key = t.title.trim().toLowerCase();
      (byTitle.get(key) ?? byTitle.set(key, []).get(key)!).push(t);
    }
    const dup = new Set<string>();
    for (const group of byTitle.values()) {
      if (group.length > 1) group.forEach((t) => dup.add(t.videoId));
    }
    return dup;
  }

  private updateChipCounts(): void {
    const all = this.playlist.tracks;
    this.toolbar.setChipCounts({
      all: all.length,
      selected: this.selection.size,
      unphased: all.filter((t) => !this.phases.phaseOf(t.videoId)).length,
      duplicates: this.duplicateVideoIds(all).size,
    });
  }

  // ── selection interaction ────────────────────────────────────────────────

  private onRowClick(videoId: string, index: number, mods: { shift: boolean; meta: boolean }): void {
    if (mods.shift) this.selection.selectRange(index, this.visibleTrackIds);
    else if (mods.meta) this.selection.toggle(videoId, index);
    else this.selection.setSingle(videoId, index);
  }

  private selectedTracks(): Track[] {
    const sel = this.selection.values();
    return this.playlist.tracks.filter((t) => sel.has(t.videoId));
  }

  // ── error / connect ────────────────────────────────────────────────────

  private renderError(message: string, canConnect: boolean): void {
    const actions = h("div", { class: "pf-empty__actions" });
    actions.append(
      h("button", { class: "pf-btn pf-btn--ghost", onClick: () => this.reload() }, "Retry"),
    );
    if (canConnect) {
      actions.append(
        h("button", { class: "pf-btn pf-btn--primary", onClick: () => this.connect() }, "Connect Google account"),
      );
    }
    this.list.el.replaceChildren(
      h(
        "div",
        { class: "pf-empty" },
        h("div", { class: "pf-empty__title" }, "Something went wrong"),
        h("div", { class: "pf-empty__hint" }, message),
        actions,
      ),
    );
  }

  private reload(): void {
    const id = this.playlist.get().playlistId;
    if (id) this.playlist.load(id);
  }

  private async connect(): Promise<void> {
    const res = await sendMessage({ type: "AUTH_GET_TOKEN", interactive: true });
    if (res.ok) {
      this.toast.success("Connected. Loading playlist…");
      this.reload();
    } else {
      this.toast.error(messageForError(res.error));
    }
  }

  // ── edit flows ───────────────────────────────────────────────────────────

  /**
   * Writes need real playlistItemIds. If the current data is DOM-scraped, sign
   * in (if needed) and load the API snapshot first. Returns true when the
   * snapshot is API-backed (or mock) and the write may proceed.
   */
  private async ensureApiData(): Promise<boolean> {
    if (this.playlist.get().isMock) return true; // mock writes are local-only
    if (this.playlist.get().snapshot?.source === "api") return true;

    const auth = await sendMessage({ type: "AUTH_GET_TOKEN", interactive: true });
    if (!auth.ok) {
      this.toast.error(messageForError(auth.error));
      return false;
    }
    const id = this.playlist.get().playlistId!;
    await this.playlist.loadHybrid(id, () => this.playlist.tracks);
    if (this.playlist.get().snapshot?.source !== "api") {
      this.toast.error("Couldn't load editable playlist data from YouTube.");
      return false;
    }
    return true;
  }

  private async deleteSelected(): Promise<void> {
    if (this.selection.size === 0) {
      this.toast.show("Select some tracks to delete.");
      return;
    }
    // Ensure API-backed data first, then capture tracks (real playlistItemIds).
    if (!(await this.ensureApiData())) return;
    const tracks = this.selectedTracks();
    const plan = buildDeletePlan(tracks);
    const ok = await confirmModal(this.mount, {
      title: "Delete selected tracks?",
      body: this.planSummary(plan, tracks),
      confirmLabel: `Delete ${count(tracks.length, "track")}`,
      danger: true,
    });
    if (!ok) return;

    if (this.playlist.get().isMock) {
      this.playlist.applyDeletion(new Set(tracks.map((t) => t.playlistItemId)));
      this.selection.clear();
      this.toast.success(`(mock) Removed ${count(tracks.length, "track")}.`);
      return;
    }

    const results = await runSequential(tracks, (t) =>
      sendMessage({ type: "DELETE_PLAYLIST_ITEM", playlistItemId: t.playlistItemId }),
    );
    this.reportWrites(results, tracks, "deleted", (succeeded) =>
      this.playlist.applyDeletion(new Set(succeeded.map((t) => t.playlistItemId))),
    );
    this.selection.clear();
  }

  private async moveSelected(edge: "top" | "bottom"): Promise<void> {
    if (this.selection.size === 0) {
      this.toast.show("Select tracks to move.");
      return;
    }
    if (!(await this.ensureApiData())) return;
    const tracks = this.selectedTracks();
    const all = this.playlist.tracks;
    const plan = buildMovePlan(tracks, all, edge);

    if (this.playlist.get().isMock) {
      const ordered = this.orderedAfterMove(tracks, all, edge);
      this.playlist.applyLocalOrder(ordered);
      this.toast.success(`(mock) Moved ${count(tracks.length, "track")} to ${edge}.`);
      return;
    }

    const ok = await confirmModal(this.mount, {
      title: `Move ${count(tracks.length, "track")} to ${edge}?`,
      body: this.planSummary(plan, tracks),
      confirmLabel: "Apply to YouTube",
    });
    if (!ok) return;

    const playlistId = this.playlist.get().playlistId!;
    const ordered = this.orderedAfterMove(tracks, all, edge);
    const targetIndex = new Map(ordered.map((id, i) => [id, i]));

    const results = await runSequential(plan.operations, (op) =>
      sendMessage({
        type: "UPDATE_PLAYLIST_ITEM_POSITION",
        playlistItemId: op.playlistItemId!,
        playlistId,
        videoId: op.videoId!,
        position: targetIndex.get(op.videoId!)!,
      }),
    );
    const failed = results.filter((r) => !r.ok);
    if (failed.length === 0) {
      this.playlist.applyLocalOrder(ordered);
      this.toast.success(`Moved ${count(tracks.length, "track")} to ${edge}.`);
    } else {
      this.toast.error(
        `${count(failed.length, "move")} failed: ${messageForError((failed[0] as Extract<typeof failed[0], { ok: false }>).error)} Reload to resync.`,
      );
    }
  }

  private orderedAfterMove(selected: Track[], all: Track[], edge: "top" | "bottom"): string[] {
    const selIds = new Set(selected.map((t) => t.videoId));
    const others = all.filter((t) => !selIds.has(t.videoId)).map((t) => t.videoId);
    const sel = selected.map((t) => t.videoId);
    return edge === "top" ? [...sel, ...others] : [...others, ...sel];
  }

  /** Report a batch of write results, applying the local change for successes. */
  private reportWrites(
    results: Array<Result<unknown>>,
    tracks: Track[],
    verb: string,
    applySuccess: (succeeded: Track[]) => void,
  ): void {
    const succeeded: Track[] = [];
    const failed: Array<{ track: Track; message: string }> = [];
    results.forEach((r, i) => {
      if (r.ok) succeeded.push(tracks[i]);
      else failed.push({ track: tracks[i], message: messageForError(r.error) });
    });

    applySuccess(succeeded);

    if (failed.length === 0) {
      this.toast.success(`${verb[0].toUpperCase()}${verb.slice(1)} ${count(succeeded.length, "track")}.`);
    } else if (succeeded.length === 0) {
      this.toast.error(`Failed to ${verb.replace(/ed$/, "")}: ${failed[0].message}`);
    } else {
      this.toast.error(
        `${verb} ${succeeded.length}, but ${count(failed.length, "track")} failed (${failed[0].message}).`,
      );
    }
  }

  /** DOM summary of an operation plan for the confirmation modal. */
  private planSummary(
    plan: { estimatedApiCalls: number; estimatedQuotaCost: number; riskLevel: string; description: string },
    tracks: Track[],
  ): HTMLElement {
    const preview = tracks.slice(0, 5).map((t) => h("li", {}, t.title));
    const more = tracks.length > 5 ? h("li", { class: "pf-muted" }, `…and ${tracks.length - 5} more`) : null;
    return h(
      "div",
      {},
      h("p", {}, plan.description),
      h(
        "ul",
        { class: "pf-plan-stats" },
        h("li", {}, `API calls: ${plan.estimatedApiCalls}`),
        h("li", {}, `Estimated quota: ${plan.estimatedQuotaCost} units`),
        h("li", { class: `pf-risk pf-risk--${plan.riskLevel}` }, `Risk: ${plan.riskLevel}`),
      ),
      plan.estimatedQuotaCost >= 2500
        ? h("p", { class: "pf-warn" }, "⚠ This is quota-heavy and may fail if the playlist isn't set to manual ordering.")
        : null,
      h("ul", { class: "pf-plan-list" }, ...preview, more),
    );
  }
}
