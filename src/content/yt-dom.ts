// Every read of YouTube's (and YouTube Music's) page markup lives here, so a
// redesign is one file to fix.

import { isUnavailableTitle, type RowData } from "../core/filter";

export type Site = "youtube" | "music";
export const site = (): Site => (location.hostname === "music.youtube.com" ? "music" : "youtube");

const YOUTUBE = {
  playlistList: "ytd-playlist-video-list-renderer",
  playlistRow: "ytd-playlist-video-renderer",
  continuation: "ytd-continuation-item-renderer",
  panel: "ytd-playlist-panel-renderer",
  panelItems: "#items",
  panelRow: "ytd-playlist-panel-video-renderer",
  rowIndex: "#index",
  player: "#movie_player",
  playerControls: "#movie_player .ytp-right-controls",
  playerNext: ".ytp-next-button",
  playerPrev: ".ytp-prev-button",
  /** Controls inside a row that must keep working (no drag-select from them). */
  rowControls: "#index-container, #reorder, ytd-menu-renderer, #menu, yt-icon-button",
  stickyTop: 56,
};

const MUSIC: typeof YOUTUBE = {
  playlistList: "ytmusic-playlist-shelf-renderer, ytmusic-shelf-renderer",
  playlistRow: "ytmusic-responsive-list-item-renderer",
  continuation: "ytmusic-continuation-item-renderer",
  panel: "ytmusic-player-queue",
  panelItems: "#contents",
  panelRow: "ytmusic-player-queue-item",
  rowIndex: ".index",
  player: "#movie_player",
  playerControls: "ytmusic-player-bar .right-controls-buttons",
  playerNext: "ytmusic-player-bar .next-button",
  playerPrev: "ytmusic-player-bar .previous-button",
  rowControls:
    "ytmusic-play-button-renderer, ytmusic-menu-renderer, ytmusic-like-button-renderer, tp-yt-paper-icon-button, yt-button-shape, ytmusic-checkbox-renderer",
  stickyTop: 64,
};

/** Selectors for the site this page is on (fixed for the page's lifetime). */
export const SEL = site() === "music" ? MUSIC : YOUTUBE;

const TIME_RE = /^\d{1,2}(?::\d{2}){1,2}$/;
const DURATION_SEL = [
  "ytd-thumbnail-overlay-time-status-renderer #text",
  "ytd-thumbnail-overlay-time-status-renderer span",
  ".ytBadgeShapeText",
  ".badge-shape-wiz__text",
  ".yt-badge-shape__text",
  "badge-shape",
  "#overlays span",
  "#overlays div",
  ".fixed-columns yt-formatted-string",
  ".fixed-column",
  ".duration",
].join(", ");

export interface Row extends RowData {
  el: HTMLElement;
  anchor: HTMLAnchorElement | null;
}

export function readRow(el: HTMLElement): Row {
  const anchor = el.querySelector<HTMLAnchorElement>('a#video-title, a#wc-endpoint, a[href*="watch?v="]');
  const m = /[?&]v=([^&#]+)/.exec(anchor?.getAttribute("href") ?? "");
  const t = el.querySelector("#video-title, .title-column .title, .song-title, .title");
  const title = (t?.getAttribute("title") || t?.textContent || anchor?.textContent || "").trim();
  const ch = el.querySelector(
    "ytd-channel-name #text, ytd-channel-name, #byline, .secondary-flex-columns yt-formatted-string, .byline",
  );
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
    channel: (ch?.textContent ?? "").trim().split("\n")[0].split(" • ")[0].trim(),
    duration,
    unavailable: isUnavailableTitle(title) || el.hasAttribute("is-unavailable") || el.hasAttribute("unplayable_"),
  };
}

const shown = (el: Element) => !el.closest("[hidden]") && el.getClientRects().length > 0;

/** The playlist list on the current /playlist page (YouTube keeps old pages
 *  around hidden, so pick the visible one that holds rows). */
export function findPlaylistList(): HTMLElement | null {
  return (
    [...document.querySelectorAll<HTMLElement>(SEL.playlistList)].find(
      (l) => shown(l) && (site() === "youtube" || l.querySelector(SEL.playlistRow)),
    ) ?? null
  );
}

/** Where the list's rows live inside it. */
export function listContents(list: HTMLElement): HTMLElement {
  return list.querySelector<HTMLElement>("#contents") ?? list;
}

export function findPlaylistPanel(): HTMLElement | null {
  return (
    [...document.querySelectorAll<HTMLElement>(SEL.panel)].find((p) => p.querySelector(SEL.panelItems) && shown(p)) ??
    null
  );
}

export const currentPlaylistId = () => new URLSearchParams(location.search).get("list");
