// Reads playlist rows from the YouTube page DOM for instant, sign-in-free
// display. Used ONLY for display (source:"dom"); writes always go through the
// API. Selectors live here and in mount-point.ts so DOM breakage is localised.

import type { Track } from "../shared/types";

const ROW = "ytd-playlist-video-renderer";

function videoIdFromHref(href: string | null): string | null {
  if (!href) return null;
  const m = /[?&]v=([^&]+)/.exec(href);
  return m ? m[1] : null;
}

function text(el: Element | null): string | undefined {
  const t = el?.textContent?.trim();
  return t ? t : undefined;
}

/** Parse all currently-rendered playlist rows into Track[] (DOM order = position). */
export function scrapeTracks(playlistId: string): Track[] {
  const rows = Array.from(document.querySelectorAll(ROW));
  const out: Track[] = [];
  rows.forEach((row) => {
    const anchor = row.querySelector("a#video-title") as HTMLAnchorElement | null;
    const videoId = videoIdFromHref(anchor?.getAttribute("href") ?? null);
    if (!videoId) return;

    const title = anchor?.getAttribute("title")?.trim() || text(anchor) || "Untitled";
    const channel = text(row.querySelector("ytd-channel-name #text")) ?? text(row.querySelector("ytd-channel-name"));
    const dur = text(row.querySelector("ytd-thumbnail-overlay-time-status-renderer #text"));
    const img = row.querySelector("ytd-thumbnail img") as HTMLImageElement | null;
    const thumb = img?.getAttribute("src") || undefined;

    out.push({
      playlistItemId: "", // not available from DOM; resolved via API on edit
      videoId,
      title,
      channelTitle: channel,
      thumbnailUrl: thumb && thumb.startsWith("http") ? thumb : undefined,
      durationText: dur,
      position: out.length,
      url: `https://www.youtube.com/watch?v=${videoId}&list=${playlistId}`,
    });
  });
  return out;
}

/**
 * Force-load lazy rows by scrolling to the bottom until the row count stops
 * growing (or a cap/timeout hits). Resolves with the final scraped tracks.
 */
export async function autoScrollLoadAll(
  playlistId: string,
  opts: { maxMs?: number } = {},
): Promise<Track[]> {
  const maxMs = opts.maxMs ?? 15000;
  const start = Date.now();
  let last = -1;
  while (Date.now() - start < maxMs) {
    const count = document.querySelectorAll(ROW).length;
    if (count === last) break;
    last = count;
    window.scrollTo({ top: document.documentElement.scrollHeight });
    await new Promise((r) => setTimeout(r, 600));
  }
  window.scrollTo({ top: 0 });
  return scrapeTracks(playlistId);
}
