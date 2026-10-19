// Smaller helpers on other YouTube surfaces:
//  - a search field in YouTube's own "Save to playlist" sheet,
//  - a filter over the grid on your playlists page (/feed/playlists).

import { normalize } from "../shared/utils";
import { h, icon, ICONS } from "./ui/dom";

const shown = (el: Element) => el.getClientRects().length > 0;

/** Both the older dialog and the newer sheet YouTube uses for "Save to…". */
const SHEETS = [
  { list: "ytd-add-to-playlist-renderer #playlists", item: "ytd-playlist-add-to-option-renderer" },
  { list: "yt-list-view-model", item: "toggleable-list-item-view-model" },
];
const MIN_ITEMS = 6;

export class SaveSheetFilter {
  private inputs = new WeakMap<Element, HTMLInputElement>();

  /** Called whenever the page changes; cheap when no sheet is open. */
  check(): void {
    for (const s of SHEETS) {
      for (const list of document.querySelectorAll<HTMLElement>(s.list)) {
        const items = [...list.querySelectorAll<HTMLElement>(`:scope > ${s.item}, :scope ${s.item}`)];
        // The newer list view is used for other menus too; the checkbox
        // items only appear in "Save to…".
        if (items.length < MIN_ITEMS) continue;
        let input = this.inputs.get(list);
        if (!input || !input.isConnected) {
          input = this.attach(list, s.item);
          this.inputs.set(list, input);
        }
        if (!shown(list) && input.value) {
          // Sheet closed: start fresh next time.
          input.value = "";
          this.apply(list, s.item, "");
        }
      }
    }
  }

  private attach(list: HTMLElement, item: string): HTMLInputElement {
    const input = h("input", {
      class: "y3s-sheet-input",
      type: "text",
      placeholder: "Search playlists",
      "aria-label": "Search playlists",
      spellcheck: "false",
      autocomplete: "off",
      oninput: () => this.apply(list, item, input.value),
      onkeydown: (e: KeyboardEvent) => {
        // Typing must not trigger YouTube's player shortcuts.
        e.stopPropagation();
        if (e.key === "Escape" && input.value) {
          e.preventDefault();
          input.value = "";
          this.apply(list, item, "");
        }
      },
    });
    const wrap = h("div", { class: "y3s-sheet-search" }, icon(ICONS.search), input);
    list.before(wrap);
    return input;
  }

  private apply(list: HTMLElement, item: string, q: string): void {
    const words = normalize(q).split(/\s+/).filter(Boolean);
    for (const el of list.querySelectorAll<HTMLElement>(item)) {
      const text = normalize(el.textContent ?? "");
      el.classList.toggle("y3s-hidden", !words.every((w) => text.includes(w)));
    }
  }
}

/** Filter for the grid of your playlists. */
export class PlaylistsPageFilter {
  readonly bar: HTMLElement;
  private input: HTMLInputElement;
  private countEl: HTMLElement;
  private obs: MutationObserver;

  constructor(readonly grid: HTMLElement) {
    this.input = h("input", {
      type: "text",
      placeholder: "Filter your playlists",
      "aria-label": "Filter your playlists",
      spellcheck: "false",
      autocomplete: "off",
      oninput: () => this.apply(),
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          this.input.value = "";
          this.apply();
        }
      },
    });
    this.countEl = h("span", { class: "y3s-panel-count" });
    this.bar = h(
      "div",
      { class: "y3s-grid-bar" },
      h("div", { class: "y3s-search", onclick: () => this.input.focus() }, icon(ICONS.search), this.input),
      this.countEl,
    );
    grid.before(this.bar);
    this.obs = new MutationObserver(() => this.apply());
    const contents = grid.querySelector("#contents") ?? grid;
    this.obs.observe(contents, { childList: true });
    this.apply();
  }

  static find(): HTMLElement | null {
    if (location.pathname !== "/feed/playlists") return null;
    return [...document.querySelectorAll<HTMLElement>("ytd-rich-grid-renderer")].find(shown) ?? null;
  }

  items(): HTMLElement[] {
    return [...this.grid.querySelectorAll<HTMLElement>("ytd-rich-item-renderer")];
  }

  apply(): void {
    const words = normalize(this.input.value).split(/\s+/).filter(Boolean);
    const items = this.items();
    let n = 0;
    for (const it of items) {
      const ok = words.every((w) => normalize(it.textContent ?? "").includes(w));
      it.classList.toggle("y3s-hidden", !ok);
      if (ok) n++;
    }
    this.countEl.textContent = words.length ? `${n} of ${items.length}` : "";
  }

  destroy(): void {
    this.obs.disconnect();
    this.bar.remove();
    this.items().forEach((i) => i.classList.remove("y3s-hidden"));
  }
}
