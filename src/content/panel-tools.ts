// Filter and "jump to now playing" for the playlist panel beside the player.
// Read-only: the watch page has its own shortcuts, so no extra keys here.

import { matchesQuery } from "../core/filter";
import { h, icon, ICONS } from "./ui/dom";
import { readRow, SEL } from "./yt-dom";

export class PanelTools {
  readonly panel: HTMLElement;
  readonly bar: HTMLElement;
  private items: HTMLElement;
  private input: HTMLInputElement;
  private clearBtn: HTMLElement;
  private countEl: HTMLElement;
  private obs: MutationObserver;
  private timer = 0;

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
    this.obs = new MutationObserver(() => {
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
