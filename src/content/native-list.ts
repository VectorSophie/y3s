// Indexes YouTube's live playlist rows into NativeRow[] and re-indexes on
// change (lazy-load / reorder). Selectors isolated here.

import type { NativeRow } from "../shared/types";
import { parseDurationText } from "../shared/utils";

const ROW = "ytd-playlist-video-renderer";
const LIST_CONTAINERS = [
  "ytd-playlist-video-list-renderer #contents",
  "ytd-playlist-video-list-renderer",
];

function videoIdFromHref(href: string | null): string | null {
  if (!href) return null;
  const m = /[?&]v=([^&]+)/.exec(href);
  return m ? m[1] : null;
}

function text(el: Element | null): string | undefined {
  const t = el?.textContent?.trim();
  return t ? t : undefined;
}

/** Parse the currently-rendered rows into NativeRow[] (DOM order = index). */
export function parseRows(): NativeRow[] {
  const out: NativeRow[] = [];
  document.querySelectorAll(ROW).forEach((el) => {
    const anchor = el.querySelector("a#video-title") as HTMLAnchorElement | null;
    const videoId = videoIdFromHref(anchor?.getAttribute("href") ?? null);
    if (!videoId) return;
    const durationText = text(
      el.querySelector("ytd-thumbnail-overlay-time-status-renderer #text"),
    );
    out.push({
      videoId,
      title: anchor?.getAttribute("title")?.trim() || text(anchor) || "Untitled",
      channel:
        text(el.querySelector("ytd-channel-name #text")) ??
        text(el.querySelector("ytd-channel-name")),
      durationText,
      durationSec: parseDurationText(durationText),
      index: out.length,
      el: el as HTMLElement,
    });
  });
  return out;
}

function findContainer(): HTMLElement | null {
  for (const sel of LIST_CONTAINERS) {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (el) return el;
  }
  return null;
}

/** Live index: re-parses on DOM mutations (debounced) and on demand. */
export class NativeList {
  rows: NativeRow[] = [];
  private obs?: MutationObserver;
  private timer?: number;

  constructor(private onChange: (rows: NativeRow[]) => void) {}

  start(): void {
    this.reindex();
    const container = findContainer() ?? document.body;
    this.obs = new MutationObserver(() => this.schedule());
    this.obs.observe(container, { childList: true, subtree: true });
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.reindex(), 200);
  }

  reindex(): void {
    this.rows = parseRows();
    this.onChange(this.rows);
  }

  stop(): void {
    this.obs?.disconnect();
    clearTimeout(this.timer);
  }
}
