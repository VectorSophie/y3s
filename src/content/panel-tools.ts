// Filter, "jump to now playing" and phase headers for the playlist panel
// beside the player. Read-only: the watch page has its own shortcuts, so no
// extra keys here. Clicking a phase header plays that phase.

import { matchesQuery } from "../core/filter";
import { startPlay, type PlayItem } from "../core/phase-play";
import { savePlay } from "./phase-player";
import { loadPhases, type StoredPhase } from "./phase-store";
import { h, icon, ICONS } from "./ui/dom";
import { currentPlaylistId, readRow, SEL } from "./yt-dom";

const HEAD = "y3s-panel-phase";

export class PanelTools {
  readonly panel: HTMLElement;
  readonly bar: HTMLElement;
  private items: HTMLElement;
  private input: HTMLInputElement;
  private clearBtn: HTMLElement;
  private countEl: HTMLElement;
  private obs: MutationObserver;
  private timer = 0;
  private listId: string | null = null;
  private phases: StoredPhase[] = [];
  private heads: HTMLElement[] = [];

  constructor(panel: HTMLElement) {
    this.panel = panel;
    this.items = panel.querySelector<HTMLElement>(SEL.panelItems)!;
    this.input = h("input", {
      type: "text",
      placeholder: "Filter playlist",
      "aria-label": "Filter playlist",
      spellcheck: "false",
      autocomplete: "off",
      oninput: () => this.refresh(),
      onkeydown: (e: KeyboardEvent) => {
        // Keep the player's own shortcuts (k, j, f, m…) out of the way while typing.
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          const first = this.visible()[0];
          if (first) (readRow(first).anchor ?? first.querySelector<HTMLElement>("ytmusic-play-button-renderer, .song-title") ?? first).click();
        } else if (e.key === "Escape") {
          e.preventDefault();
          if (this.input.value) this.setQuery("");
          else this.input.blur();
        }
      },
    });
    this.clearBtn = h(
      "button",
      {
        class: "y3s-icon-btn y3s-clear",
        "aria-label": "Clear filter",
        onclick: () => {
          this.setQuery("");
          this.input.focus();
        },
      },
      icon(ICONS.close),
    );
    this.countEl = h("span", { class: "y3s-panel-count" });
    this.bar = h(
      "div",
      { class: "y3s-panel-bar" },
      h(
        "div",
        { class: "y3s-search y3s-search-compact", onclick: () => this.input.focus() },
        icon(ICONS.search),
        this.input,
        this.clearBtn,
      ),
      this.countEl,
      h(
        "button",
        {
          class: "y3s-icon-btn",
          "aria-label": "Jump to now playing",
          title: "Jump to now playing",
          onclick: () => this.jumpToCurrent(),
        },
        icon(ICONS.locate),
      ),
    );
    this.items.before(this.bar);
    this.obs = new MutationObserver((muts) => {
      // Our own phase headers going in and out aren't YouTube's changes.
      const ours = (n: Node) => n instanceof HTMLElement && n.classList.contains(HEAD);
      if (muts.every((m) => [...m.addedNodes, ...m.removedNodes].every(ours))) return;
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.refresh(), 100);
    });
    this.obs.observe(this.items, { childList: true });
    this.refresh();
  }

  destroy(): void {
    this.obs.disconnect();
    clearTimeout(this.timer);
    this.bar.remove();
    this.heads.forEach((el) => el.remove());
    this.rows().forEach((r) => r.classList.remove("y3s-hidden"));
  }

  rows(): HTMLElement[] {
    return [...this.items.querySelectorAll<HTMLElement>(SEL.panelRow)];
  }
  visible(): HTMLElement[] {
    return this.rows().filter((r) => !r.classList.contains("y3s-hidden"));
  }
  setQuery(q: string): void {
    this.input.value = q;
    this.refresh();
  }

  refresh(): void {
    const q = this.input.value;
    const rows = this.rows();
    let n = 0;
    for (const r of rows) {
      const ok = matchesQuery(readRow(r), q);
      r.classList.toggle("y3s-hidden", !ok);
      if (ok) n++;
    }
    this.clearBtn.hidden = !q;
    this.countEl.textContent = q.trim() ? `${n} of ${rows.length}` : "";
    if (currentPlaylistId() !== this.listId) {
      const id = (this.listId = currentPlaylistId());
      this.phases = [];
      if (id)
        void loadPhases(id).then((p) => {
          if (id !== this.listId) return;
          this.phases = p;
          this.placeHeads();
        });
    }
    this.placeHeads();
  }

  /** Put a header before the first row of each phase saved for this playlist
   *  (found the way the playlist page saved them: video id + which copy). */
  private placeHeads(): void {
    this.heads.forEach((el) => el.remove());
    this.heads = [];
    if (!this.phases.length || this.input.value.trim()) return;
    const rows = this.rows();
    const ids = rows.map((r) => readRow(r).videoId ?? "");
    const seen = new Map<string, number>();
    const nth = ids.map((v) => {
      const n = seen.get(v) ?? 0;
      seen.set(v, n + 1);
      return n;
    });
    const starts = this.phases.map((p) => {
      if (!p.after) return 0;
      const i = ids.findIndex((v, j) => v === p.after!.videoId && nth[j] === p.after!.nth);
      return i < 0 ? -1 : i + 1;
    });
    this.phases.forEach((p, k) => {
      const start = starts[k];
      const end = starts.slice(k + 1).find((s) => s >= start) ?? rows.length;
      if (start < 0 || start >= end) return;
      const span = rows.slice(start, end);
      const head = h(
        "button",
        {
          class: HEAD,
          title: `Play ${p.name}`,
          onclick: () => this.playPhase(p.name, span),
        },
        icon(ICONS.play),
        h("span", { class: "y3s-panel-phase-name", text: p.name }),
        h("span", { class: "y3s-panel-phase-meta", text: `${span.length} video${span.length === 1 ? "" : "s"}` }),
      );
      head.classList.toggle("y3s-current", span.some((r) => r.hasAttribute("selected")));
      rows[start].before(head);
      this.heads.push(head);
    });
  }

  private playPhase(name: string, rows: HTMLElement[]): void {
    const items: PlayItem[] = [];
    for (const r of rows) {
      const { videoId, anchor } = readRow(r);
      const index = Number(new URLSearchParams(anchor?.getAttribute("href")?.split("?")[1]).get("index"));
      if (videoId) items.push({ videoId, index: index || this.rows().indexOf(r) + 1 });
    }
    if (!items.length || !this.listId) return;
    savePlay(startPlay({ playlistId: this.listId, name, items, loop: false, shuffle: false }));
    readRow(rows[0]).anchor?.click();
  }

  jumpToCurrent(): void {
    const cur = this.rows().find((r) => r.hasAttribute("selected"));
    if (!cur) return;
    if (cur.classList.contains("y3s-hidden")) this.setQuery("");
    cur.scrollIntoView({ block: "center", behavior: "smooth" });
    cur.classList.remove("y3s-flash");
    void cur.offsetWidth;
    cur.classList.add("y3s-flash");
  }
}
