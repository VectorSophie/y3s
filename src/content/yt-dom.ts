// Every read of YouTube's page markup lives here, so a YouTube redesign is
// one file to fix.

import { isUnavailableTitle, type RowData } from "../core/filter";

export const SEL = {
  playlistList: "ytd-playlist-video-list-renderer",
  playlistRow: "ytd-playlist-video-renderer",
  continuation: "ytd-continuation-item-renderer",
  panel: "ytd-playlist-panel-renderer",
  panelRow: "ytd-playlist-panel-video-renderer",
  rowIndex: "#index",
} as const;

const TIME_RE = /^\d{1,2}(?::\d{2}){1,2}$/;
const DURATION_SEL = [
  "ytd-thumbnail-overlay-time-status-renderer #text",
  ".badge-shape-wiz__text",
  ".yt-badge-shape__text",
  "badge-shape",
  "#overlays span",
  "#overlays div",
].join(", ");

export interface Row extends RowData {
  el: HTMLElement;
  anchor: HTMLAnchorElement | null;
}

export function readRow(el: HTMLElement): Row {
  const anchor = el.querySelector<HTMLAnchorElement>('a#video-title, a#wc-endpoint, a[href*="/watch?v="]');
  const m = /[?&]v=([^&#]+)/.exec(anchor?.getAttribute("href") ?? "");
  const t = el.querySelector("#video-title");
  const title = (t?.getAttribute("title") || t?.textContent || "").trim();
  const ch = el.querySelector("ytd-channel-name #text, ytd-channel-name, #byline");
  let duration: number | null = null;
  for (const d of el.querySelectorAll(DURATION_SEL)) {
    const s = d.textContent?.trim() ?? "";
    if (TIME_RE.test(s)) {
      duration = s.split(":").reduce((a, p) => a * 60 + Number(p), 0);
      break;
    }
  }
  return {
    el,
    anchor,
    videoId: m ? decodeURIComponent(m[1]) : null,
    title,
    channel: (ch?.textContent ?? "").trim().split("\n")[0].trim(),
    duration,
    unavailable: isUnavailableTitle(title) || el.hasAttribute("is-unavailable"),
  };
}

const shown = (el: Element) => !el.closest("[hidden]") && el.getClientRects().length > 0;

/** The playlist list on the current /playlist page (YouTube keeps old pages
 *  around hidden, so pick the visible one). */
export function findPlaylistList(): HTMLElement | null {
  return [...document.querySelectorAll<HTMLElement>(SEL.playlistList)].find(shown) ?? null;
}

export function findPlaylistPanel(): HTMLElement | null {
  return (
    [...document.querySelectorAll<HTMLElement>(SEL.panel)].find((p) => p.querySelector("#items") && shown(p)) ??
    null
  );
}

export const currentPlaylistId = () => new URLSearchParams(location.search).get("list");
