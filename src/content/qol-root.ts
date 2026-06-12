// Orchestrates the QoL layer: shadow-hosted toolbar + toast, the native-list
// indexer, selection, row annotations, keyboard nav, and bulk actions.

import { sendMessage } from "../shared/messages";
import type { NativeRow, Track } from "../shared/types";
import { count, formatSeconds, messageForError, runSequential } from "../shared/utils";
import { SelectionStore } from "../state/selection-store";
import { buildDeletePlan } from "../state/operation-planner";
import { findDuplicateVideoIds, rowMatchesQuery, totalRuntimeSeconds } from "../state/qol-derive";
import { toCSV, toJSON, toMarkdown, copyToClipboard, downloadFile } from "../state/exporters";
import { confirmModal, h } from "../ui/components";
import { Toast } from "../ui/toast";
import { QolToolbar, type ExportFormat, type ExportTarget } from "../ui/qol-toolbar";
import { bindKeyboardNav } from "../ui/keyboard-nav";
import { NativeList } from "./native-list";
import { createMount, type Mount } from "./mount-point";
import {
  injectAnnotationStyles,
  ensureCheckbox,
  setRowChecked,
  setRowClass,
  clearRow,
} from "./annotations";
import styles from "../styles/qol.css";

export class QolRoot {
  private mount: Mount;
  private overlay: HTMLElement;
  private toolbar: QolToolbar;
  private toast: Toast;
  private selection = new SelectionStore();
  private list: NativeList;
  private playlistId = "";
  private query = "";
  private focused: HTMLElement | null = null;
  private detachers: Array<() => void> = [];

  constructor() {
    this.mount = createMount({ hideNative: false });
    injectAnnotationStyles();
    const shadow = this.mount.host.attachShadow({ mode: "open" });
    shadow.append(h("style", { html: styles }));

    this.toolbar = new QolToolbar({
      onSearch: (q) => this.setQuery(q),
      onJumpDup: () => this.jumpToNextDup(),
      onDelete: () => this.deleteSelected(),
      onOpenTabs: () => this.openSelectedInTabs(),
      onExport: (f, t) => this.exportRows(f, t),
    });

    this.overlay = h("div", { class: "pf-overlay" });
    this.overlay.append(this.toolbar.el);
    shadow.append(this.overlay);

    // Toasts live inside the shadow overlay so qol.css styles them.
    this.toast = new Toast(this.overlay);

    this.list = new NativeList((rows) => this.onRowsChanged(rows));

    this.detachers.push(
      this.selection.subscribe(() => this.onSelectionChanged()),
      bindKeyboardNav({
        visibleRows: () => this.visibleRowEls(),
        ownRoot: this.mount.host,
        focusSearch: () => this.toolbar.focusSearch(),
        onOpen: (row) => this.openRow(row),
        onToggleSelect: (row) => this.toggleRow(row),
        onCopyLink: (row) => this.copyRowLink(row),
        setFocused: (row) => this.setFocused(row),
      }),
    );
  }

  setPlaylist(playlistId: string): void {
    this.playlistId = playlistId;
    this.selection.clear();
    this.list.start();
  }

  destroy(): void {
    for (const d of this.detachers) d();
    this.list.stop();
    for (const r of this.list.rows) clearRow(r.el);
    this.mount.destroy();
  }

  // ── reactive rendering ───────────────────────────────────────────────────

  private onRowsChanged(rows: NativeRow[]): void {
    const dups = findDuplicateVideoIds(rows);
    for (const r of rows) {
      ensureCheckbox(r.el, () => this.toggleRow(r.el));
      setRowClass(r.el, "dup", dups.has(r.videoId));
      setRowClass(r.el, "hidden", !rowMatchesQuery(r, this.query));
      setRowChecked(r.el, this.selection.has(r.videoId));
    }
    this.toolbar.setDupCount(dups.size);
    this.refreshRuntime(rows);
    this.toolbar.setSelectedCount(this.selection.size);
  }

  private refreshRuntime(rows: NativeRow[]): void {
    const visible = rows.filter((r) => rowMatchesQuery(r, this.query));
    const total = this.youtubeTotalCount() ?? rows.length;
    this.toolbar.setRuntime(totalRuntimeSeconds(visible), visible.length, total, formatSeconds);
  }

  /** YouTube shows the playlist's true total count in its header stats. */
  private youtubeTotalCount(): number | null {
    const txt =
      document.querySelector("ytd-playlist-sidebar-primary-info-renderer #stats")?.textContent ?? "";
    const m = /([\d,]+)\s+videos?/i.exec(txt);
    return m ? Number(m[1].replace(/,/g, "")) : null;
  }

  private setQuery(q: string): void {
    this.query = q;
    for (const r of this.list.rows) setRowClass(r.el, "hidden", !rowMatchesQuery(r, this.query));
    this.refreshRuntime(this.list.rows);
  }

  private onSelectionChanged(): void {
    for (const r of this.list.rows) setRowChecked(r.el, this.selection.has(r.videoId));
    this.toolbar.setSelectedCount(this.selection.size);
  }

  // ── row helpers ─────────────────────────────────────────────────────────

  private rowFor(el: HTMLElement): NativeRow | undefined {
    return this.list.rows.find((r) => r.el === el);
  }
  private visibleRowEls(): HTMLElement[] {
    return this.list.rows.filter((r) => rowMatchesQuery(r, this.query)).map((r) => r.el);
  }
  private toggleRow(el: HTMLElement): void {
    const row = this.rowFor(el);
    if (row) this.selection.toggle(row.videoId, row.index);
  }
  private openRow(el: HTMLElement): void {
    const row = this.rowFor(el);
    if (row) window.open(`https://www.youtube.com/watch?v=${row.videoId}`, "_blank", "noopener");
  }
  private async copyRowLink(el: HTMLElement): Promise<void> {
    const row = this.rowFor(el);
    if (!row) return;
    await copyToClipboard(`https://www.youtube.com/watch?v=${row.videoId}`);
    this.toast.show("Link copied.");
  }
  private setFocused(el: HTMLElement | null): void {
    if (this.focused) setRowClass(this.focused, "focused", false);
    this.focused = el;
    if (el) setRowClass(el, "focused", true);
  }
  private jumpToNextDup(): void {
    const dups = findDuplicateVideoIds(this.list.rows);
    const start = this.focused ? this.list.rows.findIndex((r) => r.el === this.focused) : -1;
    const ordered = [...this.list.rows.slice(start + 1), ...this.list.rows.slice(0, start + 1)];
    const next = ordered.find((r) => dups.has(r.videoId));
    if (next) {
      this.setFocused(next.el);
      next.el.scrollIntoView({ block: "center" });
    }
  }

  // ── actions ──────────────────────────────────────────────────────────────

  private selectedRows(): NativeRow[] {
    const sel = this.selection.values();
    return this.list.rows.filter((r) => sel.has(r.videoId));
  }

  private openSelectedInTabs(): void {
    const rows = this.selectedRows();
    if (rows.length === 0) return;
    if (rows.length > 10 && !confirm(`Open ${rows.length} tabs?`)) return;
    for (const r of rows) window.open(`https://www.youtube.com/watch?v=${r.videoId}`, "_blank", "noopener");
  }

  private async exportRows(format: ExportFormat, target: ExportTarget): Promise<void> {
    const sel = this.selectedRows();
    const rows = sel.length > 0 ? sel : this.list.rows;
    const text = format === "json" ? toJSON(rows) : format === "csv" ? toCSV(rows) : toMarkdown(rows);
    if (target === "copy") {
      await copyToClipboard(text);
      this.toast.success(`Copied ${count(rows.length, "row")} as ${format.toUpperCase()}.`);
    } else {
      const ext = format === "md" ? "md" : format;
      const mime =
        format === "json" ? "application/json" : format === "csv" ? "text/csv" : "text/markdown";
      downloadFile(`playlist-${this.playlistId}.${ext}`, text, mime);
      this.toast.success(`Downloaded ${rows.length} rows as ${format.toUpperCase()}.`);
    }
  }

  /** Resolve playlistItemIds for the selected videoIds via the API (sign-in). */
  private async resolveItems(videoIds: Set<string>): Promise<Map<string, string> | null> {
    const auth = await sendMessage({ type: "AUTH_GET_TOKEN", interactive: true });
    if (!auth.ok) {
      this.toast.error(messageForError(auth.error));
      return null;
    }
    const res = await sendMessage({ type: "FETCH_PLAYLIST_ITEMS", playlistId: this.playlistId });
    if (!res.ok) {
      this.toast.error(messageForError(res.error));
      return null;
    }
    const map = new Map<string, string>();
    for (const item of res.data.items) {
      if (videoIds.has(item.videoId)) map.set(item.videoId, item.playlistItemId);
    }
    return map;
  }

  private async deleteSelected(): Promise<void> {
    const rows = this.selectedRows();
    if (rows.length === 0) return;

    const itemMap = await this.resolveItems(this.selection.values());
    if (!itemMap) return;

    const tracks: Track[] = rows
      .filter((r) => itemMap.has(r.videoId))
      .map((r) => ({
        playlistItemId: itemMap.get(r.videoId)!,
        videoId: r.videoId,
        title: r.title,
        position: r.index,
        url: `https://www.youtube.com/watch?v=${r.videoId}`,
      }));

    if (tracks.length === 0) {
      this.toast.error("Couldn't match selected videos to this playlist.");
      return;
    }

    const plan = buildDeletePlan(tracks);
    const ok = await confirmModal(this.overlay, {
      title: "Delete selected videos?",
      body: h(
        "div",
        {},
        h("p", {}, `Delete ${count(tracks.length, "video")} from this playlist via the YouTube API.`),
        h("p", { class: "pf-muted" }, `Estimated quota: ${plan.estimatedQuotaCost} units. This cannot be undone.`),
      ),
      confirmLabel: `Delete ${count(tracks.length, "video")}`,
      danger: true,
    });
    if (!ok) return;

    const results = await runSequential(tracks, (t) =>
      sendMessage({ type: "DELETE_PLAYLIST_ITEM", playlistItemId: t.playlistItemId }),
    );
    let okCount = 0;
    results.forEach((r, i) => {
      if (!r.ok) return;
      okCount++;
      const row = this.list.rows.find((x) => x.videoId === tracks[i].videoId);
      if (row) setRowClass(row.el, "hidden", true); // optimistically hide
    });
    this.selection.clear();
    if (okCount === tracks.length) this.toast.success(`Deleted ${count(okCount, "video")}. Reload to fully resync.`);
    else this.toast.error(`Deleted ${okCount}/${tracks.length}. Some failed — reload and retry.`);
  }
}
